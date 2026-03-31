// Data Models
const satellites = [
    { id: 'SAT-Alpha', angle: 0, radius: 125, originalRadius: 125, originalAngleOffset: 0, speed: 0.005, orbit: 1, fuel: 82, status: 'Normal', safeTime: 0, operationalStatus: 'NOMINAL' },
    { id: 'SAT-Beta', angle: 45 * Math.PI / 180, radius: 190, originalRadius: 190, originalAngleOffset: 45 * Math.PI / 180, speed: 0.003, orbit: 2, fuel: 95, status: 'Normal', safeTime: 0, operationalStatus: 'NOMINAL' },
    { id: 'SAT-Gamma', angle: 120 * Math.PI / 180, radius: 190, originalRadius: 190, originalAngleOffset: 120 * Math.PI / 180, speed: 0.0035, orbit: 2, fuel: 45, status: 'Warning', safeTime: 0, operationalStatus: 'WARNING' },
    { id: 'SAT-Delta', angle: 210 * Math.PI / 180, radius: 250, originalRadius: 250, originalAngleOffset: 210 * Math.PI / 180, speed: 0.002, orbit: 3, fuel: 12, status: 'Critical', safeTime: 0, operationalStatus: 'WARNING' },
    { id: 'SAT-Echo', angle: 300 * Math.PI / 180, radius: 250, originalRadius: 250, originalAngleOffset: 300 * Math.PI / 180, speed: 0.0022, orbit: 3, fuel: 88, status: 'Normal', safeTime: 0, operationalStatus: 'NOMINAL' }
];

// Track which collision pairs have already been announced to avoid repeat logs
const announcedCollisions = new Set();
const announcedAvoidances = new Set();

function getTelemetry(sat) {
    if (!sat.x) return { id: sat.id, position: {x:0, y:0}, velocity: 0, fuel: sat.fuel, orbit: sat.radius };
    const posX = (sat.radius * Math.cos(sat.angle)).toFixed(2);
    const posY = (sat.radius * Math.sin(sat.angle)).toFixed(2);
    const velXY = Math.abs(sat.radius * sat.speed * 60).toFixed(2);
    return {
        id: sat.id,
        position: { x: posX, y: posY },
        velocity: velXY,
        fuel: sat.fuel.toFixed(1),
        orbit: sat.radius.toFixed(0)
    };
}

function calculateTCA(sat, deb) {
    if (!sat.x || !deb.x) return 0;
    const dx = sat.x - deb.x;
    const dy = sat.y - deb.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const satVel = Math.abs(sat.speed * sat.radius);
    const debVel = Math.abs(deb.speed * deb.radius);
    const closingSpeed = Math.abs(satVel - debVel) * 10 + 0.1; 
    let tcaSeconds = Math.floor(distance / closingSpeed);
    return Math.max(0, Math.min(tcaSeconds, 300));
}

const debrisObj = [];
const numDebris = 20;

// Initialize debris with varied distances and angles
for (let i = 0; i < numDebris; i++) {
    debrisObj.push({
        id: `DEB-${Math.floor(Math.random() * 9000) + 1000}`,
        angle: Math.random() * Math.PI * 2,
        radius: 100 + Math.random() * 180,
        speed: (Math.random() * 0.008) - 0.004,
        isRisk: false,
        riskLevel: 'NONE'
    });
}

const globalManeuvers = [];

// Elements
const viewArea = document.getElementById('orbit-view');
const satElements = {};
const satLabelElements = {};  // status label divs near each satellite dot
const debrisElements = {};
const terminalContent = document.getElementById('terminal-content');
const fullTelemetryContent = document.getElementById('full-telemetry-content');
const alertsTableBody = document.getElementById('alerts-table-body');
const maneuverTimeline = document.getElementById('maneuver-timeline');

const scheduledManeuversIds = new Set();
let alerts = [];

let collisionLines = {};
let activeRiskPairs = {};
let svgOverlay = null;

// Navigation Logic
window.switchPage = function(pageId, linkElement) {
    // Hide all pages
    document.querySelectorAll('.page-section').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    const tgt = document.getElementById(pageId);
    if(tgt) tgt.classList.add('active');
    
    // Update all nav links (sidebar)
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    // Activate matching sidebar link by data-page
    const sidebarLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    if (sidebarLink) sidebarLink.classList.add('active');

    // Populate data based on active page
    if (pageId === 'satellites-page') populateSatellitesPage();
    if (pageId === 'debris-page') populateDebrisPage();
    if (pageId === 'maneuver-page') populateManeuverPage();
    if (pageId === 'fuel-page') populateFuelPage();
    if (pageId === 'reports-page') populateReportsPage();
};

function populateSatellitesPage() {
    const tbody = document.querySelector('#satellites-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    satellites.forEach(sat => {
        const velXY = Math.abs(sat.radius * sat.speed * 60).toFixed(2);
        let badgeClass = sat.status === 'Normal' ? 'badge-low' : (sat.status === 'Warning' ? 'badge-medium' : 'badge-high');
        const signalBars = `<div style="display:inline-flex; align-items:flex-end; height:12px; gap:2px; margin-left:8px;" title="Live Signal"><div style="width:3px; height:40%; background:var(--accent-blue); animation: signalBounce 1s infinite alternate 0.1s;"></div><div style="width:3px; height:70%; background:var(--accent-blue); animation: signalBounce 1s infinite alternate 0.3s;"></div><div style="width:3px; height:100%; background:var(--accent-blue); animation: signalBounce 1s infinite alternate 0.5s;"></div></div>`;
        tbody.innerHTML += `
            <tr>
                <td style="display:flex; align-items:center;"><i class="fa-solid fa-satellite" style="color:#64748b; margin-right:6px;"></i> ${sat.id} ${signalBars}</td>
                <td>${sat.radius.toFixed(0)}</td>
                <td>${velXY}</td>
                <td>${sat.fuel.toFixed(1)}%</td>
                <td><span class="badge ${badgeClass}">${sat.status}</span></td>
            </tr>
        `;
    });
}

function populateDebrisPage() {
    const tbody = document.querySelector('#debris-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Sort debris to show highest risk first
    const sortedDebris = [...debrisObj].sort((a,b) => {
        const order = {'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'NONE': 0};
        return order[b.riskLevel || 'NONE'] - order[a.riskLevel || 'NONE'];
    });

    sortedDebris.forEach(deb => {
        const velXY = Math.abs(deb.radius * deb.speed * 60).toFixed(2);
        let badgeClass = 'badge-low';
        if (deb.riskLevel === 'HIGH') badgeClass = 'badge-high';
        else if (deb.riskLevel === 'MEDIUM') badgeClass = 'badge-medium';
        else if (deb.riskLevel === 'LOW' || deb.riskLevel === 'NONE') {
             badgeClass = 'badge-low';
             if(!deb.riskLevel) deb.riskLevel = 'NONE';
        }

        tbody.innerHTML += `
            <tr>
                <td>${deb.id}</td>
                <td>${deb.radius.toFixed(0)}</td>
                <td>${velXY}</td>
                <td><span class="badge ${badgeClass}">${deb.riskLevel || 'NONE'}</span></td>
            </tr>
        `;
    });
}

function populateManeuverPage() {
    const tbody = document.querySelector('#maneuver-page-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (globalManeuvers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No maneuvers currently scheduled.</td></tr>';
        return;
    }

    globalManeuvers.forEach(m => {
        tbody.innerHTML += `
            <tr>
                <td><i class="fa-solid fa-satellite" style="margin-right:5px;"></i> ${m.satId}</td>
                <td>${m.deltaV} m/s</td>
                <td>${m.burnDuration}s</td>
                <td><span style="font-family: monospace; color: var(--accent-blue);">${m.time}</span></td>
            </tr>
        `;
    });
}

function populateFuelPage() {
    const container = document.getElementById('detailed-fuel-content');
    if (!container) return;
    container.innerHTML = '';

    satellites.forEach(sat => {
        let fClass = sat.status === 'Normal' ? '' : (sat.status === 'Warning' ? 'warning' : 'critical');
        let txtClass = sat.status === 'Critical' ? 'color: var(--accent-red);' : (sat.status === 'Warning' ? 'color: var(--accent-yellow);' : '');
        container.innerHTML += `
            <div class="fuel-item" style="margin-bottom: 25px;">
                <div class="fuel-header" style="font-size: 1rem;">
                    <span style="${txtClass}">${sat.id}</span>
                    <span style="${txtClass}">${sat.fuel.toFixed(1)}%</span>
                </div>
                <div class="fuel-track" style="height: 15px;">
                    <div class="fuel-fill ${fClass}" style="width: ${Math.max(0, sat.fuel)}%"></div>
                </div>
            </div>
        `;
    });
}

function populateReportsPage() {
    const el = document.getElementById('reports-content');
    if (!el) return;
    const activeRisks = alerts.length;
    let highRisks = alerts.filter(a => a.risk === 'HIGH').length;

    el.innerHTML = `
        <table class="data-table">
            <tbody>
                <tr>
                    <td><strong>Total Active Satellites</strong></td>
                    <td>${satellites.length}</td>
                </tr>
                <tr>
                    <td><strong>Total Tracked Debris</strong></td>
                    <td>${debrisObj.length}</td>
                </tr>
                <tr>
                    <td><strong>Active Collision Risks</strong></td>
                    <td>${activeRisks} <span style="margin-left:5px; color:var(--text-secondary); font-size:0.8em">(${highRisks} Critical)</span></td>
                </tr>
                <tr>
                    <td><strong>Scheduled Maneuvers</strong></td>
                    <td>${scheduledManeuversIds.size + globalManeuvers.length}</td>
                </tr>
                <tr>
                    <td><strong>Network Status</strong></td>
                    <td><span class="badge badge-low">NORMAL</span></td>
                </tr>
            </tbody>
        </table>
    `;
}

function updateFleetStats() {
    const el = document.getElementById('fleet-stats-body');
    if (!el) return;
    const normal = satellites.filter(s => s.status === 'Normal').length;
    const warning = satellites.filter(s => s.status === 'Warning').length;
    const critical = satellites.filter(s => s.status === 'Critical').length;
    const avgFuel = (satellites.reduce((s, sat) => s + sat.fuel, 0) / satellites.length).toFixed(1);
    const highRisks = alerts.filter(a => a.risk === 'HIGH').length;

    el.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(52,211,153,0.08); border-radius:8px; border-left:3px solid var(--accent-green);">
                <span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-satellite" style="margin-right:8px; color:var(--accent-green);"></i>Operational</span>
                <span style="font-weight:700; font-size:1.1rem; color:var(--accent-green);">${normal}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(245,158,11,0.08); border-radius:8px; border-left:3px solid var(--accent-yellow);">
                <span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px; color:var(--accent-yellow);"></i>Warning</span>
                <span style="font-weight:700; font-size:1.1rem; color:var(--accent-yellow);">${warning}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(239,68,68,0.08); border-radius:8px; border-left:3px solid var(--accent-red);">
                <span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-circle-xmark" style="margin-right:8px; color:var(--accent-red);"></i>Critical</span>
                <span style="font-weight:700; font-size:1.1rem; color:var(--accent-red);">${critical}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(14,165,233,0.08); border-radius:8px; border-left:3px solid var(--accent-blue);">
                <span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-bolt" style="margin-right:8px; color:var(--accent-blue);"></i>Avg Fuel</span>
                <span style="font-weight:700; font-size:1.1rem; color:var(--accent-blue);">${avgFuel}%</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(239,68,68,0.05); border-radius:8px; border-left:3px solid #555;">
                <span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-radiation" style="margin-right:8px; color:var(--accent-red);"></i>High Risks</span>
                <span style="font-weight:700; font-size:1.1rem; color:${highRisks > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">${highRisks}</span>
            </div>
        </div>
    `;
}

function initVisualization() {
    if (!viewArea) return;
    
    // Clear static HTML
    if (alertsTableBody) alertsTableBody.innerHTML = '';
    
    // Create SVG Overlay for collision lines
    if (!svgOverlay) {
        svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgOverlay.style.position = 'absolute';
        svgOverlay.style.top = '0';
        svgOverlay.style.left = '0';
        svgOverlay.style.width = '100%';
        svgOverlay.style.height = '100%';
        svgOverlay.style.pointerEvents = 'none';
        svgOverlay.style.zIndex = '2';
        viewArea.appendChild(svgOverlay);
    }
    
    satellites.forEach(sat => {
        const el = document.createElement('div');
        el.className = 'satellite-dot';
        el.setAttribute('data-id', sat.id);

        // Interaction
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.satellite-dot').forEach(d => d.classList.remove('active'));
            el.classList.add('active');
            updateTelemetryForActive(sat);
            showSatellitePopup(sat);
        });

        viewArea.appendChild(el);
        satElements[sat.id] = el;

        // Operational status label near satellite
        const label = document.createElement('div');
        label.className = 'sat-status-label';
        label.setAttribute('data-sat', sat.id);
        label.textContent = sat.operationalStatus || 'NOMINAL';
        viewArea.appendChild(label);
        satLabelElements[sat.id] = label;
    });

    debrisObj.forEach(deb => {
        const el = document.createElement('div');
        el.className = `debris-dot`;
        viewArea.appendChild(el);
        debrisElements[deb.id] = el;
    });

    viewArea.addEventListener('click', () => {
        const popup = document.getElementById('satellite-popup');
        if (popup) popup.classList.add('hidden');
        document.querySelectorAll('.satellite-dot').forEach(d => d.classList.remove('active'));
    });

    // Start Simulation Loops
    requestAnimationFrame(animateOrbits);
    setInterval(simulationStep, 1000);
}

// Popup functionality
function showSatellitePopup(sat) {
    const popup = document.getElementById('satellite-popup');
    if (!popup) return;

    document.getElementById('popup-title').innerHTML = `<i class="fa-solid fa-satellite"></i> ${sat.id}`;

    // Health status
    const statusEl = document.getElementById('popup-status');
    statusEl.textContent = sat.status;
    if (sat.status === 'Normal') statusEl.style.color = 'var(--accent-green)';
    else if (sat.status === 'Warning') statusEl.style.color = 'var(--accent-yellow)';
    else statusEl.style.color = 'var(--accent-red)';

    const tlm = getTelemetry(sat);
    document.getElementById('popup-orbit').textContent = `${tlm.orbit} km (x:${tlm.position.x}, y:${tlm.position.y})`;
    document.getElementById('popup-velocity').textContent = `${tlm.velocity} km/s`;

    const fuelEl = document.getElementById('popup-fuel');
    fuelEl.textContent = `${tlm.fuel}%`;
    if (sat.fuel < 20) fuelEl.style.color = 'var(--accent-red)';
    else if (sat.fuel < 50) fuelEl.style.color = 'var(--accent-yellow)';
    else fuelEl.style.color = 'var(--text-primary)';

    // Operational mode row (add/update dynamically)
    let modeRow = popup.querySelector('#popup-mode-row');
    if (!modeRow) {
        modeRow = document.createElement('p');
        modeRow.id = 'popup-mode-row';
        popup.querySelector('.popup-body').appendChild(modeRow);
    }
    const opStatus = sat.operationalStatus || 'NOMINAL';
    const modeColor = opStatus === 'NOMINAL' ? 'var(--accent-green)'
        : opStatus === 'MANEUVERING' ? 'var(--accent-blue)'
        : opStatus === 'STABILIZING' ? 'var(--accent-yellow)'
        : 'var(--accent-red)';
    modeRow.innerHTML = `<strong>Mode:</strong> <span style="color:${modeColor}; font-weight:700; font-family:'Fira Code',monospace; font-size:0.85rem;">${opStatus}</span>`;

    // TCA row – show nearest threat
    let tcaRow = popup.querySelector('#popup-tca-row');
    if (!tcaRow) {
        tcaRow = document.createElement('p');
        tcaRow.id = 'popup-tca-row';
        popup.querySelector('.popup-body').appendChild(tcaRow);
    }
    const nearestThreat = alerts.find(a => a.satId === sat.id && (a.risk === 'HIGH' || a.risk === 'MEDIUM'));
    if (nearestThreat) {
        const tcaColor = nearestThreat.risk === 'HIGH' ? 'var(--accent-red)' : 'var(--accent-yellow)';
        tcaRow.innerHTML = `<strong>TCA:</strong> <span style="color:${tcaColor}; font-weight:700;">${nearestThreat.tca}s</span> <span style="color:var(--text-secondary); font-size:0.78rem;">(vs ${nearestThreat.debId})</span>`;
    } else {
        tcaRow.innerHTML = `<strong>TCA:</strong> <span style="color:var(--accent-green);">— No threat</span>`;
    }

    popup.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('popup-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const popup = document.getElementById('satellite-popup');
            if (popup) popup.classList.add('hidden');
            document.querySelectorAll('.satellite-dot').forEach(d => d.classList.remove('active'));
        });
    }
});

// 2. Satellite and Debris Movement (Visual Smoothing)
function animateOrbits() {
    if (!viewArea) return;
    const cx = viewArea.clientWidth / 2;
    const cy = viewArea.clientHeight / 2;

    updateSatellitePositions(cx, cy);
    updateDebrisPositions(cx, cy);
    
    // Update collision lines Smoothly
    Object.keys(collisionLines).forEach(key => {
        const line = collisionLines[key];
        const pair = activeRiskPairs[key];
        if (line && pair) {
            line.setAttribute("x1", pair.sat.x);
            line.setAttribute("y1", pair.sat.y);
            line.setAttribute("x2", pair.deb.x);
            line.setAttribute("y2", pair.deb.y);
        }
    });

    requestAnimationFrame(animateOrbits);
}

function updateSatellitePositions(cx, cy) {
    satellites.forEach(sat => {
        sat.originalAngleOffset += sat.speed;
        if (sat.originalAngleOffset > Math.PI * 2) sat.originalAngleOffset -= Math.PI * 2;

        sat.angle += sat.speed;
        if (sat.angle > Math.PI * 2) sat.angle -= Math.PI * 2;

        sat.x = cx + sat.radius * Math.cos(sat.angle);
        sat.y = cy + sat.radius * Math.sin(sat.angle);

        const el = satElements[sat.id];
        if (el) {
            el.style.left = `${sat.x}px`;
            el.style.top = `${sat.y}px`;
            // Tint dot border by operational status
            el.style.boxShadow = sat.operationalStatus === 'MANEUVERING'
                ? '0 0 0 3px var(--accent-blue), 0 0 10px var(--accent-blue)'
                : sat.operationalStatus === 'STABILIZING'
                ? '0 0 0 3px var(--accent-yellow), 0 0 10px var(--accent-yellow)'
                : '';
        }

        // Update status label position
        const label = satLabelElements[sat.id];
        if (label) {
            label.style.left = `${sat.x + 10}px`;
            label.style.top  = `${sat.y - 18}px`;
            const op = sat.operationalStatus || 'NOMINAL';
            label.textContent = op;
            label.className = 'sat-status-label op-' + op.toLowerCase();
        }
    });
}

function updateDebrisPositions(cx, cy) {
    debrisObj.forEach(deb => {
        deb.angle += deb.speed;
        if (deb.angle > Math.PI * 2) deb.angle -= Math.PI * 2;
        if (deb.angle < 0) deb.angle += Math.PI * 2;
        
        deb.x = cx + deb.radius * Math.cos(deb.angle);
        deb.y = cy + deb.radius * Math.sin(deb.angle);
        
        const el = debrisElements[deb.id];
        if (el) {
            el.style.left = `${deb.x}px`;
            el.style.top = `${deb.y}px`;
            
            // 7. Highlight Dangerous Debris
            if (deb.isRisk) el.classList.add('risk');
            else el.classList.remove('risk');
        }
    });
}

// 2. Station Keeping / Orbit Recovery
function stabilizeOrbit(sat) {
    if (sat.safeTime > 10) {
        let angleDiff = sat.originalAngleOffset - sat.angle;
        while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const radiusDiff = Math.abs(sat.originalRadius - sat.radius);

        if (Math.abs(angleDiff) > 0.005 || radiusDiff > 0.5) {
            sat.radius += (sat.originalRadius - sat.radius) * 0.02;
            sat.angle  += angleDiff * 0.01;

            if (!sat.isStationKeeping) {
                sat.isStationKeeping = true;
                sat.operationalStatus = 'STABILIZING';
                logTelemetry(`ORBIT DEV  [${sat.id}]: Orbit deviation detected`);
                logTelemetry(`STATIONKEP [${sat.id}]: Initiating station keeping`);
                logTelemetry(`RETURNING  [${sat.id}]: STABILIZING ORBIT — returning to assigned slot`);
            }
        } else {
            // Fully recovered
            if (sat.isStationKeeping) {
                logTelemetry(`ORBIT OK   [${sat.id}]: Orbit stabilized — RETURNING TO SLOT complete`);
                logTelemetry(`STATIONKEP [${sat.id}]: Station keeping complete`);
                // Restore status only if sat wasn't Warning/Critical from fuel
                if (sat.operationalStatus === 'STABILIZING') {
                    sat.operationalStatus = sat.fuel < 20 ? 'WARNING' :
                                            sat.fuel < 50 ? 'WARNING' : 'NOMINAL';
                }
            }
            sat.radius = sat.originalRadius;
            sat.angle  = sat.originalAngleOffset;
            sat.isStationKeeping = false;
        }
    } else {
        // Risk still active — don't stabilize yet
        if (!sat.isStationKeeping && sat.operationalStatus === 'STABILIZING') {
            // keep as is
        }
        sat.isStationKeeping = false;
    }
}

// 1. Simulation Engine (Logic Tick)
function simulationStep() {
    // 3. Collision Detection
    detectCollisions();

    // 4. Stabilize Mission Feed
    satellites.forEach(sat => stabilizeOrbit(sat));

    const backendBadge = document.getElementById('backend-status');
    if (backendBadge) {
        // Build payload mapped to backend API requirements
        const payload = {
            timestamp: new Date().toISOString(),
            objects: [
                ...satellites.map(s => ({
                    id: s.id,
                    type: 'SATELLITE',
                    position: { x: s.x, y: s.y },
                    velocity: { vx: Math.cos(s.angle) * s.speed, vy: Math.sin(s.angle) * s.speed }
                })),
                ...debrisObj.map(d => ({
                    id: d.id,
                    type: 'DEBRIS',
                    position: { x: d.x, y: d.y },
                    velocity: { vx: Math.cos(d.angle) * d.speed, vy: Math.sin(d.angle) * d.speed }
                }))
            ]
        };

        fetch("http://localhost:8000/api/telemetry", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "ACK") {
                backendBadge.className = 'backend-badge connected';
                backendBadge.innerHTML = '<span class="status-dot-small"></span> Backend: CONNECTED';
                // Log backend ACK every ~10 ticks to avoid flooding
                if (!simulationStep._apiLogCount) simulationStep._apiLogCount = 0;
                simulationStep._apiLogCount++;
                if (simulationStep._apiLogCount % 10 === 1) {
                    logTelemetry(`API: Telemetry sent to backend — ACK received (${payload.objects.length} objects)`);
                }
            }
        })
        .catch(() => {
            backendBadge.className = 'backend-badge disconnected';
            backendBadge.innerHTML = '<span class="status-dot-small"></span> Backend: DISCONNECTED';
        });
    }

    // Update UI Panels
    if(document.getElementById('satellites-page') && document.getElementById('satellites-page').classList.contains('active')) populateSatellitesPage();
    if(document.getElementById('debris-page') && document.getElementById('debris-page').classList.contains('active')) populateDebrisPage();
    if(document.getElementById('reports-page') && document.getElementById('reports-page').classList.contains('active')) populateReportsPage();
    if(document.getElementById('maneuver-page') && document.getElementById('maneuver-page').classList.contains('active')) populateManeuverPage();
    if(document.getElementById('fuel-page') && document.getElementById('fuel-page').classList.contains('active')) populateFuelPage();
    updateFleetStats();
}

function drawCollisionLine(sat, deb, riskLevel) {
    if (!svgOverlay) return;
    const key = `${sat.id}-${deb.id}`;
    let line = collisionLines[key];

    if (!line) {
        line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        svgOverlay.appendChild(line);
        collisionLines[key] = line;
        activeRiskPairs[key] = { sat, deb };
    }

    line.setAttribute("x1", sat.x);
    line.setAttribute("y1", sat.y);
    line.setAttribute("x2", deb.x);
    line.setAttribute("y2", deb.y);

    // HIGH = thick red dashed | MEDIUM = thin yellow dashed
    if (riskLevel === 'HIGH') {
        line.setAttribute("stroke", '#ef4444');
        line.setAttribute("stroke-width", "2.5");
        line.setAttribute("stroke-dasharray", "8,4");
        line.setAttribute("opacity", "0.85");
    } else {
        line.setAttribute("stroke", '#fbbf24');
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "5,5");
        line.setAttribute("opacity", "0.6");
    }
}

// 1. Collision Detection System
function detectCollisions() {
    const thresholdHigh = 30;
    const thresholdMedium = 60;
    const thresholdLow = 100;
    const newAlerts = [];
    const currentRiskIds = new Set();
    
    // Reset risks
    debrisObj.forEach(deb => {
        deb.isRisk = false;
        deb.riskLevel = 'NONE';
    });

    // Increment safe time
    satellites.forEach(sat => sat.safeTime += 1);

    satellites.forEach(sat => {
        debrisObj.forEach(deb => {
            // Predict future positions
            const futureSatX = sat.x + Math.cos(sat.angle) * 20;
            const futureSatY = sat.y + Math.sin(sat.angle) * 20;

            const futureDebX = deb.x + Math.cos(deb.angle) * 20;
            const futureDebY = deb.y + Math.sin(deb.angle) * 20;

            const dx = futureSatX - futureDebX;
            const dy = futureSatY - futureDebY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < thresholdLow) {
                let riskLevel = 'LOW';
                const tca = calculateTCA(sat, deb);
                const pairKey = `${sat.id}-${deb.id}`;

                if (distance < thresholdHigh) {
                    riskLevel = 'HIGH';
                    deb.isRisk = true;
                    sat.safeTime = 0;

                    // First-time HIGH collision announcement
                    if (!announcedCollisions.has(pairKey)) {
                        announcedCollisions.add(pairKey);
                        logTelemetry(`⚠ COLLISION predicted: ${sat.id} ↔ ${deb.id} | Dist: ${distance.toFixed(1)}px`);
                        logTelemetry(`⏱ TCA: ${tca} seconds to closest approach`);
                        setTimeout(() => announcedCollisions.delete(pairKey), 30000);
                    }

                    if (!scheduledManeuversIds.has(pairKey)) {
                        scheduleManeuver(sat, deb, tca);
                        scheduledManeuversIds.add(pairKey);
                        setTimeout(() => scheduledManeuversIds.delete(pairKey), 30000);
                    }

                } else if (distance < thresholdMedium) {
                    riskLevel = 'MEDIUM';
                    sat.safeTime = 0;

                    // First-time MEDIUM warning
                    if (!announcedCollisions.has(pairKey + '_med')) {
                        announcedCollisions.add(pairKey + '_med');
                        logTelemetry(`⚠ PROXIMITY alert: ${sat.id} ↔ ${deb.id} | Risk: MEDIUM | TCA: ${tca}s`);
                        setTimeout(() => announcedCollisions.delete(pairKey + '_med'), 15000);
                    }
                }

                const order = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'NONE': 0 };
                if (order[riskLevel] > order[deb.riskLevel]) deb.riskLevel = riskLevel;

                if (riskLevel === 'HIGH' || riskLevel === 'MEDIUM') {
                    drawCollisionLine(sat, deb, riskLevel);
                    currentRiskIds.add(pairKey);
                } else {
                    // LOW risk cleared — log avoidance once
                    if (announcedAvoidances.has(pairKey)) {
                        announcedAvoidances.delete(pairKey);
                        logTelemetry(`✓ COLLISION AVOIDED: ${sat.id} safe from ${deb.id}`);
                    }
                }

                newAlerts.push({
                    satId: sat.id,
                    debId: deb.id,
                    distance: distance.toFixed(1),
                    risk: riskLevel,
                    tca: tca
                });
            }
        });
    });
    
    // Deduplicate and rank alerts by risk
    const riskWeight = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    newAlerts.sort((a, b) => riskWeight[b.risk] - riskWeight[a.risk] || a.distance - b.distance);
    
    // Slice to top 5 alerts to prevent UI overflow
    const topAlerts = newAlerts.slice(0, 5);

    // Update badge alert count
    const badge = document.querySelector('.alerts-badge');
    if (badge) badge.textContent = newAlerts.length;

    // Update table only if data changes
    if (JSON.stringify(alerts) !== JSON.stringify(topAlerts)) {
        alerts = topAlerts;
        updateAlertsTable();
        updateAlertsDropdown();
    }
    
    // Remove lines for risks that no longer exist
    Object.keys(collisionLines).forEach(key => {
        if (!currentRiskIds.has(key)) {
            if (collisionLines[key] && collisionLines[key].parentNode) {
                collisionLines[key].parentNode.removeChild(collisionLines[key]);
            }
            delete collisionLines[key];
            delete activeRiskPairs[key];
        }
    });
}

// 2. Dynamic Alerts Table
function updateAlertsTable() {
    if (!alertsTableBody) return;
    alertsTableBody.innerHTML = '';
    
    if (alerts.length === 0) {
        alertsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No active collision risks.</td></tr>';
        return;
    }

    alerts.forEach(alert => {
        const tr = document.createElement('tr');
        let badgeClass = 'badge-low';
        if (alert.risk === 'HIGH') badgeClass = 'badge-high';
        else if (alert.risk === 'MEDIUM') badgeClass = 'badge-medium';
        
        tr.innerHTML = `
            <td>${alert.satId}</td>
            <td>${alert.debId}</td>
            <td>${alert.distance} px</td>
            <td><span class="badge ${badgeClass}">${alert.risk}</span></td>
            <td>${alert.tca !== undefined ? alert.tca + 's' : '-'}</td>
        `;
        alertsTableBody.appendChild(tr);
    });
}

// 3. Dynamic Alerts Dropdown
function updateAlertsDropdown() {
    const dropdownBody = document.getElementById('alerts-dropdown-body');
    if (!dropdownBody) return;
    
    dropdownBody.innerHTML = '';
    
    if (alerts.length === 0) {
        dropdownBody.innerHTML = '<div class="empty-alerts">System Normal. No active alerts.</div>';
        return;
    }
    
    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.className = 'dropdown-alert-item';
        
        let riskClass = 'low';
        let alertIcon = 'fa-info-circle';
        if (alert.risk === 'HIGH') {
            riskClass = 'high';
            alertIcon = 'fa-triangle-exclamation';
        } else if (alert.risk === 'MEDIUM') {
             riskClass = 'medium';
             alertIcon = 'fa-exclamation-circle';
        }
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        const tcaText = alert.tca !== undefined ? ` | TCA: ${alert.tca}s` : '';
        
        item.innerHTML = `
            <div class="dropdown-alert-title ${riskClass}">
                <span><i class="fa-solid ${alertIcon}"></i> Risk: ${alert.risk}</span>
                <span class="dropdown-alert-time">${timeStr}</span>
            </div>
            <div class="dropdown-alert-desc">
                ${alert.satId} and ${alert.debId} converging at ${alert.distance}px${tcaText}.
            </div>
        `;
        dropdownBody.appendChild(item);
    });
}

// 5. Autonomous Maneuver Planning
function scheduleManeuver(sat, deb, tca) {
    const deltaV = (Math.random() * 2 + 0.5).toFixed(2);
    const burnDuration = Math.floor(Math.random() * 20 + 5);

    // Mark as MANEUVERING
    sat.operationalStatus = 'MANEUVERING';

    // Event-chain telemetry logs
    logTelemetry(`► ALERT     [${sat.id}]: Collision risk HIGH with ${deb.id}`);
    logTelemetry(`► PREDICT   [${sat.id}]: TCA = ${tca !== undefined ? tca : '?'} seconds`);
    logTelemetry(`► MANEUVER  [${sat.id}]: Executing avoidance maneuver`);
    logTelemetry(`► THRUST    [${sat.id}]: Applying Δv = ${deltaV} m/s | Burn = ${burnDuration}s`);

    // Thruster Burn — orbit deviation
    const directionX = sat.x - deb.x;
    const directionY = sat.y - deb.y;
    const mag = Math.sqrt(directionX * directionX + directionY * directionY);

    if (mag > 0) {
        const unitX = directionX / mag;
        const unitY = directionY / mag;
        sat.radius += unitX * 5;
        sat.angle  += unitY * 0.05;
        logTelemetry(`► ORBIT DEV [${sat.id}]: Orbit deviation applied`);
    }

    // Post maneuver to backend
    fetch('http://localhost:8000/api/maneuver/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            satelliteId: sat.id,
            deltaV: { x: parseFloat(deltaV), y: 0 },
            burnTime: new Date(Date.now() + (tca || 30) * 1000).toISOString()
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'SCHEDULED') {
            logTelemetry(`API: Maneuver scheduled via backend — ${sat.id} | Status: SCHEDULED`);
        }
    })
    .catch(() => {});

    const m = Math.floor(Math.random() * 15 + 1).toString().padStart(2, '0');
    const s = Math.floor(Math.random() * 60).toString().padStart(2, '0');
    const timeStr = `T-Minus 00:${m}:${s}`;

    globalManeuvers.unshift({ satId: sat.id, debId: deb.id, deltaV, burnDuration, time: timeStr });

    if (maneuverTimeline) {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-time">${timeStr}</div>
            <div class="timeline-content">Auto Avoidance Burn</div>
            <div class="timeline-meta">
                <span><i class="fa-solid fa-satellite"></i> ${sat.id}</span>
                <span>Δv: ${deltaV} m/s</span>
                <span>Burn: ${burnDuration}s</span>
            </div>
        `;
        maneuverTimeline.prepend(item);
        if (maneuverTimeline.children.length > 4) {
            maneuverTimeline.removeChild(maneuverTimeline.lastChild);
        }
    }

    // Track that this pair had avoidance so we can log "avoided" later
    announcedAvoidances.add(`${sat.id}-${deb.id}`);

    updateFuelLevels(sat, deltaV);

    if (document.getElementById('maneuver-page').classList.contains('active')) {
        populateManeuverPage();
    }
}

// 6. Fuel Consumption with before/after logging
function updateFuelLevels(sat, deltaV) {
    const fuelBefore = sat.fuel;
    const fuelUsed   = parseFloat(deltaV) * 0.5;
    sat.fuel -= fuelUsed;
    if (sat.fuel < 0) sat.fuel = 0;
    const fuelAfter = sat.fuel;

    const prevStatus = sat.status;
    if (fuelAfter < 20)      sat.status = 'Critical';
    else if (fuelAfter < 50) sat.status = 'Warning';

    // Update operational status if fuel drops
    if (sat.status !== 'Normal' && sat.operationalStatus === 'NOMINAL') {
        sat.operationalStatus = 'WARNING';
    }

    // Fuel before/after telemetry log
    const changeColor = fuelAfter < 20 ? 'var(--accent-red)' : 'var(--accent-yellow)';
    logTelemetry(`FUEL UPDATE [${sat.id}]: ${fuelBefore.toFixed(1)}% → ${fuelAfter.toFixed(1)}% (consumed ${fuelUsed.toFixed(1)}%)`);
    if (sat.status !== prevStatus) {
        logTelemetry(`FUEL WARN   [${sat.id}]: Status changed → ${sat.status.toUpperCase()}`);
    }

    // Update visual fuel gauge
    const fuelCards = document.querySelectorAll('.fuel-item');
    fuelCards.forEach(card => {
        const header = card.querySelector('.fuel-header span:first-child');
        if (header && header.textContent.includes(sat.id)) {
            const pctSpan = card.querySelector('.fuel-header span:last-child');
            const fill    = card.querySelector('.fuel-fill');

            // Show before → after in the gauge header
            pctSpan.innerHTML = `<span style="color:var(--text-secondary);font-size:0.8em;">${fuelBefore.toFixed(1)}%</span> → <span>${fuelAfter.toFixed(1)}%</span>`;
            pctSpan.style.color = fuelAfter < 20 ? 'var(--accent-red)' : fuelAfter < 50 ? 'var(--accent-yellow)' : '';
            fill.style.width = `${Math.max(0, fuelAfter)}%`;

            fill.className = 'fuel-fill';
            if (sat.status === 'Warning')  fill.classList.add('warning');
            if (sat.status === 'Critical') fill.classList.add('critical');

            if (sat.status === 'Critical') header.style.color = 'var(--accent-red)';
            else if (sat.status === 'Warning') header.style.color = 'var(--accent-yellow)';
        }
    });

    if (document.getElementById('fuel-page').classList.contains('active')) {
        populateFuelPage();
    }
}

// 6. Improve Telemetry Feed Writer
function logTelemetry(msg) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const formattedMsg = `<span class="term-prefix">[${timeStr}]</span> ${msg}`;

    function typeLine(container, limit) {
        if (!container) return;
        const line = document.createElement('div');
        line.className = 'term-line new';
        line.innerHTML = `<span class="term-prefix">[${timeStr}]</span> ${msg}`;
        container.prepend(line);
        if (container.children.length > limit) {
            container.removeChild(container.lastChild);
        }
        
        setTimeout(() => {
            if (line) line.classList.remove('new');
        }, 500);
    }
    
    typeLine(terminalContent, 30);
    typeLine(fullTelemetryContent, 100);
}

// 8. Telemetry Feed Improvements
setInterval(() => {
    const activeSatActiveEl = document.querySelector('.satellite-dot.active');
    let activeId = satellites[0].id;
    if(activeSatActiveEl) {
        activeId = activeSatActiveEl.getAttribute('data-id');
    }
    
    const sat = satellites.find(s => s.id === activeId);
    if(sat) {
        const tlm = getTelemetry(sat);
        const hasManeuver = Array.from(scheduledManeuversIds).some(id => id.startsWith(sat.id));
        const maneuverStatus = hasManeuver ? 'PENDING BURN' : 'STABLE';
        
        const riskAlert = alerts.find(a => a.satId === sat.id);
        const tcaStr = riskAlert && riskAlert.tca !== undefined ? ` | TCA: ${riskAlert.tca} sec` : '';
        
        logTelemetry(`TLM ${sat.id} | POS x:${tlm.position.x} y:${tlm.position.y} | VEL: ${tlm.velocity} km/s | FUEL: ${tlm.fuel}%${tcaStr}`);
    } else {
        const randSat = satellites[Math.floor(Math.random() * satellites.length)];
        logTelemetry(`BEACON ${randSat.id} ping received OK.`);
    }
}, 3000);

function updateTelemetryForActive(sat) {
    logTelemetry(`SYS Switched tracking to ${sat.id}`);
}

window.addEventListener('DOMContentLoaded', () => {
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Navigation logic: sidebar links
    document.querySelectorAll('.nav-link[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.getAttribute('data-page');
            if (pageId && typeof switchPage === 'function') {
                switchPage(pageId, link);
            }
        });
    });

    // ===================================================
    // SEARCH BOX — backend-first, local-data fallback
    // ===================================================
    const searchInput = document.getElementById('global-search');
    const searchResults = document.getElementById('search-results');
    let searchDebounceTimer = null;
    let lastBackendOnline = false;

    // Pages that can be navigated to via search
    const PAGES = [
        { id: 'dashboard-page',  label: 'Dashboard Overview',   icon: 'fa-gauge-high',      keywords: ['dashboard', 'overview', 'home', 'main', 'orbit', 'live'] },
        { id: 'satellites-page', label: 'Fleet Status',          icon: 'fa-satellite',       keywords: ['satellite', 'fleet', 'sat', 'alpha', 'beta', 'gamma', 'delta', 'echo'] },
        { id: 'debris-page',     label: 'Debris Tracking',       icon: 'fa-meteor',          keywords: ['debris', 'meteor', 'junk', 'deb', 'risk', 'hazard', 'track'] },
        { id: 'maneuver-page',   label: 'Operations / Maneuvers',icon: 'fa-route',           keywords: ['maneuver', 'operation', 'burn', 'avoidance', 'deltav', 'command'] },
        { id: 'telemetry-page',  label: 'Telemetry Stream',      icon: 'fa-satellite-dish',  keywords: ['telemetry', 'stream', 'signal', 'feed', 'log', 'data'] },
        { id: 'fuel-page',       label: 'Energy Reserves',       icon: 'fa-bolt',            keywords: ['fuel', 'energy', 'power', 'reserve', 'propellant', 'reactor'] },
        { id: 'reports-page',    label: 'System Reports',        icon: 'fa-file-lines',      keywords: ['report', 'status', 'summary', 'stats', 'health', 'system'] },
    ];

    function buildLocalResults(query) {
        const results = [];
        const q = query.toLowerCase();

        // Match pages first
        PAGES.forEach(page => {
            if (page.keywords.some(kw => kw.includes(q) || q.includes(kw.substring(0, 3)))) {
                results.push({ _type: 'PAGE', page });
            }
        });

        // Match satellites
        satellites.forEach(sat => {
            if (sat.id.toLowerCase().includes(q)) {
                results.push({ _type: 'SATELLITE', sat });
            }
        });

        // Match debris
        debrisObj.forEach(deb => {
            if (deb.id.toLowerCase().includes(q)) {
                results.push({ _type: 'DEBRIS', deb });
            }
        });

        // Match maneuvers
        globalManeuvers.forEach(m => {
            if (m.satId.toLowerCase().includes(q) || 'maneuver'.includes(q)) {
                results.push({ _type: 'MANEUVER', m });
            }
        });

        return results;
    }

    function renderResults(items, query, source) {
        if (!searchResults) return;
        if (items.length === 0) {
            searchResults.innerHTML = `
                <div style="padding:18px 16px; text-align:center;">
                    <div style="font-size:1.6rem; margin-bottom:8px;">🛰️</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem;">No objects matching <strong style="color:#fff">"${query}"</strong></div>
                    <div style="color:#4b6080; font-size:0.75rem; margin-top:6px;">Try: SAT, DEB, dashboard, fuel, maneuver…</div>
                </div>`;
            searchResults.classList.remove('hidden');
            return;
        }

        const sourceLabel = source === 'backend'
            ? `<span style="color:var(--accent-green);font-size:0.7rem;">● LIVE</span>`
            : `<span style="color:var(--accent-yellow);font-size:0.7rem;">● LOCAL</span>`;

        let html = `<div style="padding:8px 14px 6px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:0.72rem; color:var(--text-secondary); letter-spacing:1px;">RESULTS (${items.length})</span>
            ${sourceLabel}
        </div>`;

        items.slice(0, 12).forEach(item => {
            if (item._type === 'PAGE') {
                const p = item.page;
                html += `
                <div class="search-result-item" onclick="executeSearchNavigate('${p.id}', '${p.label}')">
                    <div class="search-result-title">
                        <span><i class="fa-solid ${p.icon}" style="margin-right:8px; color:var(--accent-blue);"></i>${p.label}</span>
                        <span class="search-result-badge" style="background:rgba(56,189,248,0.2); color:var(--accent-blue);">PAGE</span>
                    </div>
                    <div class="search-result-desc">Navigate to this section</div>
                </div>`;
            } else if (item._type === 'SATELLITE') {
                const s = item.sat;
                const badgeCls = s.status === 'Normal' ? '#34d399' : s.status === 'Warning' ? '#fbbf24' : '#f87171';
                const vel = Math.abs(s.radius * s.speed * 60).toFixed(2);
                html += `
                <div class="search-result-item" onclick="executeSearchNavigate('satellites-page', '${s.id}')">
                    <div class="search-result-title">
                        <span><i class="fa-solid fa-satellite" style="margin-right:8px; color:var(--accent-blue);"></i>${s.id}</span>
                        <span class="search-result-badge">SATELLITE</span>
                    </div>
                    <div class="search-result-desc">
                        Status: <span style="color:${badgeCls};font-weight:600;">${s.status}</span> &nbsp;|&nbsp;
                        Orbit: ${s.radius.toFixed(0)} km &nbsp;|&nbsp;
                        Vel: ${vel} km/s &nbsp;|&nbsp;
                        Fuel: ${s.fuel.toFixed(1)}%
                    </div>
                </div>`;
            } else if (item._type === 'DEBRIS') {
                const d = item.deb;
                const riskColor = d.riskLevel === 'HIGH' ? '#f87171' : d.riskLevel === 'MEDIUM' ? '#fbbf24' : '#34d399';
                html += `
                <div class="search-result-item" onclick="executeSearchNavigate('debris-page', '${d.id}')">
                    <div class="search-result-title">
                        <span><i class="fa-solid fa-meteor" style="margin-right:8px; color:#fbbf24;"></i>${d.id}</span>
                        <span class="search-result-badge" style="background:rgba(251,191,36,0.2); color:#fbbf24;">DEBRIS</span>
                    </div>
                    <div class="search-result-desc">
                        Risk: <span style="color:${riskColor};font-weight:600;">${d.riskLevel || 'NONE'}</span> &nbsp;|&nbsp;
                        Orbit: ${d.radius.toFixed(0)} km
                    </div>
                </div>`;
            } else if (item._type === 'MANEUVER') {
                const m = item.m;
                html += `
                <div class="search-result-item" onclick="executeSearchNavigate('maneuver-page', '${m.satId}')">
                    <div class="search-result-title">
                        <span><i class="fa-solid fa-route" style="margin-right:8px; color:var(--accent-green);"></i>Maneuver → ${m.satId}</span>
                        <span class="search-result-badge" style="background:rgba(52,211,153,0.2); color:var(--accent-green);">MANEUVER</span>
                    </div>
                    <div class="search-result-desc">Δv: ${m.deltaV} m/s &nbsp;|&nbsp; Burn: ${m.burnDuration}s &nbsp;|&nbsp; ${m.time}</div>
                </div>`;
            }
        });

        searchResults.innerHTML = html;
        searchResults.classList.remove('hidden');
    }

    function performSearch(query) {
        if (query.length < 1) {
            searchResults.classList.add('hidden');
            return;
        }

        // Show loading state
        searchResults.innerHTML = `
            <div style="padding:14px 16px; display:flex; align-items:center; gap:10px; color:var(--text-secondary); font-size:0.85rem;">
                <div style="width:12px; height:12px; border:2px solid var(--accent-blue); border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite;"></div>
                Querying backend...
            </div>`;
        searchResults.classList.remove('hidden');

        const backendBadge = document.getElementById('backend-status');
        const isConnected = backendBadge && backendBadge.classList.contains('connected');

        if (isConnected) {
            // Query backend search API
            fetch(`http://localhost:8000/api/search?q=${encodeURIComponent(query)}`)
                .then(r => r.json())
                .then(data => {
                    // Merge backend results with local frontend data
                    const localItems = buildLocalResults(query);
                    // Backend gives us enrichment; local items carry UI-state (fuel, status etc)
                    // Keep all local items as the source of truth for display
                    renderResults(localItems, query, 'backend');
                    logTelemetry(`SEARCH [BACKEND] "${query}" → ${data.count} server objects, ${localItems.length} UI matches`);
                })
                .catch(() => {
                    // Backend unreachable, fall back to local
                    const localItems = buildLocalResults(query);
                    renderResults(localItems, query, 'local');
                });
        } else {
            // Offline — use local data instantly
            const localItems = buildLocalResults(query);
            renderResults(localItems, query, 'local');
        }
    }

    if (searchInput && searchResults) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            const query = e.target.value.trim();
            if (query.length < 1) {
                searchResults.classList.add('hidden');
                return;
            }
            // Debounce 250ms
            searchDebounceTimer = setTimeout(() => performSearch(query), 250);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchResults.classList.add('hidden');
                searchInput.blur();
            }
            // Enter key: navigate to first result
            if (e.key === 'Enter') {
                const first = searchResults.querySelector('.search-result-item');
                if (first) first.click();
            }
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        });
    }

    // Global helper for search navigation
    window.executeSearchNavigate = function(pageId, label) {
        if (searchInput) searchInput.value = '';
        if (searchResults) searchResults.classList.add('hidden');
        if (typeof switchPage === 'function') switchPage(pageId, null);
        if (typeof logTelemetry === 'function') logTelemetry(`SEARCH Navigate → [${label}]`);
    };

    // Dropdown toggle logic
    const alertsBtn = document.getElementById('alerts-btn');
    const alertsDropdown = document.getElementById('alerts-dropdown');
    if (alertsBtn && alertsDropdown) {
        alertsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            alertsDropdown.classList.toggle('hidden');
        });
        
        document.addEventListener('click', (e) => {
            if (!alertsDropdown.contains(e.target) && !alertsBtn.contains(e.target)) {
                alertsDropdown.classList.add('hidden');
            }
        });
    }

    // Mission Clock Tracking
    setInterval(() => {
        const utcEl = document.getElementById('clock-utc');
        if(utcEl) {
            const now = new Date();
            const hrs = now.getUTCHours().toString().padStart(2, '0');
            const mins = now.getUTCMinutes().toString().padStart(2, '0');
            const secs = now.getUTCSeconds().toString().padStart(2, '0');
            utcEl.innerText = `UTC ${hrs}:${mins}:${secs}`;
        }
    }, 1000);

    initVisualization();
    logTelemetry("SYS Initializing Autonomous Constellation Manager...");
    logTelemetry("SYS Connecting to deep space network...");
    logTelemetry("SYS Link established. Receiving telemetry data stream.");

    // Select first sat by default
    if (satElements[satellites[0].id]) {
        satElements[satellites[0].id].classList.add('active');
    }

    // ===================================================
    // BACKEND STATS POLLING — every 10 seconds
    // ===================================================
    function pollBackendStats() {
        const backendBadge = document.getElementById('backend-status');
        if (!backendBadge) return;

        const t0 = performance.now();
        fetch('http://localhost:8000/api/stats')
            .then(r => r.json())
            .then(data => {
                const latency = Math.round(performance.now() - t0);
                backendBadge.className = 'backend-badge connected';
                backendBadge.title = `Uptime: ${Math.floor(data.uptime_seconds / 60)}m ${data.uptime_seconds % 60}s | Latency: ${latency}ms`;
                backendBadge.innerHTML = `
                    <span class="status-dot-small"></span>
                    BACKEND: LIVE
                    <span style="font-family:'Fira Code',monospace; font-size:0.7rem; color:var(--accent-blue); margin-left:4px;">${latency}ms</span>`;
                logTelemetry(`BACKEND Stats: ${data.total_satellites} SATs | ${data.total_debris} DEB | ${data.pending_maneuvers} MNVs | Latency ${latency}ms`);
            })
            .catch(() => {
                backendBadge.className = 'backend-badge disconnected';
                backendBadge.title = 'Backend unreachable';
                backendBadge.innerHTML = '<span class="status-dot-small"></span> DISCONNECTED';
            });
    }

    // Initial poll + schedule
    setTimeout(pollBackendStats, 1500);
    setInterval(pollBackendStats, 10000);

    // ===================================================
    // FRONTEND → BACKEND LOG BRIDGE
    // Sends critical events to /api/telemetry/log
    // ===================================================
    const _origLog = window.logTelemetry || logTelemetry;
    window._bridgeLog = function(msg) {
        const backendBadge = document.getElementById('backend-status');
        const isConnected = backendBadge && backendBadge.classList.contains('connected');
        if (isConnected && (msg.startsWith('MANEUVER') || msg.startsWith('SEARCH') || msg.startsWith('SYS'))) {
            fetch('http://localhost:8000/api/telemetry/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, level: 'INFO' })
            }).catch(() => {}); // fire-and-forget
        }
    };
});
