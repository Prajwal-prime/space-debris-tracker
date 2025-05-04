// Main application script

// Global variables
let timeSliderValue = 0;       // Default time (in seconds)
let startTime;                 // Cesium JulianDate reference
let selectedEntity = null;     // Currently selected entity for time control
window.viewer = null;          // Exposed globally if needed
let isPlaying = false;         // Flag to track animation state
let animationInterval = null;  // For time animation interval

document.addEventListener('DOMContentLoaded', () => {
    initCesium();
    setupSidebarToggle();
    setupEntityClickHandler();
    setupEventListeners();
    updateSatelliteCount();
    setupTimeControls();
    setupDebugOverlay();
    
    // Show a welcome message
    showNotification('Welcome to Space Debris Tracker', 'Select a satellite to begin tracking');
});

// Function to fetch collision risk from ML model API
async function fetchCollisionRisk(satelliteId) {
    try {
        // Create request parameters for the ML model
        const params = {
            satellite_id: satelliteId
        };
        
        // Try to fetch from the API
        console.log(`Fetching collision risk data for ${satelliteId}...`);
        
        try {
            // First try the local API
            const response = await fetch('http://localhost:5000/api/collision-risk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Received risk data:', data);
                return data;
            } else {
                throw new Error('API response was not ok');
            }
        } catch (apiError) {
            console.warn('API fetch failed, using simulated data:', apiError);
            
            // If we can't connect to the API, use simulated risk based on satellite id
            // Generate consistent risk value based on satellite ID
            const hash = satelliteId.split('').reduce((a, b) => {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
            }, 0);
            
            // Generate risk value deterministically based on satellite type
            let baseRisk = 0.3; // Default base risk
            
            if (satelliteId === 'ISS') {
                baseRisk = 0.25; // ISS is closely monitored, lower risk
            } else if (satelliteId === 'NOAA20') {
                baseRisk = 0.35; // Medium risk
            } else if (satelliteId === 'OSTM') {
                baseRisk = 0.45; // Higher orbit, but still some risk
            } else if (satelliteId.startsWith('Debris_')) {
                baseRisk = 0.65; // Debris has higher risk
                
                // Extract debris number for variation
                const debrisNum = parseInt(satelliteId.split('_')[1], 10) || 0;
                baseRisk += (debrisNum * 0.03); // Increase risk slightly for each debris item
            }
            
            // Add some randomness but keep it deterministic for the same satellite
            const randomOffset = (Math.abs(hash % 30) / 100) - 0.15; // -0.15 to +0.15
            let riskValue = baseRisk + randomOffset;
            
            // Clamp between 0 and 1
            riskValue = Math.max(0.05, Math.min(0.95, riskValue));
            
            return {
                satellite_id: satelliteId,
                risk_probability: riskValue,
                risk_level: getRiskLevel(riskValue),
                time_to_closest_approach: `${Math.floor(Math.abs(hash % 48) + 1)}h ${Math.floor(Math.abs(hash % 60))}m`,
                potential_collisions: Math.max(0, Math.min(5, Math.floor(riskValue * 5 + (hash % 3))))
            };
        }
    } catch (error) {
        console.error('Error in fetchCollisionRisk:', error);
        // Return fallback data on error
        return {
            risk_probability: 0.4,
            risk_level: 'Medium',
            time_to_closest_approach: '24h 30m',
            potential_collisions: 2
        };
    }
}

// Helper function to determine risk level from probability
function getRiskLevel(probability) {
    if (probability >= 0.7) return 'High';
    if (probability >= 0.4) return 'Medium';
    return 'Low';
}

// Helper function to get risk color from level
function getRiskColor(level) {
    switch(level) {
        case 'High': return '#ff4757';
        case 'Medium': return '#ffa502';
        case 'Low': return '#2ed573';
        default: return '#5c9dff';
    }
}

function initCesium() {
    showLoading(true);
    
    // Set your Cesium Ion access token here
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiNGFhNjQyZS01NGM1LTQ2YzItOTY2Mi1lZWRlZDA0OTBjNjQiLCJpZCI6MjgwNTEzLCJpYXQiOjE3NDA5ODEwMjh9.TqWAvnUF6yHfLOo3MYz5Ji32SzqCCgOJ9h_EXKXr1o0';
    
    // Create the Cesium Viewer with improved settings
    window.viewer = new Cesium.Viewer('visualization', {
        infoBox: true,
        selectionIndicator: true,
        terrainProvider: Cesium.createWorldTerrain(),
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        homeButton: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        geocoder: false
    });
    
    // Enhance the globe appearance
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.baseColor = new Cesium.Color(0.05, 0.05, 0.1, 1.0);
    
    // Configure the atmosphere
    viewer.scene.skyAtmosphere.brightnessShift = 0.3;
    viewer.scene.skyAtmosphere.hueShift = 0.0;
    viewer.scene.skyAtmosphere.saturationShift = 0.1;
    viewer.scene.fog.density = 0.00005;
    viewer.scene.fog.minimumBrightness = 0.01;
    
    // Enable shadows
    viewer.scene.shadowMap.enabled = true;
    viewer.scene.shadowMap.softShadows = true;
    
    // Add stars background
    viewer.scene.skyBox = new Cesium.SkyBox({
        sources: {
            positiveX: 'images/stars.jpg',
            negativeX: 'images/stars.jpg',
            positiveY: 'images/stars.jpg',
            negativeY: 'images/stars.jpg',
            positiveZ: 'images/stars.jpg',
            negativeZ: 'images/stars.jpg'
        }
    });
    
    // Set simulation start time
    startTime = Cesium.JulianDate.now();
    viewer.clock.startTime = startTime;
    viewer.clock.currentTime = startTime;
    viewer.clock.multiplier = 1;
    viewer.clock.shouldAnimate = false;
    
    // Ensure sky atmosphere is visible
    viewer.scene.skyAtmosphere.show = true;
    
    // Remove default Cesium credits
    viewer._cesiumWidget._creditContainer.style.display = "none";
    
    // Initial camera setup
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000),
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO / 2, // Look down at Earth
            roll: 0
        },
        duration: 0
    });
    
    // Load models and add satellites
    setTimeout(() => {
        // Preload models
        console.log("Loading 3D models...");
        addRealISSSatellite();
        
        setTimeout(() => {
            addRealNOAASatellite();
            
            setTimeout(() => {
                addOSTMSatellite();
                
                setTimeout(() => {
                    // Add 7 debris objects
                    addMovingDebris(7);
                    
                    // Fly to include all entities with a smooth animation
                    viewer.flyTo(viewer.entities.values, {
                        duration: 2.5,
                        offset: new Cesium.HeadingPitchRange(
                            Cesium.Math.toRadians(-20),
                            Cesium.Math.toRadians(-35),
                            12000000
                        )
                    }).then(() => {
                        showLoading(false);
                        // Welcome notification with guidance
                        showNotification('Welcome to Space Debris Tracker', 'Select a satellite to begin tracking or click Advanced Analytics to view detailed analysis');
                    });
                }, 200);
            }, 200);
        }, 200);
    }, 500);
}

/* =========================
   1) ISS with Real TLE
========================= */
function addRealISSSatellite() {
    const tleISS1 = "1 25544U 98067A   23060.51821759  .00007947  00000-0  15044-3 0  9993";
    const tleISS2 = "2 25544  51.6435  21.3292 0005650  85.9957  34.0894 15.49916231414910";
    const satrec = satellite.twoline2satrec(tleISS1, tleISS2);
    
    const orbitPeriodSeconds = 90 * 60; // ~5400 seconds
    const sampleCount = 180;
    const issPosition = new Cesium.SampledPositionProperty();
    
    for (let i = 0; i <= sampleCount; i++) {
        const fraction = i / sampleCount;
        const timeInSec = fraction * orbitPeriodSeconds;
        const sampleTime = Cesium.JulianDate.addSeconds(startTime, timeInSec, new Cesium.JulianDate());
        const jsDate = Cesium.JulianDate.toDate(sampleTime);
        
        const positionAndVelocity = satellite.propagate(satrec, jsDate);
        if (positionAndVelocity.position) {
            const gmst = satellite.gstime(jsDate);
            const geo = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            const longitude = satellite.degreesLong(geo.longitude);
            const latitude = satellite.degreesLat(geo.latitude);
            const altitude = geo.height * 1000; // convert km to meters
            const cartesianPos = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
            issPosition.addSample(sampleTime, cartesianPos);
        }
    }
    
    issPosition.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    issPosition.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    
    // Add the ISS entity with enhanced styling
    viewer.entities.add({
        id: 'ISS',
        name: 'ISS (Real Orbit)',
        position: issPosition,
        model: {
            uri: 'models/iss.glb',
            minimumPixelSize: 32,
            maximumScale: 20000,
            scale: 1.0
        },
        label: {
            text: 'ISS',
            font: '16px "Segoe UI", sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            showBackground: true,
            backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.7),
            backgroundPadding: new Cesium.Cartesian2(6, 3),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        path: {
            leadTime: orbitPeriodSeconds,
            trailTime: orbitPeriodSeconds,
            width: 3,
            material: new Cesium.Color(1.0, 1.0, 0.0, 0.8),
            resolution: 120
        },
        description: `
          <div style="background: #1a1f2e; color: #e1e6f0; padding: 15px; border-radius: 6px; max-width: 300px;">
            <h3 style="color: #5c9dff; margin-bottom: 10px;">International Space Station</h3>
            <p><strong>Launched:</strong> 20 November 1998</p>
            <p><strong>Operator:</strong> NASA / Roscosmos / ESA / JAXA / CSA</p>
            <p><strong>Orbit Altitude:</strong> ~408 km</p>
            <p><strong>Inclination:</strong> 51.6°</p>
            <p style="margin-top: 10px;">A modular space station in low Earth orbit.</p>
            <p style="margin-top: 10px; color: #5c9dff;">
              Use the <strong>time slider</strong> to scrub through its orbit.
            </p>
          </div>
        `
    });
}

/* =========================
   2) NOAA-20 with Real TLE
========================= */
function addRealNOAASatellite() {
    const tleNOAA1 = "1 41433U 16038A   23060.82382890  .00000023  00000-0  27580-4 0  9998";
    const tleNOAA2 = "2 41433  98.7027 125.3296 0011204  78.3014 281.9531 14.12586102978929";
    const satrec = satellite.twoline2satrec(tleNOAA1, tleNOAA2);
    
    const orbitPeriodSeconds = 101 * 60; // ~6060 seconds
    const sampleCount = 180;
    const noaaPosition = new Cesium.SampledPositionProperty();
    
    for (let i = 0; i <= sampleCount; i++) {
        const fraction = i / sampleCount;
        const timeInSec = fraction * orbitPeriodSeconds;
        const sampleTime = Cesium.JulianDate.addSeconds(startTime, timeInSec, new Cesium.JulianDate());
        const jsDate = Cesium.JulianDate.toDate(sampleTime);
        
        const positionAndVelocity = satellite.propagate(satrec, jsDate);
        if (positionAndVelocity.position) {
            const gmst = satellite.gstime(jsDate);
            const geo = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            const longitude = satellite.degreesLong(geo.longitude);
            const latitude = satellite.degreesLat(geo.latitude);
            const altitude = geo.height * 1000;
            const cartesianPos = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
            noaaPosition.addSample(sampleTime, cartesianPos);
        }
    }
    
    noaaPosition.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    noaaPosition.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    
    viewer.entities.add({
        id: 'NOAA20',
        name: 'NOAA-20 (Real Orbit)',
        position: noaaPosition,
        box: {
            dimensions: new Cesium.Cartesian3(20.0, 10.0, 10.0),
            material: Cesium.Color.WHITESMOKE,
            outline: true,
            outlineColor: Cesium.Color.LIGHTSKYBLUE,
            outlineWidth: 2
        },
        label: {
            text: 'NOAA-20',
            font: '14pt sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            showBackground: true,
            backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.7)
        },
        path: {
            leadTime: orbitPeriodSeconds,
            trailTime: orbitPeriodSeconds,
            width: 2,
            material: new Cesium.Color(1.0, 0.65, 0.0, 0.8)
        },
        description: `
          <div style="background: #1a1f2e; color: #e1e6f0; padding: 15px; border-radius: 6px; max-width: 300px;">
            <h3 style="color: #5c9dff; margin-bottom: 10px;">NOAA-20</h3>
            <p><strong>Launched:</strong> 18 November 2017</p>
            <p><strong>Operator:</strong> NOAA / NASA</p>
            <p><strong>Orbit Altitude:</strong> ~825 km (sun-synchronous)</p>
            <p><strong>Inclination:</strong> 98.7°</p>
            <p style="margin-top: 10px;">A polar-orbiting satellite for weather and climate observations.</p>
            <p style="margin-top: 10px; color: #5c9dff;">
              Use the <strong>time slider</strong> to scrub through its orbit.
            </p>
          </div>
        `
    });
}

/* =========================
   3) OSTM (Simulated Orbit)
========================= */
function addOSTMSatellite() {
    const orbitPeriod = 6900;
    const altitude = 1330000;
    const sampleCount = 180;
    const ostmPosition = new Cesium.SampledPositionProperty();
    
    for (let i = 0; i <= sampleCount; i++) {
        const fraction = i / sampleCount;
        const timeInSec = fraction * orbitPeriod;
        const sampleTime = Cesium.JulianDate.addSeconds(startTime, timeInSec, new Cesium.JulianDate());
        
        const angle = fraction * 2 * Math.PI;
        const lon = Cesium.Math.toDegrees(angle) - 180;
        const lat = 66 * Math.sin(angle);
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);
        ostmPosition.addSample(sampleTime, position);
    }
    
    ostmPosition.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    ostmPosition.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    
    viewer.entities.add({
        id: 'OSTM',
        name: 'OSTM (Simulated Orbit)',
        position: ostmPosition,
        model: {
            uri: 'models/ostm.glb',
            minimumPixelSize: 32,
            maximumScale: 150,
            scale: 0.5
        },
        label: {
            text: 'OSTM',
            font: '14pt sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -9),
            showBackground: true,
            backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.7)
        },
        path: {
            leadTime: orbitPeriod,
            trailTime: orbitPeriod,
            width: 2,
            material: new Cesium.Color(0.0, 1.0, 0.0, 0.8)
        },
        description: `
          <div style="background: #1a1f2e; color: #e1e6f0; padding: 15px; border-radius: 6px; max-width: 300px;">
            <h3 style="color: #5c9dff; margin-bottom: 10px;">OSTM/Jason-2</h3>
            <p><strong>Launched:</strong> 20 June 2008</p>
            <p><strong>Operator:</strong> NASA / CNES / NOAA / EUMETSAT</p>
            <p><strong>Orbit Altitude:</strong> ~1336 km</p>
            <p><strong>Inclination:</strong> 66° (approx)</p>
            <p style="margin-top: 10px;">Measuring sea surface height for ocean surface topography.</p>
            <p style="margin-top: 10px; color: #5c9dff;">
              Use the <strong>time slider</strong> to scrub through its orbit.
            </p>
          </div>
        `
    });
}

/* =========================
   4) Moving Debris (7 Pieces)
========================= */
function addMovingDebris(count) {
    const sampleCount = 100;
    for (let i = 0; i < count; i++) {
        const altitude = 700000 + Cesium.Math.nextRandomNumber() * 400000;
        const inclination = Cesium.Math.nextRandomNumber() * 90;
        const raan = Cesium.Math.nextRandomNumber() * 360;
        const orbitPeriod = 200 + Cesium.Math.nextRandomNumber() * 200;
        
        const debrisPosition = new Cesium.SampledPositionProperty();
        for (let j = 0; j <= sampleCount; j++) {
            const fraction = j / sampleCount;
            const timeInSec = fraction * orbitPeriod;
            const sampleTime = Cesium.JulianDate.addSeconds(startTime, timeInSec, new Cesium.JulianDate());
            const angle = fraction * 2 * Math.PI;
            
            const r = altitude;
            const xOrb = r * Math.cos(angle);
            const yOrb = r * Math.sin(angle);
            const zOrb = 0;
            
            const xInclined = xOrb;
            const yInclined = yOrb * Math.cos(Cesium.Math.toRadians(inclination));
            const zInclined = yOrb * Math.sin(Cesium.Math.toRadians(inclination));
            
            const xEci = xInclined * Math.cos(Cesium.Math.toRadians(raan)) - yInclined * Math.sin(Cesium.Math.toRadians(raan));
            const yEci = xInclined * Math.sin(Cesium.Math.toRadians(raan)) + yInclined * Math.cos(Cesium.Math.toRadians(raan));
            const zEci = zInclined;
            
            const lat = Cesium.Math.toDegrees(Math.asin(zEci / r));
            const lon = Cesium.Math.toDegrees(Math.atan2(yEci, xEci));
            
            const pos = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);
            debrisPosition.addSample(sampleTime, pos);
        }
        debrisPosition.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        debrisPosition.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        
        // Use simple point visualization instead of complex models
        viewer.entities.add({
            id: `Debris_${i}`,
            name: `Debris ${i}`,
            position: debrisPosition,
            point: {
                pixelSize: 8,
                color: Cesium.Color.RED.withAlpha(0.9),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2
            },
            path: {
                leadTime: orbitPeriod,
                trailTime: orbitPeriod,
                width: 2,
                material: new Cesium.Color(1.0, 0, 0, 0.5)
            }
        });
    }
}

/* =========================
   5) Entity Click Handler
   - Enables the time slider when a satellite is selected.
   - The built-in InfoBox automatically displays the description.
========================= */
function setupEntityClickHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const timeSlider = document.getElementById('time-slider');
    
    handler.setInputAction(async (click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (Cesium.defined(pickedObject) && pickedObject.id) {
            const id = pickedObject.id.id;
            
            // Highlight the selected entity
            if (selectedEntity) {
                // Reset previous selection styling if needed
            }
            
            if (id === 'ISS' || id === 'NOAA20' || id === 'OSTM' || id.startsWith('Debris_')) {
                selectedEntity = pickedObject.id;
                timeSlider.disabled = false;
                
                // Show loading notification
                showNotification(`Selected: ${selectedEntity.name}`, 'Analyzing collision risks...');
                
                // Fly to the selected entity for better view
                viewer.flyTo(selectedEntity, {
                    duration: 1.5,
                    offset: new Cesium.HeadingPitchRange(
                        0,
                        Cesium.Math.toRadians(-45),
                        selectedEntity.id === 'ISS' ? 1000000 : 2000000
                    )
                });
                
                // Fetch and display collision risk for the selected entity
                try {
                    const riskData = await fetchCollisionRisk(id);
                    updateCollisionRiskDisplay(selectedEntity, riskData);
                    displaySatelliteInfoPanel(selectedEntity, riskData);
                } catch (error) {
                    console.error('Error displaying collision risk:', error);
                }
            } else {
                selectedEntity = null;
                timeSlider.disabled = true;
                stopAnimation();
            }
        } else {
            selectedEntity = null;
            timeSlider.disabled = true;
            stopAnimation();
            
            // Hide satellite info panel when nothing is selected
            const infoPanel = document.getElementById('satellite-info-panel');
            if (infoPanel) {
                infoPanel.classList.add('hidden');
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

// Function to update collision risk display
function updateCollisionRiskDisplay(entity, riskData) {
    const { risk_probability, risk_level } = riskData;
    const percentage = Math.round(risk_probability * 100);
    
    // Show notification for the risk
    const color = getRiskColor(risk_level);
    const message = `Risk Level: ${risk_level} (${percentage}%)`;
    
    showNotification(`Collision Risk: ${entity.name}`, message, color);
}

// Function to display satellite info panel with risk data
function displaySatelliteInfoPanel(entity, riskData) {
    const infoPanel = document.getElementById('satellite-info-panel');
    if (!infoPanel) return;
    
    // Get satellite info
    const name = entity.name;
    let launchDate = 'Unknown';
    let operator = 'Unknown';
    let altitude = 'Unknown';
    let inclination = 'Unknown';
    let purpose = 'Unknown';
    
    // Extract info from entity if available
    if (entity.id === 'ISS') {
        launchDate = '20 November 1998';
        operator = 'NASA / Roscosmos / ESA / JAXA / CSA';
        altitude = '~408 km';
        inclination = '51.6°';
        purpose = 'Space station in low Earth orbit';
    } else if (entity.id === 'NOAA20') {
        launchDate = '18 November 2017';
        operator = 'NOAA / NASA';
        altitude = '~825 km';
        inclination = '98.7°';
        purpose = 'Weather and climate observations';
    } else if (entity.id === 'OSTM') {
        launchDate = '20 June 2008';
        operator = 'NASA / CNES / NOAA / EUMETSAT';
        altitude = '~1336 km';
        inclination = '66°';
        purpose = 'Ocean surface topography';
    } else if (entity.id.startsWith('Debris_')) {
        launchDate = 'N/A';
        operator = 'N/A';
        altitude = '700-1100 km';
        inclination = 'Various';
        purpose = 'Orbital debris';
    }
    
    // Set values in the info panel
    document.getElementById('satellite-name').textContent = name;
    document.getElementById('satellite-launch').textContent = launchDate;
    document.getElementById('satellite-operator').textContent = operator;
    document.getElementById('satellite-altitude').textContent = altitude;
    document.getElementById('satellite-inclination').textContent = inclination;
    document.getElementById('satellite-purpose').textContent = purpose;
    
    // Add collision risk information to the panel
    const satelliteDetails = document.querySelector('.satellite-details');
    
    // Remove any existing risk elements
    const existingRisk = document.getElementById('collision-risk-detail');
    if (existingRisk) {
        existingRisk.remove();
    }
    
    // Create and add collision risk details
    const riskElement = document.createElement('div');
    riskElement.className = 'detail-item';
    riskElement.id = 'collision-risk-detail';
    
    const riskPercentage = Math.round(riskData.risk_probability * 100);
    const riskColor = getRiskColor(riskData.risk_level);
    
    riskElement.innerHTML = `
        <span class="label"><i class="fas fa-exclamation-triangle"></i> Collision Risk:</span>
        <span class="value" style="color: ${riskColor}; font-weight: bold;">
            ${riskData.risk_level} (${riskPercentage}%)
        </span>
    `;
    
    // Add time to closest approach if available
    const timeElement = document.createElement('div');
    timeElement.className = 'detail-item';
    timeElement.innerHTML = `
        <span class="label"><i class="fas fa-clock"></i> Time to Approach:</span>
        <span class="value">${riskData.time_to_closest_approach || 'Unknown'}</span>
    `;
    
    // Add potential collisions if available
    const collisionsElement = document.createElement('div');
    collisionsElement.className = 'detail-item';
    collisionsElement.innerHTML = `
        <span class="label"><i class="fas fa-meteor"></i> Potential Collisions:</span>
        <span class="value">${riskData.potential_collisions || 0}</span>
    `;
    
    // Add the elements to the panel
    satelliteDetails.appendChild(riskElement);
    satelliteDetails.appendChild(timeElement);
    satelliteDetails.appendChild(collisionsElement);
    
    // Update action buttons
    const followBtn = document.getElementById('follow-satellite');
    followBtn.onclick = () => {
        viewer.trackedEntity = entity;
        followBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Unfollow';
        followBtn.onclick = () => {
            viewer.trackedEntity = undefined;
            displaySatelliteInfoPanel(entity, riskData); // Reset the button
        };
    };
    
    const analyticsBtn = document.getElementById('jump-to-analytics');
    analyticsBtn.onclick = () => {
        window.open('http://localhost:8502?satellite=' + entity.id, '_blank');
    };
    
    // Show the panel
    infoPanel.classList.remove('hidden');
    
    // Setup close button
    const closeBtn = infoPanel.querySelector('.close-btn');
    closeBtn.onclick = () => {
        infoPanel.classList.add('hidden');
    };
}

/* =========================
   6) Sidebar Toggle Functionality
========================= */
function setupSidebarToggle() {
    const leftSidebar = document.getElementById('control-panel');
    const toggleLeftBtn = document.getElementById('toggle-left');
    const visualizationContainer = document.getElementById('visualization-container');
    
    if (toggleLeftBtn && leftSidebar) {
        toggleLeftBtn.addEventListener('click', () => {
            leftSidebar.classList.toggle('collapsed');
            toggleLeftBtn.classList.toggle('open');
            
            // Update visualization container to account for sidebar
            visualizationContainer.style.marginLeft = leftSidebar.classList.contains('collapsed') ? '0' : '280px';
            
            // Trigger a resize to ensure Cesium updates correctly
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 300);
        });
    }
}

/* =========================
   7) Additional UI Event Listeners
========================= */
function setupEventListeners() {
    const timeSlider = document.getElementById('time-slider');
    timeSlider.disabled = true;
    
    // Update time slider visuals as it's being moved
    timeSlider.addEventListener('input', (e) => {
        if (selectedEntity && (selectedEntity.id === 'ISS' || selectedEntity.id === 'NOAA20' || selectedEntity.id === 'OSTM')) {
            timeSliderValue = parseInt(e.target.value, 10);
            updateTimeDisplay(timeSliderValue);
            updateTimeSliderAppearance(timeSlider);
        }
    });
    
    timeSlider.addEventListener('change', (e) => {
        if (selectedEntity && (selectedEntity.id === 'ISS' || selectedEntity.id === 'NOAA20' || selectedEntity.id === 'OSTM')) {
            console.log('Time slider changed:', timeSliderValue);
        }
    });
    
    const satelliteSelect = document.getElementById('satellite-select');
    if (satelliteSelect) {
        satelliteSelect.addEventListener('change', (e) => {
            const selection = e.target.value;
            
            // Stop any ongoing animation if satellite is changed
            stopAnimation();
            
            if (selection === 'all') {
                // Fly to include all entities with a nice animation
                viewer.flyTo(viewer.entities.values, {
                    duration: 2,
                    offset: new Cesium.HeadingPitchRange(
                        Cesium.Math.toRadians(-20),
                        Cesium.Math.toRadians(-35),
                        12000000
                    )
                });
                selectedEntity = null;
                timeSlider.disabled = true;
            } else {
                selectedEntity = viewer.entities.getById(selection);
                timeSlider.disabled = false;
                viewer.flyTo(selectedEntity, {
                    duration: 1.5
                });
                
                // Show notification
                showNotification(`Selected: ${selectedEntity.name}`, 'Use the time slider to track its orbit');
            }
        });
    }
    
    // Add camera control buttons to the UI
    addCameraControls();
}

function addCameraControls() {
    // Create container for camera controls
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'camera-controls';
    controlsContainer.style.cssText = `
        position: absolute;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 10px;
        z-index: 100;
    `;
    
    // Helper function to create buttons
    function createButton(icon, tooltip, action) {
        const btn = document.createElement('button');
        btn.innerHTML = icon;
        btn.title = tooltip;
        btn.className = 'camera-btn';
        btn.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(26, 31, 46, 0.7);
            border: 1px solid rgba(92, 157, 255, 0.3);
            color: white;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: all 0.2s ease;
        `;
        
        btn.addEventListener('mouseover', () => {
            btn.style.background = 'rgba(92, 157, 255, 0.7)';
            btn.style.transform = 'scale(1.1)';
        });
        
        btn.addEventListener('mouseout', () => {
            btn.style.background = 'rgba(26, 31, 46, 0.7)';
            btn.style.transform = 'scale(1)';
        });
        
        btn.addEventListener('click', action);
        return btn;
    }
    
    // Create zoom in button
    const zoomInBtn = createButton('+', 'Zoom In', () => {
        viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.2);
    });
    
    // Create zoom out button
    const zoomOutBtn = createButton('-', 'Zoom Out', () => {
        viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.2);
    });
    
    // Create reset view button
    const resetBtn = createButton('⟲', 'Reset View', () => {
        viewer.flyTo(viewer.entities.values, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(-20),
                Cesium.Math.toRadians(-35),
                12000000
            )
        });
    });
    
    // Create orbit left button
    const orbitLeftBtn = createButton('↺', 'Orbit Left', () => {
        viewer.camera.rotateLeft(Cesium.Math.toRadians(10));
    });
    
    // Create orbit right button
    const orbitRightBtn = createButton('↻', 'Orbit Right', () => {
        viewer.camera.rotateRight(Cesium.Math.toRadians(10));
    });
    
    // Create tilt up button
    const tiltUpBtn = createButton('↑', 'Tilt Up', () => {
        viewer.camera.rotateUp(Cesium.Math.toRadians(10));
    });
    
    // Create tilt down button
    const tiltDownBtn = createButton('↓', 'Tilt Down', () => {
        viewer.camera.rotateDown(Cesium.Math.toRadians(10));
    });
    
    // Create follow mode button
    const followBtn = createButton('👁️', 'Toggle Follow Mode', () => {
        if (!selectedEntity) {
            showNotification('Follow Mode', 'Please select a satellite first');
            return;
        }
        
        const isFollowing = followBtn.classList.contains('active');
        
        if (isFollowing) {
            // Stop following
            viewer.trackedEntity = undefined;
            followBtn.classList.remove('active');
            followBtn.style.background = 'rgba(26, 31, 46, 0.7)';
        } else {
            // Start following
            viewer.trackedEntity = selectedEntity;
            followBtn.classList.add('active');
            followBtn.style.background = 'rgba(92, 157, 255, 0.9)';
        }
    });
    
    // Add buttons to container
    controlsContainer.appendChild(zoomInBtn);
    controlsContainer.appendChild(zoomOutBtn);
    controlsContainer.appendChild(orbitLeftBtn);
    controlsContainer.appendChild(resetBtn);
    controlsContainer.appendChild(orbitRightBtn);
    controlsContainer.appendChild(tiltUpBtn);
    controlsContainer.appendChild(tiltDownBtn);
    controlsContainer.appendChild(followBtn);
    
    // Add container to the visualization container
    const visualizationContainer = document.getElementById('visualization-container');
    if (visualizationContainer) {
        visualizationContainer.appendChild(controlsContainer);
    }
    
    // Add CSS for tooltips
    const style = document.createElement('style');
    style.textContent = `
        .camera-btn {
            position: relative;
        }
        
        .camera-btn:hover::after {
            content: attr(title);
            position: absolute;
            top: -30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(26, 31, 46, 0.9);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 1000;
        }
    `;
    document.head.appendChild(style);
}

function setupTimeControls() {
    const controlGroup = document.querySelector('.control-group');
    
    // Create play/pause button
    const playButton = document.createElement('button');
    playButton.id = 'play-btn';
    playButton.innerHTML = '▶ Play';
    playButton.className = 'play-button';
    playButton.disabled = true;
    
    // Insert the button after the time display
    controlGroup.appendChild(playButton);
    
    // Add CSS for button
    const style = document.createElement('style');
    style.textContent = `
        .play-button {
            background: #242c40;
            color: #e1e6f0;
            border: none;
            border-radius: 4px;
            padding: 8px 16px;
            margin-top: 12px;
            cursor: pointer;
            font-weight: 500;
            width: 100%;
            transition: all 0.2s ease;
        }
        .play-button:hover:not(:disabled) {
            background: #5c9dff;
        }
        .play-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .notification {
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(26, 31, 46, 0.9);
            color: #e1e6f0;
            border-left: 4px solid #5c9dff;
            padding: 15px 20px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            max-width: 300px;
            animation: slideIn 0.3s ease forwards;
            backdrop-filter: blur(4px);
        }
        .notification h4 {
            margin: 0 0 5px 0;
            color: #5c9dff;
        }
        .notification p {
            margin: 0;
            font-size: 14px;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
    // Add event listener for play/pause
    playButton.addEventListener('click', togglePlayPause);
    
    // Connect play button state to time slider
    const timeSlider = document.getElementById('time-slider');
    
    // Enable/disable play button when time slider is enabled/disabled
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'disabled') {
                playButton.disabled = timeSlider.disabled;
                if (timeSlider.disabled && isPlaying) {
                    stopAnimation();
                }
            }
        });
    });
    
    observer.observe(timeSlider, { attributes: true });
}

function togglePlayPause() {
    const playButton = document.getElementById('play-btn');
    
    if (!isPlaying) {
        // Start the animation
        isPlaying = true;
        playButton.innerHTML = '⏸ Pause';
        
        // Animate the time slider
        animationInterval = setInterval(() => {
            const timeSlider = document.getElementById('time-slider');
            let currentValue = parseInt(timeSlider.value, 10);
            currentValue = (currentValue + 10) % parseInt(timeSlider.max, 10);
            timeSlider.value = currentValue;
            timeSliderValue = currentValue;
            updateTimeDisplay(currentValue);
            updateTimeSliderAppearance(timeSlider);
        }, 100);
    } else {
        // Stop the animation
        stopAnimation();
    }
}

function stopAnimation() {
    const playButton = document.getElementById('play-btn');
    if (playButton) {
        playButton.innerHTML = '▶ Play';
    }
    isPlaying = false;
    
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

/* =========================
   8) Update Time Display and Viewer Clock
========================= */
function updateTimeDisplay(value) {
    const timeDisplay = document.getElementById('time-display');
    if (!timeDisplay) return;
    const newTime = Cesium.JulianDate.addSeconds(startTime, value, new Cesium.JulianDate());
    viewer.clock.currentTime = newTime;
    
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = value % 60;
    timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:` +
                             `${minutes.toString().padStart(2, '0')}:` +
                             `${seconds.toString().padStart(2, '0')}`;
}

function updateTimeSliderAppearance(slider) {
    // Update the gradient fill of the range slider
    const percentage = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.backgroundImage = `linear-gradient(to right, #5c9dff 0%, #5c9dff ${percentage}%, #242c40 ${percentage}%)`;
}

function updateSatelliteCount() {
    let satelliteCount = 0;
    let debrisCount = 0;
    
    viewer.entities.values.forEach(entity => {
        if (entity.id.includes('Debris')) {
            debrisCount++;
        } else {
            satelliteCount++;
        }
    });
}

function showNotification(title, message, color = '#5c9dff') {
    // Remove any existing notifications
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    // Apply custom styling if color is provided
    if (color !== '#5c9dff') {
        notification.style.borderLeftColor = color;
    }
    
    // Add icon based on message content
    let icon = 'fa-info-circle';
    if (title.includes('Risk')) {
        icon = 'fa-exclamation-triangle';
    } else if (title.includes('Selected')) {
        icon = 'fa-satellite';
    } else if (title.includes('Welcome')) {
        icon = 'fa-globe';
    }
    
    notification.innerHTML = `
        <h4><i class="fas ${icon}"></i> ${title}</h4>
        <p>${message}</p>
    `;
    
    // Add to document
    document.body.appendChild(notification);
    
    // Remove after delay
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

/* =========================
   Optional Helper Functions
========================= */
async function fetchInitialData() {
    return { satellites: [], predictions: [] };
}

function showLoading(isLoading) {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (!loadingOverlay) return;
    loadingOverlay.classList.toggle('active', isLoading);
}

function debounce(func, wait) {
    let timeout;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => { func.apply(context, args); }, wait);
    };
}

function setupDebugOverlay() {
    // Create debug overlay element
    const debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.cssText = `
        position: fixed;
        bottom: 40px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        max-width: 400px;
        z-index: 1000;
        display: none;
    `;
    
    // Add toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = 'Debug';
    toggleBtn.style.cssText = `
        position: fixed;
        bottom: 40px;
        right: 10px;
        background: #5c9dff;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 5px 10px;
        cursor: pointer;
        z-index: 1001;
        font-size: 12px;
    `;
    
    // Content area
    const contentArea = document.createElement('div');
    contentArea.id = 'debug-content';
    debugOverlay.appendChild(contentArea);
    
    // Add to document
    document.body.appendChild(debugOverlay);
    document.body.appendChild(toggleBtn);
    
    // Toggle functionality
    toggleBtn.addEventListener('click', () => {
        const isVisible = debugOverlay.style.display === 'block';
        debugOverlay.style.display = isVisible ? 'none' : 'block';
        updateDebugInfo();
    });
    
    // Periodically update debug info when visible
    setInterval(() => {
        if (debugOverlay.style.display === 'block') {
            updateDebugInfo();
        }
    }, 1000);
    
    // Initial update
    updateDebugInfo();
}

function updateDebugInfo() {
    const contentArea = document.getElementById('debug-content');
    if (!contentArea) return;
    
    let debugInfo = '';
    
    // Cesium version
    debugInfo += `<div>Cesium Version: ${Cesium.VERSION}</div>`;
    
    // Globe status
    if (viewer && viewer.scene && viewer.scene.globe) {
        debugInfo += `<div>Globe Created: ${Boolean(viewer.scene.globe)}</div>`;
        debugInfo += `<div>Globe Destroyed: ${Boolean(viewer.scene.globe.isDestroyed())}</div>`;
    }
    
    // Check if ISS model is loaded
    const issEntity = viewer.entities.getById('ISS');
    if (issEntity) {
        debugInfo += `<div>ISS Entity: Found</div>`;
        if (issEntity.model) {
            debugInfo += `<div>ISS Model URI: ${issEntity.model.uri._value}</div>`;
        }
    } else {
        debugInfo += `<div>ISS Entity: Not Found</div>`;
    }
    
    // Check if OSTM model is loaded
    const ostmEntity = viewer.entities.getById('OSTM');
    if (ostmEntity) {
        debugInfo += `<div>OSTM Entity: Found</div>`;
        if (ostmEntity.model) {
            debugInfo += `<div>OSTM Model URI: ${ostmEntity.model.uri._value}</div>`;
        }
    } else {
        debugInfo += `<div>OSTM Entity: Not Found</div>`;
    }
    
    // Scene render info
    if (viewer && viewer.scene) {
        debugInfo += `<div>Draw Commands: ${viewer.scene.drawCommands.length}</div>`;
        debugInfo += `<div>Globe Surface Tiles: ${viewer.scene.globe._surface._tileLoadQueueHigh.length + 
                                                  viewer.scene.globe._surface._tileLoadQueueMedium.length + 
                                                  viewer.scene.globe._surface._tileLoadQueueLow.length}</div>`;
    }
    
    // Entity count
    if (viewer && viewer.entities) {
        debugInfo += `<div>Total Entities: ${viewer.entities.values.length}</div>`;
    }
    
    // Memory usage estimation
    const perf = window.performance;
    if (perf && perf.memory) {
        const memoryMB = Math.round(perf.memory.usedJSHeapSize / (1024 * 1024));
        debugInfo += `<div>Memory Usage: ~${memoryMB} MB</div>`;
    }
    
    contentArea.innerHTML = debugInfo;
}
