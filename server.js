const express = require('express');
const cors = require('cors');

const path = require('path');

const app = express();
const PORT = 8000;
const HOST = '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-Memory Storage
let satellites = [];
let debrisArray = [];
let maneuvers = [];
let globalTimestamp = new Date().toISOString();
const serverStartTime = Date.now();

// Helper: Collision detection (very basic distance check)
function detectSimulatedCollisions() {
    let collisions = 0;
    satellites.forEach(sat => {
        debrisArray.forEach(deb => {
            if (sat.position && deb.position) {
                const dx = sat.position.x - deb.position.x;
                const dy = sat.position.y - deb.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 5) collisions++; // arbitrary collision threshold
            }
        });
    });
    return collisions;
}

// ==========================================
// MANDATORY APIs
// ==========================================

// A. Telemetry Ingestion API
app.post('/api/telemetry', (req, res) => {
    const { timestamp, objects } = req.body;
    
    if (!objects || !Array.isArray(objects)) {
        return res.status(400).json({ error: "Invalid payload format. 'objects' array is required." });
    }

    if (timestamp) globalTimestamp = timestamp;
    
    let processed = 0;
    
    objects.forEach(obj => {
        if (obj.type === 'SATELLITE') {
            const index = satellites.findIndex(s => s.id === obj.id);
            if (index > -1) satellites[index] = obj;
            else satellites.push(obj);
        } else if (obj.type === 'DEBRIS') {
            const index = debrisArray.findIndex(d => d.id === obj.id);
            if (index > -1) debrisArray[index] = obj;
            else debrisArray.push(obj);
        }
        processed++;
    });

    console.log(`[TELEMETRY] Ingested ${processed} objects at ${globalTimestamp}`);

    res.json({
        status: "ACK",
        processed_count: processed,
        active_cdm_warnings: detectSimulatedCollisions()
    });
});

// B. Maneuver Scheduling API
app.post('/api/maneuver/schedule', (req, res) => {
    const { satelliteId, deltaV, burnTime } = req.body;

    if (!satelliteId || !deltaV || !burnTime) {
        return res.status(400).json({ error: "Missing required maneuver parameters." });
    }

    const maneuverRecord = {
        id: `MNV-${Date.now()}`,
        satelliteId,
        deltaV,
        burnTime,
        status: "PENDING"
    };
    maneuvers.push(maneuverRecord);

    console.log(`[MANEUVER] Scheduled burn for ${satelliteId} at ${burnTime}`);

    // Simulate validation rules
    res.json({
        status: "SCHEDULED",
        validation: {
            ground_station_los: true,
            sufficient_fuel: true,
            projected_mass_remaining: 500
        }
    });
});

// C. Simulation Step API
app.post('/api/simulate/step', (req, res) => {
    const { step_seconds } = req.body;
    const timeDelta = step_seconds || 60;

    // Advance clock
    let currentDate = new Date(globalTimestamp);
    currentDate.setSeconds(currentDate.getSeconds() + timeDelta);
    globalTimestamp = currentDate.toISOString();

    // Update positions via basic Euler integration (p' = p + v*dt)
    [...satellites, ...debrisArray].forEach(entity => {
        if (entity.position && entity.velocity) {
            entity.position.x += (entity.velocity.vx || 0) * timeDelta;
            entity.position.y += (entity.velocity.vy || 0) * timeDelta;
        }
    });

    // Count maneuvers that would have executed in this step
    let maneuversExecuted = 0;
    maneuvers = maneuvers.filter(m => {
        if (m.status === "PENDING" && new Date(m.burnTime) <= currentDate) {
            maneuversExecuted++;
            // Apply deltaV to satellite velocity directly as a simple physics simulation
            const sat = satellites.find(s => s.id === m.satelliteId);
            if (sat && sat.velocity) {
                sat.velocity.vx += m.deltaV.x || 0;
                sat.velocity.vy += m.deltaV.y || 0;
            }
            return false; // remove from pending
        }
        return true; 
    });

    const collisionsDetected = detectSimulatedCollisions();

    console.log(`[SIMULATION] Stepped ${timeDelta}s to ${globalTimestamp}. Collisions: ${collisionsDetected}, MNVs executed: ${maneuversExecuted}`);

    res.json({
        status: "STEP_COMPLETE",
        new_timestamp: globalTimestamp,
        collisions_detected: collisionsDetected,
        maneuvers_executed: maneuversExecuted
    });
});

// D. Health Check API
app.get('/', (req, res) => {
    res.json({
        status: "Backend Running"
    });
});


// ==========================================
// OPTIONAL APIs
// ==========================================

// 4. Memory Snapshot
app.get('/api/visualization/snapshot', (req, res) => {
    res.json({
        timestamp: globalTimestamp,
        satellites: satellites,
        debris_cloud: debrisArray
    });
});

// 5. Full-Text Search API
app.get('/api/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query || query.length < 1) {
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
    }

    const results = [];

    // Search satellites
    satellites.forEach(sat => {
        const searchable = `${sat.id} ${sat.type || 'SATELLITE'}`.toLowerCase();
        if (searchable.includes(query)) {
            results.push({
                type: 'SATELLITE',
                id: sat.id,
                position: sat.position,
                velocity: sat.velocity
            });
        }
    });

    // Search debris
    debrisArray.forEach(deb => {
        const searchable = `${deb.id} ${deb.type || 'DEBRIS'}`.toLowerCase();
        if (searchable.includes(query)) {
            results.push({
                type: 'DEBRIS',
                id: deb.id,
                position: deb.position,
                velocity: deb.velocity
            });
        }
    });

    // Search maneuvers
    maneuvers.forEach(mnv => {
        const searchable = `${mnv.id} ${mnv.satelliteId} maneuver burn`.toLowerCase();
        if (searchable.includes(query)) {
            results.push({
                type: 'MANEUVER',
                id: mnv.id,
                satelliteId: mnv.satelliteId,
                status: mnv.status,
                burnTime: mnv.burnTime
            });
        }
    });

    console.log(`[SEARCH] Query: "${query}" → ${results.length} results`);
    res.json({
        query: query,
        count: results.length,
        results: results,
        timestamp: globalTimestamp
    });
});

// 6. Live Fleet Statistics
app.get('/api/stats', (req, res) => {
    res.json({
        timestamp: globalTimestamp,
        total_satellites: satellites.length,
        total_debris: debrisArray.length,
        pending_maneuvers: maneuvers.filter(m => m.status === 'PENDING').length,
        active_collisions: detectSimulatedCollisions(),
        uptime_seconds: Math.floor((Date.now() - serverStartTime) / 1000)
    });
});

// 7. Telemetry Log Ingest (from frontend)
app.post('/api/telemetry/log', (req, res) => {
    const { message, level } = req.body;
    if (message) {
        console.log(`[FRONTEND-LOG][${level || 'INFO'}] ${message}`);
    }
    res.json({ status: 'LOGGED' });
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`=========================================`);
    console.log(`[SYSTEM] ACM Backend online`);
    console.log(`[NETWORK] Listening on http://${HOST}:${PORT}`);
    console.log(`[CONFIG] CORS: Enabled | JSON: Enabled`);
    console.log(`=========================================`);
});
