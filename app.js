/* ════════════════════════════════════════════════════════════════
   HARMAN GeoDefer — Bangalore Autonomous HUD  v3
   ─────────────────────────────────────────────────────────────
   Changes in v3:
     • Smart Stack aggregation for WhatsApp
     • Spotify → Google News + Gmail
     • Priority realignment: WhatsApp / News / Gmail always deferred
     • Road-realistic Bangalore waypoint geometry
     • Shutdown Sequence: decay → arrival overlay → ARIA farewell
════════════════════════════════════════════════════════════════ */

// ── 1. STATE MACHINE ──────────────────────────────────────────
const AssistantState = Object.freeze({
    IDLE:'IDLE', GREETING:'GREETING', ASK_START:'ASK_START',
    ASK_ORIGIN:'ASK_ORIGIN', ASK_DEST:'ASK_DEST',
    CONFIRMING:'CONFIRMING', NAVIGATING:'NAVIGATING', ARRIVED:'ARRIVED',
});
let state          = AssistantState.IDLE;
let isVoiceEnabled = true;
const DRIVER_NAME  = 'Driver';

// ── 2. BANGALORE WAYPOINT GEOCODING ──────────────────────────
/*  Each route key maps to an ordered list of [lat,lng] waypoints
    that simulate following actual Bangalore road corridors.
    The car will traverse ALL waypoints sequentially.           */
const BANGALORE_ROUTES = {
    'indiranagar': {
        coord: [12.9784, 77.6408],
        // Via 100ft Road → CMH Road cluster
        waypoints: [[12.9784,77.6408],[12.9762,77.6388],[12.9750,77.6350]],
    },
    'koramangala': {
        coord: [12.9352, 77.6245],
        waypoints: [[12.9352,77.6245],[12.9380,77.6290],[12.9410,77.6260]],
    },
    'whitefield': {
        coord: [12.9698, 77.7499],
        // Via Old Airport Road → Marathahalli Bridge → ITPL Main Road
        waypoints: [[12.9698,77.7499],[12.9650,77.7300],[12.9610,77.7100],[12.9591,77.7013]],
    },
    'yelahanka': {
        coord: [13.1005, 77.5963],
        // Via Bellary Road → GKVK Cross
        waypoints: [[13.1005,77.5963],[13.0800,77.5975],[13.0600,77.5960]],
    },
    'jayanagar': {
        coord: [12.9250, 77.5938],
        // Via 4th Block → 11th Main
        waypoints: [[12.9250,77.5938],[12.9270,77.5960],[12.9290,77.5980]],
    },
    'electronic city': {
        coord: [12.8399, 77.6770],
        // Via Hosur Road flyover → Phase 1 → Phase 2
        waypoints: [[12.8399,77.6770],[12.8520,77.6690],[12.8650,77.6620],[12.8780,77.6560]],
    },
    'hebbal': {
        coord: [13.0350, 77.5970],
        // Via Outer Ring Road → Hebbal flyover
        waypoints: [[13.0350,77.5970],[13.0250,77.5960],[13.0100,77.5950]],
    },
    'rajajinagar': {
        coord: [12.9907, 77.5530],
        // Via Chord Road → Rajajinagar Industrial Area
        waypoints: [[12.9907,77.5530],[12.9880,77.5580],[12.9850,77.5640]],
    },
    'mg road': {
        coord: [12.9738, 77.6119],
        waypoints: [[12.9738,77.6119],[12.9720,77.6100],[12.9700,77.6080]],
    },
    'hsr layout': {
        coord: [12.9100, 77.6450],
        // Via Outer Ring Road → Agara → Sector 7
        waypoints: [[12.9100,77.6450],[12.9150,77.6400],[12.9200,77.6350],[12.9240,77.6300]],
    },
    'marathahalli': {
        coord: [12.9591, 77.7013],
        // Via HAL Airport Road → Sai Baba Ashram Road
        waypoints: [[12.9591,77.7013],[12.9560,77.6900],[12.9530,77.6800]],
    },
    'btm layout': {
        coord: [12.9166, 77.6101],
        // Via Bannerghatta Road → 29th Main
        waypoints: [[12.9166,77.6101],[12.9200,77.6130],[12.9230,77.6160]],
    },
    'malleswaram': {
        coord: [13.0035, 77.5715],
        waypoints: [[13.0035,77.5715],[13.0000,77.5750],[12.9970,77.5790]],
    },
    'jp nagar': {
        coord: [12.9063, 77.5858],
        waypoints: [[12.9063,77.5858],[12.9080,77.5900],[12.9100,77.5950]],
    },
    'bannerghatta': {
        coord: [12.8636, 77.5982],
        waypoints: [[12.8636,77.5982],[12.8750,77.5960],[12.8870,77.5940]],
    },
    'richmond road': {
        coord: [12.9630, 77.6105],
        waypoints: [[12.9630,77.6105],[12.9650,77.6140],[12.9670,77.6175]],
    },
    'bommanahalli': {
        coord: [12.8920, 77.6476],
        waypoints: [[12.8920,77.6476],[12.9000,77.6440],[12.9070,77.6400]],
    },
    'kengeri': {
        coord: [12.9066, 77.4848],
        // Via Mysore Road
        waypoints: [[12.9066,77.4848],[12.9100,77.5000],[12.9140,77.5200],[12.9180,77.5400]],
    },
    'sarjapur': {
        coord: [12.8593, 77.6882],
        waypoints: [[12.8593,77.6882],[12.8700,77.6800],[12.8820,77.6700]],
    },
    'kr puram': {
        coord: [13.0000, 77.6950],
        // Via Old Madras Road → Tin Factory
        waypoints: [[13.0000,77.6950],[12.9900,77.6800],[12.9800,77.6640],[12.9700,77.6500]],
    },
};

// Helper: get single coord from route key
function getCoord(key) {
    return BANGALORE_ROUTES[key] ? BANGALORE_ROUTES[key].coord : null;
}

const FALLBACK_START = 'indiranagar';
const FALLBACK_DEST  = 'koramangala';
let originKey   = FALLBACK_START;
let destKey     = FALLBACK_DEST;
let originLabel = 'Indiranagar';
let destLabel   = 'Koramangala';

// ── 3. MAP INIT ───────────────────────────────────────────────
const BLORE_CENTER = [12.9716, 77.5946];
const map = L.map('map', {
    zoomControl: true, attributionControl: false,
    scrollWheelZoom: true, dragging: true,
}).setView(BLORE_CENTER, 12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:19 }).addTo(map);

// Car marker
const carIcon = L.divIcon({
    className: '',
    html: '<div class="car-marker" id="carMarkerNode"></div>',
    iconSize: [26,26], iconAnchor: [13,13],
});
let carPosition = { lat: BLORE_CENTER[0], lng: BLORE_CENTER[1] };
const carMarker = L.marker([carPosition.lat, carPosition.lng], { icon: carIcon }).addTo(map);

// Mutable map elements
let routePolyline = null;
let startCircle   = null;
let endCircle     = null;
let deadZones     = [];
let potholes      = [];
let inDeadZone    = false;

// ── 4. AUTONOMOUS DRIVE ENGINE ────────────────────────────────
const JOURNEY_DURATION_MS = 100000;  // exactly 100s
let autodriveActive  = false;
let journeyStartTime = 0;
let routePath        = [];           // flat [lat,lng] array interpolated from waypoints
let currentHeading   = 0;
let speed            = 0;
// Shutdown decay state
let notifDecaying    = false;
let decayInterval    = null;

function lerp(a, b, t) { return a + (b - a) * t; }

/*  buildRouteFromWaypoints:
    Takes the origin, 1-N intermediate waypoints from both locations,
    and destination waypoints, then interpolates a smooth dense path.  */
function buildRouteFromWaypoints(oKey, dKey) {
    const oRoute = BANGALORE_ROUTES[oKey];
    const dRoute = BANGALORE_ROUTES[dKey];

    // Collect: origin waypoints (forward) + dest waypoints (reversed as approach)
    const oWP  = oRoute.waypoints || [oRoute.coord];
    const dWP  = (dRoute.waypoints || [dRoute.coord]).slice().reverse();

    // Build control points: origin → its waypoints outward → midpoint bridge → dest inbound
    const oCoord = oRoute.coord;
    const dCoord = dRoute.coord;

    // Create a multi-segment cubic path through all waypoints
    const allPoints = [
        oCoord,
        ...oWP.slice(1),                                           // origin sub-waypoints
        [lerp(oCoord[0],dCoord[0],0.35), lerp(oCoord[1],dCoord[1],0.35)],  // bridge pt 1
        [lerp(oCoord[0],dCoord[0],0.65), lerp(oCoord[1],dCoord[1],0.65)],  // bridge pt 2
        ...dWP.slice(1).reverse(),                                 // dest sub-waypoints
        dCoord,
    ];

    // De-duplicate consecutive identical points
    const unique = allPoints.filter((p,i) => {
        if (i === 0) return true;
        return !(p[0] === allPoints[i-1][0] && p[1] === allPoints[i-1][1]);
    });

    // Interpolate dense points (100 steps total) across all segments
    const dense = [];
    const segs  = unique.length - 1;
    const stepsPerSeg = Math.max(1, Math.floor(100 / segs));

    for (let s = 0; s < segs; s++) {
        const a = unique[s];
        const b = unique[s + 1];
        // Add a slight perpendicular jitter to avoid perfectly straight segments
        const jMag = 0.004;
        const jLat = (Math.random() - 0.5) * jMag;
        const jLng = (Math.random() - 0.5) * jMag;
        const midLat = lerp(a[0], b[0], 0.5) + jLat;
        const midLng = lerp(a[1], b[1], 0.5) + jLng;

        for (let i = 0; i <= stepsPerSeg; i++) {
            const t    = i / stepsPerSeg;
            const invT = 1 - t;
            const lat  = invT*invT*a[0] + 2*invT*t*midLat + t*t*b[0];
            const lng  = invT*invT*a[1] + 2*invT*t*midLng + t*t*b[1];
            if (s > 0 && i === 0) continue;  // skip duplicate at segment join
            dense.push([lat, lng]);
        }
    }
    return dense;
}

function getInterpolatedPosition(t) {
    if (routePath.length < 2) return routePath[0] || [carPosition.lat, carPosition.lng];
    const totalSegments = routePath.length - 1;
    const floatIdx = t * totalSegments;
    const idx      = Math.min(Math.floor(floatIdx), totalSegments - 1);
    const segT     = floatIdx - idx;
    const a        = routePath[idx];
    const b        = routePath[idx + 1];
    return [lerp(a[0],b[0],segT), lerp(a[1],b[1],segT)];
}

function autonomousDriveTick(timestamp) {
    if (!autodriveActive) return;

    const elapsed  = timestamp - journeyStartTime;
    const progress = Math.min(elapsed / JOURNEY_DURATION_MS, 1);

    const [lat, lng] = getInterpolatedPosition(progress);

    // Heading from previous position
    if (routePath.length >= 2) {
        const prevProg = Math.max(progress - 0.008, 0);
        const [pLat, pLng] = getInterpolatedPosition(prevProg);
        currentHeading = Math.atan2(lng - pLng, lat - pLat) * 180 / Math.PI;
        const node = document.getElementById('carMarkerNode');
        if (node) node.style.transform = `rotate(${currentHeading - 90}deg)`;
    }

    carPosition = { lat, lng };
    carMarker.setLatLng([lat, lng]);
    map.panTo([lat, lng], { animate:true, duration:0.15 });

    // Speed: sinusoidal fluctuation 40-60 km/h
    speed = 50 + Math.round(10 * Math.sin(timestamp / 1800 + Math.cos(timestamp / 900)));
    document.getElementById('speedDisplay').innerText = speed;

    // Progress bar
    document.getElementById('routeProgressFill').style.width = (progress * 100) + '%';

    // Spatial checks
    checkSpatialState();

    // Last-5-second notification decay
    const remaining = JOURNEY_DURATION_MS - elapsed;
    if (remaining < 5000 && !notifDecaying) {
        startNotificationDecay();
    }

    if (progress < 1) {
        requestAnimationFrame(autonomousDriveTick);
    } else {
        triggerArrivalSequence();
    }
}

// ── 5. ARRIVAL SHUTDOWN SEQUENCE ─────────────────────────────
function startNotificationDecay() {
    notifDecaying = true;
    // Stop generating new notifications immediately
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
}

function triggerArrivalSequence() {
    autodriveActive = false;
    speed = 0;
    document.getElementById('speedDisplay').innerText = '0';

    // Snap car to exact destination
    const dCoord = getCoord(destKey);
    if (dCoord) {
        carPosition = { lat: dCoord[0], lng: dCoord[1] };
        carMarker.setLatLng(dCoord);
    }

    // Build ARIA farewell message
    const farewell = `You have reached your destination at ${destLabel}. GeoDefer systems are now entering standby. Have a great day, ${DRIVER_NAME}.`;

    // Show arrival overlay (slight delay for the car to visually stop)
    setTimeout(() => {
        document.getElementById('arrivalDestName').textContent = destLabel.toUpperCase();
        document.getElementById('arrivalMsg').textContent = farewell;
        document.getElementById('arrivalOverlay').classList.add('active');
        state = AssistantState.ARRIVED;

        // Speak farewell via ARIA
        speakNavigationAlert(farewell);

        // Update journey info
        document.getElementById('journeyInfo').innerHTML = `✓ Arrived · ${destLabel}`;
    }, 600);
}

// ── 6. ROUTE SETUP ────────────────────────────────────────────
function setupRoute(oKey, dKey) {
    const oCoord = getCoord(oKey);
    const dCoord = getCoord(dKey);
    if (!oCoord || !dCoord) return false;

    originKey   = oKey;
    destKey     = dKey;
    originLabel = toTitleCase(oKey);
    destLabel   = toTitleCase(dKey);

    // Clear old map layers
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
    if (startCircle)   { map.removeLayer(startCircle);   startCircle   = null; }
    if (endCircle)     { map.removeLayer(endCircle);     endCircle     = null; }
    deadZones.forEach(z => map.removeLayer(z.circle));
    potholes.forEach(p => map.removeLayer(p.circle));
    deadZones = [];
    potholes  = [];

    // Build road-realistic path
    routePath = buildRouteFromWaypoints(oKey, dKey);

    // Draw polyline — slightly thicker for road feel
    routePolyline = L.polyline(routePath, {
        color: 'rgba(0,229,255,0.5)', weight: 3.5, dashArray: '8 5',
        lineJoin: 'round', lineCap: 'round',
    }).addTo(map);

    // Start / end markers
    startCircle = L.circleMarker(oCoord, {
        radius:8, color:'#f0b840', fillColor:'#f0b840', fillOpacity:0.95, weight:2
    }).addTo(map).bindTooltip(`🚦 ${originLabel} (Start)`, { direction:'top' });

    endCircle = L.circleMarker(dCoord, {
        radius:8, color:'#00ffb3', fillColor:'#00ffb3', fillOpacity:0.95, weight:2
    }).addTo(map).bindTooltip(`🏁 ${destLabel} (Destination)`, { direction:'top' });

    // Fit bounds with padding
    const bounds = L.latLngBounds([oCoord, dCoord]);
    map.fitBounds(bounds, { padding: [90, 90] });

    // Scatter route-vector hazards
    scatterHazards(routePath);

    // Snap car to origin
    carPosition = { lat: oCoord[0], lng: oCoord[1] };
    carMarker.setLatLng(oCoord);

    return true;
}

function scatterHazards(path) {
    const len = path.length;
    const numDead = 5 + Math.floor(Math.random() * 3);
    const numPit  = 10 + Math.floor(Math.random() * 3);

    for (let i = 0; i < numDead; i++) {
        const idx  = Math.floor(5 + (i / numDead) * (len - 10));
        const p    = path[idx];
        const jLat = p[0] + (Math.random() - 0.5) * 0.005;
        const jLng = p[1] + (Math.random() - 0.5) * 0.005;
        const radius = 280 + Math.floor(Math.random() * 320);
        const circle = L.circle([jLat, jLng], {
            color:'#ff1a4e', fillColor:'#ff1a4e', fillOpacity:0.11,
            radius, weight:1.5, dashArray:'5,10'
        }).addTo(map);
        deadZones.push({ center:[jLat, jLng], radius, circle });
    }

    for (let i = 0; i < numPit; i++) {
        const idx  = Math.floor(3 + (i / numPit) * (len - 6));
        const p    = path[idx];
        const jLat = p[0] + (Math.random() - 0.5) * 0.0025;
        const jLng = p[1] + (Math.random() - 0.5) * 0.0025;
        const circle = L.circle([jLat, jLng], {
            color:'#ffcc00', fillColor:'#ffcc00', fillOpacity:0.5, radius:25, weight:2
        }).addTo(map);
        potholes.push({ center:[jLat, jLng], radius:25, circle, alerted:false });
    }
}

// ── 7. SPATIAL CHECKS ─────────────────────────────────────────
function checkSpatialState() {
    if (state !== AssistantState.NAVIGATING) return;
    const pos = L.latLng(carPosition.lat, carPosition.lng);
    let currentlyInZone = false, minDepth = Infinity;

    for (const zone of deadZones) {
        const dist = map.distance(pos, L.latLng(zone.center[0], zone.center[1]));
        if (dist < zone.radius) {
            currentlyInZone = true;
            const depth = zone.radius - dist;
            if (depth < minDepth) minDepth = depth;
        }
    }

    updateSignalStrength(currentlyInZone, minDepth);
    if (currentlyInZone !== inDeadZone) {
        inDeadZone = currentlyInZone;
        handleZoneTransition();
    }

    for (const ph of potholes) {
        const dist = map.distance(pos, L.latLng(ph.center[0], ph.center[1]));
        if (dist < 90 && !ph.alerted) {
            ph.alerted = true;
            triggerPotholeAlert();
        } else if (dist > 160 && ph.alerted) {
            ph.alerted = false;
        }
    }
}

function updateSignalStrength(inZone, depth) {
    const bars = document.querySelectorAll('.signal-bar');
    if (!inZone) {
        bars.forEach(b => b.className = 'signal-bar active');
    } else {
        bars.forEach(b => b.className = 'signal-bar');
        bars[0].className = 'signal-bar poor';
        if (depth < 200) bars[1].className = 'signal-bar poor';
    }
}

function handleZoneTransition() {
    // BUG FIX — Chrome panels (top bar, voice panel) get the full dim effect.
    // Notification sidebars use dead-zone-dim-sidebar which keeps opacity:1
    // so Pending and Delivered cards remain fully readable inside dead zones.
    const chromePanels = ['topBar', 'voicePanel'];
    chromePanels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('dead-zone-dim', inDeadZone);
    });

    const notifPanels = ['leftPanel', 'rightPanel'];
    notifPanels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('dead-zone-dim-sidebar', inDeadZone);
    });

    const alertEl = document.getElementById('zoneAlert');
    if (inDeadZone) {
        alertEl.classList.add('visible');
        speakNavigationAlert('Entering dead zone. Non-critical notifications will be deferred.');
    } else {
        alertEl.classList.remove('visible');
        flushPendingQueue();
    }
}

function triggerPotholeAlert() {
    const el = document.getElementById('potholeAlert');
    el.classList.add('visible');
    speakNavigationAlert('Warning! Pothole detected ahead.');
    setTimeout(() => el.classList.remove('visible'), 3500);
}

// ── 8. APP CONFIG — Spotify removed, Google News + Gmail added ─
const apps = [
    { name:'WhatsApp',   desc:'Messages & Calls',        isCritical:false, alwaysDefer:true  },
    { name:'Maps',       desc:'Navigation Alerts',       isCritical:true,  alwaysDefer:false },
    { name:'GoogleNews', desc:'News & Trending Stories', isCritical:false, alwaysDefer:true  },
    { name:'Gmail',      desc:'Email Notifications',     isCritical:false, alwaysDefer:true  },
    { name:'System',     desc:'Vehicle Warnings',        isCritical:true,  alwaysDefer:false },
    { name:'Phone',      desc:'Incoming Calls',          isCritical:true,  alwaysDefer:false },
];

const notificationTemplates = {
    WhatsApp:   ['Message from Priya','Group: Team Bangalore','Voice note received','Image received','Video shared'],
    Maps:       ['Take next left on 100ft Rd','Traffic on Hosur Road','Speed camera ahead','Route recalculated'],
    GoogleNews: ['Bangalore Metro Phase 3 update','Startup raises ₹200Cr in Bengaluru','Tech Summit this weekend'],
    Gmail:      ['Meeting invite: Sprint Review','Invoice from Swiggy Instamart','FYI: Q3 report attached'],
    System:     ['Tyre pressure low','Washer fluid low','Service due in 500 km','Engine temp normal'],
    Phone:      ['Incoming call: Boss','Missed call: Unknown','Voicemail received'],
};

// ── 9. SMART STACK — WhatsApp Aggregation ─────────────────────
// whatsappStack: tracks the live pending WhatsApp stack card
let whatsappStack = null;  // { count, id, timestamp }

function getOrCreateWhatsAppStack() {
    // If a WA card already exists in pendingQueue, increment it
    if (whatsappStack) {
        whatsappStack.count++;
        whatsappStack.bumped = true;  // flag to trigger CSS bump animation
        return null;  // signal: update existing, don't add new
    }
    // Create a new stack slot
    whatsappStack = {
        id:        'wa-stack-' + Date.now(),
        count:     1,
        timestamp: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
        bumped:    false,
    };
    return whatsappStack;
}

// ── 10. NOTIFICATION QUEUES ────────────────────────────────────
let pendingQueue   = [];
let deliveredQueue = [];
let restoreQueue   = [];
let isRestoring    = false;
let simulationInterval;

function generateRandomNotification() {
    if (state !== AssistantState.NAVIGATING) return;
    if (notifDecaying) return;  // halted in last 5s

    const appObj = apps[Math.floor(Math.random() * apps.length)];
    const templates = notificationTemplates[appObj.name];
    const notif = {
        id:        Date.now() + Math.random(),
        app:       appObj.name,
        title:     templates[Math.floor(Math.random() * templates.length)],
        body:      'GeoDefer · Bangalore route.',
        timestamp: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
        isCritical:  appObj.isCritical,
        alwaysDefer: appObj.alwaysDefer,
    };
    processNotification(notif);
}

/*  Priority Realignment Rules:
    - System / Phone / Maps (isCritical=true, alwaysDefer=false)
      → always go to Delivered immediately
    - WhatsApp / GoogleNews / Gmail (alwaysDefer=true)
      → always go to Pending, EVEN when not in a dead zone
      → WhatsApp uses Smart Stack aggregation                   */
function processNotification(notif) {
    if (notif.isCritical && !notif.alwaysDefer) {
        // Critical safety / system → delivered immediately
        deliverNotification(notif, false);
    } else if (notif.app === 'WhatsApp') {
        // Smart Stack aggregation
        processWhatsAppStack();
    } else {
        // All other deferred apps → always to pending
        queueNotification(notif);
    }
}

function processWhatsAppStack() {
    const result = getOrCreateWhatsAppStack();
    if (result === null) {
        // Stack already exists — bump counter on existing card
        renderQueues(null, true);   // true = bump animation
    } else {
        // New stack card → push to pending
        const stackNotif = {
            id:          result.id,
            app:         'WhatsApp',
            isStack:     true,
            count:       1,
            title:       'WhatsApp: 1 New Message',
            body:        'Stacked to protect your focus.',
            timestamp:   result.timestamp,
            isCritical:  false,
            alwaysDefer: true,
        };
        pendingQueue.push(stackNotif);
        renderQueues();
    }
}

function queueNotification(notif) {
    pendingQueue.push(notif);
    renderQueues();
}

function deliverNotification(notif, isRestored = false) {
    deliveredQueue.unshift(notif);
    if (deliveredQueue.length > 20) deliveredQueue.pop();
    renderQueues(isRestored ? notif.id : null);
    if (state === AssistantState.NAVIGATING && isVoiceEnabled && notif.isCritical) {
        speakNavigationAlert(`${notif.app}: ${notif.title}.`);
    }
}

// ── 11. QUEUE FLUSH ───────────────────────────────────────────
function flushPendingQueue() {
    if (!pendingQueue.length) return;
    const toFlush = [...pendingQueue];
    pendingQueue  = [];
    whatsappStack = null;  // reset stack on flush
    renderQueues();

    if (state === AssistantState.NAVIGATING) {
        speakNavigationAlert(`Signal restored. Delivering ${toFlush.length} deferred notification${toFlush.length > 1 ? 's' : ''}.`);
    }
    toFlush.forEach(n => restoreQueue.push(n));
    if (!isRestoring) drainRestoreQueue();
}

function drainRestoreQueue() {
    if (!restoreQueue.length) { isRestoring = false; return; }
    isRestoring = true;
    const notif = restoreQueue.shift();
    deliveredQueue.unshift(notif);
    if (deliveredQueue.length > 20) deliveredQueue.length = 20;
    renderQueues(notif.id);
    if (state === AssistantState.NAVIGATING && isVoiceEnabled && notif.isCritical) {
        speakNavigationAlert(`${notif.app}: ${notif.title}.`);
    }
    setTimeout(drainRestoreQueue, 800);
}

// ── 12. RENDER ────────────────────────────────────────────────
function renderQueues(restoredId = null, bumpWA = false) {
    // Update WhatsApp stack count in pending if it exists
    const waSlot = pendingQueue.find(n => n.isStack && n.app === 'WhatsApp');
    if (waSlot && whatsappStack) {
        waSlot.count = whatsappStack.count;
        waSlot.title = `WhatsApp: ${whatsappStack.count} New Message${whatsappStack.count > 1 ? 's' : ''}`;
    }

    document.getElementById('pendingCount').innerText   = pendingQueue.length;
    document.getElementById('deliveredCount').innerText = deliveredQueue.length;

    const pList = document.getElementById('pendingList');
    pList.innerHTML = pendingQueue.map(n => createCard(n, true, false, bumpWA && n.isStack)).join('');

    const dList = document.getElementById('deliveredList');
    dList.innerHTML = deliveredQueue.map(n => createCard(n, false, n.id === restoredId, false)).join('');
}

function createCard(notif, isPending, isRestored, isBumped) {
    const isStackCard = notif.isStack && notif.app === 'WhatsApp';
    const cls         = notif.isCritical ? 'critical' : notif.app;
    const stackCls    = isStackCard ? 'whatsapp-stack' : '';
    const bumpCls     = isBumped   ? 'counter-bump'   : '';
    const animCls     = isRestored ? 'restored'        : '';
    const badge       = isPending && !isStackCard ? '<div class="status-badge">Deferred</div>' : '';
    const rTag        = isRestored ? '<div class="restored-tag">↩ Restored</div>' : '';
    const stackBadge  = isStackCard
        ? `<div class="stack-counter">${notif.count}</div>`
        : '';

    return `<div class="notif-card ${cls} ${stackCls} ${bumpCls} ${animCls}">
        ${badge}${stackBadge}
        <div class="notif-header">
            <span class="notif-app">${notif.app === 'GoogleNews' ? 'Google News' : notif.app}</span>
            <span>${notif.timestamp}</span>
        </div>
        <div class="notif-title">${notif.title}</div>
        <div class="notif-body">${notif.body}</div>
        ${rTag}
    </div>`;
}

// ── 13. SPEECH SYNTHESIS ─────────────────────────────────────
function speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd && onEnd(); return; }
    window.speechSynthesis.cancel();
    const msg    = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pref   = voices.find(v => v.lang.startsWith('en') && /female|zira|samantha|karen|moira|tessa|victoria/i.test(v.name))
                || voices.find(v => v.lang.startsWith('en'));
    if (pref) msg.voice = pref;
    msg.rate = 0.82; msg.pitch = 1.05; msg.volume = 0.92;
    msg.onstart = () => {
        document.getElementById('vpAvatar').classList.add('speaking');
        document.getElementById('waveform').classList.add('active');
    };
    msg.onend = () => {
        document.getElementById('vpAvatar').classList.remove('speaking');
        document.getElementById('waveform').classList.remove('active');
        onEnd && onEnd();
    };
    window.speechSynthesis.speak(msg);
}
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function speakNavigationAlert(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const msg    = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pref   = voices.find(v => v.lang.startsWith('en') && /female|zira|samantha|karen|moira|tessa|victoria/i.test(v.name))
                || voices.find(v => v.lang.startsWith('en'));
    if (pref) msg.voice = pref;
    msg.rate = 0.82; msg.pitch = 1.05; msg.volume = 0.92;
    window.speechSynthesis.speak(msg);
}

// ── 14. SPEECH RECOGNITION ────────────────────────────────────
const SRConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr = null, srActive = false;

if (SRConstructor) {
    sr = new SRConstructor();
    sr.continuous = false; sr.interimResults = true; sr.lang = 'en-IN';
    sr.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t; else interim += t;
        }
        document.getElementById('vpUserTranscript').textContent = final || interim;
        if (final) handleUserSpeech(final.trim().toLowerCase());
    };
    sr.onerror = (e) => { if (e.error === 'no-speech') return; setMicUI(false); showFallback(); };
    sr.onend   = ()  => { srActive = false; setMicUI(false); };
}

function startListening() {
    if (!sr) { showFallback(); return; }
    if (srActive) return;
    srActive = true;
    document.getElementById('vpUserTranscript').textContent = '';
    setMicUI(true);
    try { sr.start(); } catch(e) {}
}
function stopListening() {
    if (!sr || !srActive) return;
    srActive = false;
    try { sr.stop(); } catch(e) {}
    setMicUI(false);
}
function setMicUI(on) {
    const orb = document.getElementById('micOrb');
    const st  = document.getElementById('micStatus');
    if (on) { orb.classList.add('listening'); st.classList.add('listening'); st.textContent = 'Listening…'; }
    else    { orb.classList.remove('listening'); st.classList.remove('listening'); st.textContent = 'Standby'; }
}

// ── 15. DIALOGUE STATE MACHINE ────────────────────────────────
function setAssistantText(t) { document.getElementById('vpAssistantText').textContent = t; }
function showVoicePanel()    { document.getElementById('voicePanel').classList.add('visible'); }

function doGreeting() {
    state = AssistantState.GREETING;
    showVoicePanel();
    const msg = 'Hello. ARIA is online. GeoDefer systems active for Bangalore. Shall I initialize your route?';
    setAssistantText(msg);
    speak(msg, () => {
        state = AssistantState.ASK_START;
        setAssistantText('Say "Yes" or "Start" to begin route initialization.');
        startListening(); showFallbackStart();
    });
}

function doAskOrigin() {
    state = AssistantState.ASK_ORIGIN;
    const q = 'Where are we starting from?';
    setAssistantText(q);
    speak(q, () => { startListening(); showFallbackOrigin(); });
}

function doAskDest() {
    state = AssistantState.ASK_DEST;
    const q = 'And where is your destination?';
    setAssistantText(q);
    speak(q, () => { startListening(); showFallbackDest(); });
}

function doConfirmRoute() {
    state = AssistantState.CONFIRMING;
    stopListening(); hideFallback();
    const ok = setupRoute(originKey, destKey);
    if (!ok) {
        const err = 'Sorry, I could not resolve those locations. Please try again.';
        setAssistantText(err);
        speak(err, () => { state = AssistantState.ASK_ORIGIN; doAskOrigin(); });
        return;
    }
    document.getElementById('routePillText').textContent = `${originLabel} → ${destLabel}`;
    document.getElementById('routePill').classList.add('visible');

    const msg = `Setting route from ${originLabel} to ${destLabel} in Bangalore. Autonomous navigation will begin shortly. I will manage your notifications throughout.`;
    setAssistantText(msg);
    speak(msg, () => setTimeout(doStartNavigation, 1000));
}

function doStartNavigation() {
    state = AssistantState.NAVIGATING;
    notifDecaying = false;

    // Collapse voice panel
    setAssistantText('');
    ['micOrb','micStatus','vpUserTranscript','waveform','vpAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.vp-label, .vp-user-row').forEach(el => el.style.display='none');
    const panel = document.getElementById('voicePanel');
    panel.style.padding = '12px 18px';
    panel.style.width   = 'auto';

    document.getElementById('journeyInfo').innerHTML =
        `Autonomous · 100-sec flight · ${originLabel} → ${destLabel}`;

    simulationInterval = setInterval(generateRandomNotification, 3800);

    autodriveActive  = true;
    journeyStartTime = performance.now();
    requestAnimationFrame(autonomousDriveTick);
}

// ── 16. VOICE INPUT HANDLER ───────────────────────────────────
function resolveLocation(text) {
    const lower = text.toLowerCase().trim();
    if (BANGALORE_ROUTES[lower]) return lower;
    for (const key of Object.keys(BANGALORE_ROUTES)) {
        if (lower.includes(key) || key.includes(lower)) return key;
    }
    const words = lower.split(/\s+/);
    for (const key of Object.keys(BANGALORE_ROUTES)) {
        for (const w of words) {
            if (w.length > 3 && key.includes(w)) return key;
        }
    }
    return null;
}

function handleUserSpeech(text) {
    stopListening();
    document.getElementById('vpUserTranscript').textContent = text;

    if (state === AssistantState.ASK_START) {
        if (/yes|start|yeah|yep|go|ok|sure|engine|initialize|route/i.test(text)) {
            hideFallback(); doAskOrigin();
        } else {
            const retry = "I didn't catch that. Please say Yes or Start.";
            setAssistantText(retry);
            speak(retry, () => startListening());
        }
    } else if (state === AssistantState.ASK_ORIGIN) {
        const key = resolveLocation(text);
        if (key) {
            originKey   = key;
            originLabel = toTitleCase(key);
            hideFallback(); doAskDest();
        } else {
            const retry = `I didn't recognise that. Try Indiranagar, Koramangala, or Whitefield.`;
            setAssistantText(retry);
            speak(retry, () => { startListening(); showFallbackOrigin(); });
        }
    } else if (state === AssistantState.ASK_DEST) {
        const key = resolveLocation(text);
        if (key) {
            destKey   = key;
            destLabel = toTitleCase(key);
            hideFallback(); doConfirmRoute();
        } else {
            const retry = `I didn't recognise that. Try Electronic City, Whitefield, or Hebbal.`;
            setAssistantText(retry);
            speak(retry, () => { startListening(); showFallbackDest(); });
        }
    }
}

// ── 17. FALLBACK BUTTONS ──────────────────────────────────────
const FALLBACK_ORIGINS = ['indiranagar','koramangala','mg road','rajajinagar','hebbal','malleswaram'];
const FALLBACK_DESTS   = ['whitefield','electronic city','jayanagar','yelahanka','hsr layout','marathahalli'];

function showFallbackStart() {
    if (sr) return;
    const row = document.getElementById('fallbackBtns');
    row.innerHTML = `<button class="vp-btn" onclick="handleUserSpeech('yes')">Yes, Start</button>`;
    row.classList.remove('hidden');
}
function showFallbackOrigin() {
    const row = document.getElementById('fallbackBtns');
    row.innerHTML = FALLBACK_ORIGINS.map(k =>
        `<button class="vp-btn" onclick="handleUserSpeech('${k}')">${toTitleCase(k)}</button>`
    ).join('');
    row.classList.remove('hidden');
}
function showFallbackDest() {
    const row = document.getElementById('fallbackBtns');
    row.innerHTML = FALLBACK_DESTS.map(k =>
        `<button class="vp-btn" onclick="handleUserSpeech('${k}')">${toTitleCase(k)}</button>`
    ).join('');
    row.classList.remove('hidden');
}
function showFallback() {
    if (state === AssistantState.ASK_START)  showFallbackStart();
    if (state === AssistantState.ASK_ORIGIN) showFallbackOrigin();
    if (state === AssistantState.ASK_DEST)   showFallbackDest();
}
function hideFallback() {
    const row = document.getElementById('fallbackBtns');
    row.classList.add('hidden'); row.innerHTML = '';
}

// ── 18. UTILS ─────────────────────────────────────────────────
function toTitleCase(str) { return str.replace(/\b\w/g, c => c.toUpperCase()); }

// ── 19. CLOCK ─────────────────────────────────────────────────
function updateClock() {
    document.getElementById('clockDisplay').innerText =
        new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
updateClock(); setInterval(updateClock, 1000);

// ── 20. SETTINGS ──────────────────────────────────────────────
document.getElementById('openSettingsBtn').addEventListener('click', () => {
    renderSettings();
    document.getElementById('settingsModal').classList.add('active');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('active');
});
document.getElementById('voiceToggle').addEventListener('change', function() {
    isVoiceEnabled = this.checked;
});

function renderSettings() {
    const list = document.getElementById('settingsList');
    list.innerHTML = apps.map((app, i) => `
        <div class="setting-item">
            <div>
                <div class="setting-name">${app.name === 'GoogleNews' ? 'Google News' : app.name}</div>
                <div class="setting-desc">${app.desc}${app.alwaysDefer ? ' · Always Deferred' : ''}</div>
            </div>
            <label class="switch">
                <input type="checkbox" onchange="toggleAppCritical(${i})" ${app.isCritical ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>`).join('');
}
window.toggleAppCritical = (i) => { apps[i].isCritical = !apps[i].isCritical; };

// ── 21. STARTUP ───────────────────────────────────────────────
document.getElementById('startEngineBtn').addEventListener('click', () => {
    document.getElementById('startScreen').classList.add('hidden');
    setTimeout(() => {
        renderQueues();
        doGreeting();
    }, 500);
});

renderQueues();
