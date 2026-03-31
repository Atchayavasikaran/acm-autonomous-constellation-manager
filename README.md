Autonomous Constellation Manager (ACM)

##  Overview
The Autonomous Constellation Manager (ACM) is a real-time satellite monitoring and collision avoidance system. It detects potential debris collisions, predicts risk using Time-to-Closest-Approach (TCA), and autonomously executes fuel-efficient maneuvers.

---

##  Features
-  Real-time satellite tracking
-  Space debris monitoring
-  Collision risk detection
-  TCA (Time-to-Closest-Approach) prediction
- Autonomous maneuver planning
-  Fuel optimization
-  Station-keeping (orbit recovery)
-  Backend API integration
-  Docker-based deployment

---

## Algorithms Used
- Euclidean Distance for collision detection  
- Time-to-Closest-Approach (TCA) calculation  
- Euler Integration for motion update  
- Fuel-aware maneuver optimization  

---

##  System Architecture
Frontend (UI Dashboard)  
⬇  
Backend (Node.js API)  
⬇  
Simulation Engine (Collision + Maneuver Logic)  

---

##  API Endpoints

| Endpoint | Description |
|--------|-------------|
| `/api/telemetry` | Satellite telemetry data |
| `/api/maneuver/schedule` | Schedule avoidance maneuver |
| `/api/simulate/step` | Run simulation step |

---

## Run Using Docker

```bash
docker build -t acm-final .
docker run -p 8000:8000 acm-final