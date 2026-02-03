import { setupAuthUI } from './auth.js';
let plotId = null;
let isLoadingOlderLogs = false;
let currentRegionId = null; // Track current region for resize handler

// Toast notification helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Remove after animation
    setTimeout(() => toast.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    const urlParams = new URLSearchParams(window.location.search);
    plotId = urlParams.get('plotId'); // Assign to global plotId
    const characterId = urlParams.get('characterId');

    if (!plotId || !characterId) {
        alert('No plot or character selected, please go back to the profile page to select.');
        window.location.href = '/profile';
        return;
    }
    
    // Initialize MapViewer
    if (typeof MapViewer !== 'undefined') {
        window.mapViewer = new MapViewer('map-viewer-container', plotId);
        window.mapViewer.load();
    } else {
        console.error('MapViewer class not loaded');
    }

    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');
    const userMenuButton = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    const usernameDisplay = document.getElementById('username');
    const userMenu = document.getElementById('user-menu');
    const characterDetails = document.getElementById('character-details');

    // Login action
    loginBtn.addEventListener('click', () => {
        window.location.href = '/login';
    });

    // Logout action
    logoutBtn.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    // View profile action
    profileBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/profile');
            const user = await response.json();
            alert(`User profile:\nName: ${user.name}\nEmail: ${user.email}`);
        } catch (error) {
            console.error('Error fetching profile:', error);
        }
    });

    // User menu dropdown
    userMenuButton.addEventListener('click', () => {
        userDropdown.classList.toggle('show');
    });

    // Close the dropdown if the user clicks outside of it
    window.onclick = (event) => {
        if (!event.target.matches('#user-menu-button') && !event.target.matches('#username') && !event.target.matches('.arrow')) {
            if (userDropdown.classList.contains('show')) {
                userDropdown.classList.remove('show');
            }
        }
    };

    async function fetchWorldDetails(worldId) {
        try {
            const response = await fetch(`/api/worlds/${worldId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch world details');
            }
            const world = await response.json();
        } catch (error) {
            console.error('Error fetching world details:', error);
        }
    }

    async function fetchRegionDetails(regionId) {
        try {
            const response = await fetch(`/api/region/${regionId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch region details');
            }
            const region = await response.json();
            return region;
        } catch (error) {
            console.error('Error fetching region details:', error);
            return null;
        }
    }
    
    async function fetchSettlementsByRegionId(regionId) {
        try {
            const response = await fetch(`/api/settlements/region/${regionId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch settlements');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching settlements:', error);
            return [];
        }
    }
    

    function renderMap(mapArray) {
        const canvas = document.getElementById('map-canvas');
        const container = document.getElementById('map-section');
        const ctx = canvas.getContext('2d');
    
        // Calculate the aspect ratio of the map
        const mapAspectRatio = mapArray.length / mapArray[0].length;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const containerAspectRatio = containerWidth / containerHeight;
    
        // Adjust canvas size to fit within the container while maintaining the aspect ratio
        if (containerAspectRatio > mapAspectRatio) {
            canvas.height = containerHeight;
            canvas.width = containerHeight * mapAspectRatio;
        } else {
            canvas.width = containerWidth;
            canvas.height = containerWidth / mapAspectRatio;
        }
    
        const tileSize = Math.min(canvas.width / mapArray.length, canvas.height / mapArray.length);
    
        const colors = {
            forest: '#2E8B57',  // sea green
            mountains: '#A9A9A9',  // dark gray
            grassland: '#7CFC00',  // lawn green
            desert: '#F4A460',  // sandy brown
            marsh: '#556B2F',  // dark olive green
            water: '#4682B4',  // steel blue
            settlement: '#FFD700'  // gold
        };
    
        // Clear the canvas before rendering
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    
        for (let y = 0; y < mapArray.length; y++) {
            for (let x = 0; x < mapArray[y].length; x++) {
                const terrain = mapArray[y][x];
    
                // Draw the background color
                ctx.fillStyle = colors[terrain] || '#FFFFFF';  // default to white
                ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    
                // Draw the texture on top of the background color if loaded
                const texture = textures[terrain];
                if (texture && texture.complete && texture.naturalWidth !== 0) {
                    ctx.drawImage(texture, x * tileSize, y * tileSize, tileSize, tileSize);
                }
    
                // Optionally add icons for specific features like cities
                if (terrain === 'settlement') {
                    const settlementTexture = textures.settlement;
                    if (settlementTexture && settlementTexture.complete && settlementTexture.naturalWidth !== 0) {
                        ctx.drawImage(settlementTexture, x * tileSize, y * tileSize, tileSize, tileSize);
                    } else {
                        // Fallback to color if settlement texture not available
                        ctx.fillStyle = colors.settlement;
                        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                    }
                }
    
                // Draw grid lines
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';  // light, transparent grid lines
                ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
        }
    
        // Add labels or icons
        addLabelsOrIcons(ctx, mapArray, tileSize);
    }    
    
    // Ensure textures are loaded before rendering
    const textures = {
        forest: new Image(),
        mountains: new Image(),
        grassland: new Image(),
        desert: new Image(),
        marsh: new Image(),
        water: new Image(),
        settlement: new Image()
    };
    
    textures.forest.src = '/mapIcons/forest.png';
    textures.mountains.src = '/mapIcons/mountain.png';
    textures.grassland.src = '/mapIcons/grass.png';
    textures.desert.src = '/mapIcons/desert.png';
    textures.marsh.src = '/mapIcons/marsh.png';
    textures.water.src = '/mapIcons/water.png';
    textures.settlement.src = '/mapIcons/settlement.png';
    
    // Wait for all textures to load before rendering
    Promise.all(Object.values(textures).map(img => {
        return new Promise((resolve) => {
            img.onload = resolve;
        });
    })).then(() => {
        // Example: fetchRegionDetails(someRegionId);
    });
    
    // Example of adding labels or icons (optional)
    function addLabelsOrIcons(ctx, mapArray, tileSize) {
        ctx.font = '10px Arial';
        ctx.fillStyle = 'black';
        for (let y = 0; y < mapArray.length; y++) {
            for (let x = 0; x < mapArray[y].length; x++) {
                if (mapArray[y][x] === 'settlement') {
                    ctx.fillText('settlement', x * tileSize + 5, y * tileSize + 15);
                }
            }
        }
    }

// Store settlement coordinates and details for click detection
let settlementCoordinates = [];

function drawOverlay(settlements, playerLocation) {
    const overlayCanvas = document.getElementById('overlay-canvas');
    const mapCanvas = document.getElementById('map-canvas');
    const ctx = overlayCanvas.getContext('2d');

    // Set the overlay canvas size to match the map canvas
    overlayCanvas.width = mapCanvas.width;
    overlayCanvas.height = mapCanvas.height;

    // Clear the overlay canvas
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const tileSize = Math.min(overlayCanvas.width / 25, overlayCanvas.height / 25); // Assuming a 25x25 grid

    // Store settlement paths for click detection
    settlementCoordinates = [];

    // Draw settlements
    settlements.forEach(settlement => {
        let width, height;

        switch (settlement.size) {
            case 'medium':
                width = tileSize * 2;
                height = tileSize * 2;
                break;
            case 'large':
                width = tileSize * 3;
                height = tileSize * 3;
                break;
            default: // 'small'
                width = tileSize;
                height = tileSize;
        }

        // Highlight the area covered by the settlement
        settlement.coordinates.forEach(([x, y]) => {
            ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; // Semi-transparent grey for overlay
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        });

        // Draw the settlement icon at the first coordinate
        const [x, y] = settlement.coordinates[0];
        // Draw black border
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * tileSize, y * tileSize, width, height);
        ctx.drawImage(textures.settlement, x * tileSize, y * tileSize, width, height);

        // Store the path for click detection
        const path = new Path2D();
        path.rect(x * tileSize, y * tileSize, width, height);
        settlementCoordinates.push({ path, details: settlement });
    });

    // Draw player location
    if (playerLocation) {
        const [x, y] = playerLocation;
        ctx.fillStyle = 'rgba(255, 255, 0, 0.8)'; // Semi-transparent red for player location
        
        // Draw a star shape for the player location
        drawStar(ctx, (x + 0.5) * tileSize, (y + 0.5) * tileSize, tileSize / 2, 5, 0.5);
    }

    // Attach click listener after drawing overlay
    attachClickListener();
}

// Helper function to draw a star
function drawStar(ctx, cx, cy, outerRadius, points, innerRadiusRatio) {
    const innerRadius = outerRadius * innerRadiusRatio;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
        const angle = (i * 2 * Math.PI) / points;
        ctx.lineTo(
            cx + outerRadius * Math.cos(angle),
            cy + outerRadius * Math.sin(angle)
        );
        const innerAngle = angle + Math.PI / points;
        ctx.lineTo(
            cx + innerRadius * Math.cos(innerAngle),
            cy + innerRadius * Math.sin(innerAngle)
        );
    }
    ctx.closePath();
    ctx.fill();
}

function attachClickListener() {
    const overlayCanvas = document.getElementById('overlay-canvas');
    const ctx = overlayCanvas.getContext('2d');

    function handleCanvasClick(event) {
        const rect = overlayCanvas.getBoundingClientRect();
        const scaleX = overlayCanvas.width / rect.width;
        const scaleY = overlayCanvas.height / rect.height;
        const clickX = (event.clientX - rect.left) * scaleX;
        const clickY = (event.clientY - rect.top) * scaleY;

        settlementCoordinates.forEach(coord => {
            if (ctx.isPointInPath(coord.path, clickX, clickY)) {
                // Settlement clicked, display details
                displaySettlementDetails(coord.details);
            }
        });
    }

    overlayCanvas.removeEventListener('click', handleCanvasClick);
    overlayCanvas.addEventListener('click', handleCanvasClick);
}


// Function to display settlement details in a modal
function displaySettlementDetails(settlement) {
    const modal = document.getElementById('settlement-modal');
    const modalContent = document.getElementById('settlement-details');

    modalContent.innerHTML = `
        <h2>${settlement.name}</h2>
        <p><strong>Description:</strong> ${settlement.description}</p>
        <p><strong>Size:</strong> ${settlement.size}</p>
        <p><strong>Coordinates:</strong> [${settlement.coordinates.join(', ')}]</p>
        <p><strong>Quests:</strong></p>
        <ul>
            ${settlement.quests.map(quest => `<li>${quest.questTitle}</li>`).join('')}
        </ul>
    `;

    // Show the modal
    modal.style.display = 'block';
}

// Close the modal when the user clicks on <span> (x)
document.getElementById('close-settlement-modal').onclick = function() {
    document.getElementById('settlement-modal').style.display = 'none';
}

// Close the modal when the user clicks anywhere outside of the modal
window.onclick = function(event) {
    const modal = document.getElementById('settlement-modal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

async function fetchGameInfo(plotId, characterId) {
    try {
        const response = await fetch(`/api/game-info?plotId=${plotId}&characterId=${characterId}`);
        if (response.status === 401) {
            window.location.href = '/authorize';
            return;
        }
        if (!response.ok) {
            throw new Error('Failed to fetch game info');
        }
        const { plot, character } = await response.json();

        // Fetch region details if available
        if (plot.current_state.current_location.region) {
            const regionId = plot.current_state.current_location.region._id || plot.current_state.current_location.region;
            const region = await fetchRegionDetails(regionId);
            if (region) {
                plot.current_state.current_location.region = region;
            }
        }

        displayGameInfo(plot, character);

        if (plot.world && plot.world._id) {
            fetchWorldDetails(plot.world._id);  // Fetch world details using the world ID from the plot
            if (plot.current_state.current_location.region) {
                const regionId = plot.current_state.current_location.region._id || plot.current_state.current_location.region;  // Extract the region ID
                currentRegionId = regionId; // Store for resize handler
                const region = await fetchRegionDetails(regionId);  // Fetch region details using the region ID from the current location
                const settlements = await fetchSettlementsByRegionId(regionId); // Fetch settlements
                const playerLocation = plot.current_state.current_location.coordinates; // Player location

                if (region && Array.isArray(region.map) && region.map.length > 0) {
                    renderMap(region.map);
                    drawOverlay(settlements, playerLocation);
                } else {
                    console.error('Map data is empty or not found');
                }
            }
        } else {
            console.error('World ID is not defined in the plot');
        }
    } catch (error) {
        console.error('Error fetching game info:', error);
    }
    fetchRecentGameLog(plotId); // Fetch the most recent game log after game info
}

    async function displayGameInfo(plot, character) {
    // Display current state information in the UI
    const currentState = plot.current_state || {};
    const currentActivity = currentState.current_activity || 'Unknown';

    // Check for current location and settlement
    let currentLocation = 'Unknown';
    let currentLocationDescription = 'Unknown';
    if (currentState.current_location) {
        if (currentState.current_location.settlement) {
            currentLocation = currentState.current_location.locationName || 'Unknown';
            currentLocationDescription = currentState.current_location.locationDescription || 'Unknown';
        } else {
            const regionName = currentState.current_location.region.name || 'Unknown Region';
            const tileType = getTileTypeAtCoordinates(plot, currentState.current_location.coordinates);
            currentLocation = `in the ${tileType} of ${regionName}`;
            currentLocationDescription = currentState.current_location.description || 'Unknown';
        }
    }

    const currentTime = currentState.current_time || 'Unknown';
    const currentConditions = currentState.environment_conditions || 'Unknown';
    const currentMood = currentState.mood_tone || 'Unknown';

    // Activity icons
    const activityIcons = {
        'exploring': '🧭',
        'conversation': '💬',
        'in combat': '⚔️',
        'resting': '💤',
        'traveling': '🚶'
    };
    
    // Time icons
    const timeIcons = {
        'morning': '🌅',
        'day': '☀️',
        'afternoon': '🌤️',
        'evening': '🌆',
        'night': '🌙',
        'midnight': '🌑'
    };
    
    // Condition icons
    const conditionIcons = {
        'sunny': '☀️',
        'raining': '🌧️',
        'stormy': '⛈️',
        'cloudy': '☁️',
        'foggy': '🌫️',
        'snowing': '❄️',
        'hot': '🔥',
        'cold': '🥶',
        'dark': '🌑'
    };
    
    const getIcon = (value, iconMap, defaultIcon = '❓') => {
        if (!value) return defaultIcon;
        const key = Object.keys(iconMap).find(k => value.toLowerCase().includes(k));
        return key ? iconMap[key] : defaultIcon;
    };

    // Update prominent time display in chat header
    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
        timeDisplay.textContent = `${getIcon(currentTime, timeIcons, '⏰')} ${currentTime || 'Unknown'}`;
    }

    document.getElementById('game-info').innerHTML = `
        <h2>Current State</h2>
        <div class="state-grid">
            <div class="state-item">
                <span class="state-icon">${activityIcons[currentActivity] || '🧭'}</span>
                <span class="state-label">Activity</span>
                <span class="state-value">${currentActivity}</span>
            </div>
            <div class="state-item">
                <span class="state-icon">${getIcon(currentTime, timeIcons, '⏰')}</span>
                <span class="state-label">Time</span>
                <span class="state-value">${currentTime}</span>
            </div>
            <div class="state-item">
                <span class="state-icon">${getIcon(currentConditions, conditionIcons, '🌤️')}</span>
                <span class="state-label">Conditions</span>
                <span class="state-value">${currentConditions}</span>
            </div>
        </div>
        <div class="location-box">
            <h3>📍 ${currentLocation}</h3>
            <p>${currentLocationDescription}</p>
        </div>
    `;


        // Display character information in the UI
        const healthPercent = Math.min(100, Math.max(0, character.currentStatus.health));
        const manaPercent = Math.min(100, Math.max(0, character.currentStatus.mana));
        const healthColor = healthPercent > 60 ? '#4CAF50' : healthPercent > 30 ? '#ff9800' : '#f44336';
        
        document.getElementById('character-details').innerHTML = `
            <h3>Character Details</h3>
            <div class="section-content">
                <p><strong>${character.name}</strong></p>
                <p>${character.race} ${character.class}, Age ${character.age}</p>
                
                <div class="stat-bars">
                    <div class="stat-bar-container">
                        <span class="stat-label">❤️ Health</span>
                        <div class="stat-bar">
                            <div class="stat-bar-fill health" style="width: ${healthPercent}%; background-color: ${healthColor};"></div>
                        </div>
                        <span class="stat-value">${character.currentStatus.health}</span>
                    </div>
                    <div class="stat-bar-container">
                        <span class="stat-label">💙 Mana</span>
                        <div class="stat-bar">
                            <div class="stat-bar-fill mana" style="width: ${manaPercent}%;"></div>
                        </div>
                        <span class="stat-value">${character.currentStatus.mana}</span>
                    </div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-item">💪 STR<br><strong>${character.stats.strength}</strong></div>
                    <div class="stat-item">🧠 INT<br><strong>${character.stats.intelligence}</strong></div>
                    <div class="stat-item">⚡ AGI<br><strong>${character.stats.agility}</strong></div>
                </div>
            </div>
            <h3>Inventory:</h3>
            <div class="section-content inventory-list">
                ${character.inventory.length > 0 
                    ? character.inventory.map(item => `<span class="inventory-item">🎒 ${item.itemName} (x${item.quantity})</span>`).join('') 
                    : '<em>Empty</em>'}
            </div>
        `;
        characterDetails.style.display = 'block';
    }

    async function getTileTypeAtCoordinates(plot, coordinates) {
        if (!plot || !plot.current_state || !plot.current_state.current_location || !plot.current_state.current_location.region) {
            return 'Unknown Terrain';
        }
    
        const region = plot.current_state.current_location.region;
        const map = region.map;
        const [x, y] = coordinates;
    
        if (map && map[y] && map[y][x]) {
            return map[y][x];
        }
    
        return 'Unknown Terrain';
    }
    

    async function fetchQuestDetails(questId) {
        try {
            const response = await fetch(`/api/quest-details?questId=${questId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch quest details');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching quest details:', error);
            return null;
        }
    }

    async function setActiveQuest(plotId, questId) {
        try {
            const response = await fetch(`/api/plots/${plotId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ activeQuest: questId }),
            });
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }

            if (response.ok) {
                console.log(`Quest ${questId} selected as active`);
                fetchGameInfo(plotId, characterId);
            } else {
                console.error('Failed to set active quest');
            }
        } catch (error) {
            console.error('Error setting active quest:', error);
        }
    }

    // Existing code for handling player input and displaying responses
    const inputField = document.getElementById('chat-box');
    const submitBtn = document.getElementById('submit-btn');
    const viewQuestsBtn = document.getElementById('view-quests-btn');
    const questsModal = document.getElementById('quests-modal');
    const closeModal = document.getElementsByClassName('close')[0];

    // Function to open the modal
    function openModal() {
        questsModal.style.display = 'block';
    }

    // Function to close the modal
    function closeModalFunc() {
        questsModal.style.display = 'none';
    }

    // Function to close modal when clicking outside of it
    function outsideClick(event) {
        if (event.target == questsModal) {
            questsModal.style.display = 'none';
        }
    }

    // Event listeners for opening and closing the modal
    viewQuestsBtn.addEventListener('click', openModal);
    closeModal.addEventListener('click', closeModalFunc);
    window.addEventListener('click', outsideClick);
    window.addEventListener('resize', async () => {
        if (currentRegionId) {
            const settlements = await fetchSettlementsByRegionId(currentRegionId);
            drawOverlay(settlements, null);  // Pass null for player location if not available
        }
    });
    

    inputField.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitAction();
        }
    });

    submitBtn.addEventListener('click', submitAction);

    // Quick action buttons
    document.querySelectorAll('.quick-action').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            const actionType = button.dataset.type;
            
            // Set the input type radio
            const radioToSelect = document.querySelector(`input[name="inputType"][value="${actionType}"]`);
            if (radioToSelect) radioToSelect.checked = true;
            
            // Set the input text and submit
            inputField.value = action;
            submitAction();
        });
    });

    let isSubmitting = false; // Track if we're currently submitting

    async function submitAction() {
        if (isSubmitting) return; // Prevent double-submit
        
        try {
            const inputText = inputField.value.trim();
            const inputType = document.querySelector('input[name="inputType"]:checked').value;
            if (inputText) {
                // Disable inputs while streaming
                isSubmitting = true;
                submitBtn.disabled = true;
                inputField.disabled = true;
                submitBtn.textContent = '⏳';
                document.querySelectorAll('.quick-action').forEach(btn => btn.disabled = true);
                
                handlePlayerInput(inputText); // Display player input
                inputField.value = ''; // Clear input field immediately
                
                // Create streaming response container
                const gameLog = document.getElementById('game-log');
                const streamId = 'stream-' + Date.now();
                const timestamp = new Date().toLocaleTimeString();
                gameLog.innerHTML += `
                    <div id="${streamId}" class="message ai streaming">
                        <div class="author">AI:</div>
                        <div class="systemText">
                            <span class="stream-content"></span>
                            <span class="stream-cursor">▌</span>
                            <span class="timestamp" style="display:none;">${timestamp}</span>
                        </div>
                    </div>
                `;
                gameLog.scrollTop = gameLog.scrollHeight;

                const token = localStorage.getItem('authToken');
                const streamContainer = document.querySelector(`#${streamId} .stream-content`);
                const streamCursor = document.querySelector(`#${streamId} .stream-cursor`);
                const timestampEl = document.querySelector(`#${streamId} .timestamp`);
                let fullMessage = '';

                // Use streaming endpoint
                const response = await fetch('/api/input/stream', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ input: inputText, inputType, plotId })
                });

                if (response.status === 401) {
                    window.location.href = '/authorize';
                    return;
                }

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                // Read the stream
                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                
                                if (data.chunk) {
                                    fullMessage += data.chunk;
                                    streamContainer.textContent = fullMessage;
                                    gameLog.scrollTop = gameLog.scrollHeight;
                                }
                                
                                if (data.mapUpdate) {
                                    // Receive map update separately - apply it via API
                                    console.log('[Map Update Received]', data.mapUpdate);
                                    await fetch(`/api/plots/${plotId}/map`, {
                                        method: 'PATCH',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`
                                        },
                                        body: JSON.stringify(data.mapUpdate)
                                    });
                                    
                                    // Refresh map viewer immediately
                                    if (window.mapViewer) {
                                        await window.mapViewer.load();
                                    }
                                }
                                
                                if (data.done) {
                                    // Stream complete
                                    streamCursor.style.display = 'none';
                                    timestampEl.style.display = 'inline';
                                    document.getElementById(streamId).classList.remove('streaming');
                                }
                                
                                if (data.error) {
                                    streamContainer.textContent = `Error: ${data.error}`;
                                    streamCursor.style.display = 'none';
                                }
                            } catch (e) {
                                // Ignore parse errors for partial data
                            }
                        }
                    }
                }

                // Save the game log entries
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                await fetch('/api/game-logs', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ plotId, author: 'Player', content: inputText })
                });
                await fetch('/api/game-logs', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ plotId, author: 'AI', content: fullMessage })
                });
                
                // Refresh game info to update character sheet and state panel
                fetchGameInfo(plotId, characterId);
                
                // Map already refreshed when mapUpdate event received (no need to refresh again)
            }
        } catch (error) {
            console.error('Error while submitting action:', error);
            displayResponse({ message: `Error: ${error.message}` });
        } finally {
            // Re-enable inputs after streaming completes (or errors)
            isSubmitting = false;
            submitBtn.disabled = false;
            inputField.disabled = false;
            submitBtn.textContent = 'Send';
            document.querySelectorAll('.quick-action').forEach(btn => btn.disabled = false);
            inputField.focus();
        }
    }

    let gameLogIds = [];  // Array to keep track of all loaded game log IDs
    let oldestGameLogId = null;

    document.getElementById('game-log').addEventListener('scroll', function() {
        if (this.scrollTop === 0 && oldestGameLogId && !isLoadingOlderLogs) {
            fetchGameLogById(oldestGameLogId);
        }
    });

    async function fetchRecentGameLog(plotId) {
        try {
            const response = await fetch(`/api/game-logs/recent/${plotId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (response.status === 404) {
                // Fetch and display world and region details
                const introResponse = await fetch(`/api/world-and-region/${plotId}`);
                if (!introResponse.ok) {
                    throw new Error('Failed to fetch world and region details');
                }
                const introData = await introResponse.json();
                displayWorldAndRegionDetails(introData);

    
                // Fetch and display quests
                const questsResponse = await fetch(`/api/initial-quests/${plotId}`);
                if (!questsResponse.ok) {
                    throw new Error('Failed to fetch initial quests');
                }
                const questsData = await questsResponse.json();
                const intro = await displayInitialQuests(questsData);  // Ensure passing the correct part of the response
                // save quests intro into game log
                const token = localStorage.getItem('authToken');
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                await fetch('/api/game-logs', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ plotId, author: 'AI', content: intro })
                });
    
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch recent game log');
            }
            const data = await response.json();
            console.log('Fetched recent game log:', data.messages);  // Debug log
            displayGameLogs(data.messages);
    
            // Set the oldestGameLogId to the current game log ID and add to gameLogIds array
            if (data.messages.length > 0) {
                oldestGameLogId = data.logId;
                gameLogIds.push(data.logId);
            }
        } catch (error) {
            console.error('Error fetching recent game log:', error);
        }
    }
    
    
    function displayWorldAndRegionDetails(data) {
        const gameLog = document.getElementById('game-log');
        const worldDetails = `
            <div class="message ai">
                <div class="author">AI:</div>
                <div class="systemText">
                    <em>You open your eyes...</em><br><br>
                    You find yourself in <strong>${data.settlement.name}</strong>, a settlement in the ${data.region.name} region of ${data.world.name}.<br><br>
                    ${data.settlement.description}<br><br>
                    <em>What do you do?</em>
                    <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                </div>
            </div>
        `;
        gameLog.innerHTML += worldDetails;
        gameLog.scrollTop = gameLog.scrollHeight;
    }
    
    function displayInitialQuests(quests) {
        if (!Array.isArray(quests) || quests.length === 0) {
            console.error('Invalid quests data:', quests);
            return;
        }
    
        const gameLog = document.getElementById('game-log');
        
        // Just mention that there are things happening - don't dump all quest details
        let questsMessage = `
            <div class="message ai">
                <div class="author">AI:</div>
                <div class="systemText">
                    As you take in your surroundings, you notice the locals seem preoccupied. Snippets of conversation drift past:<br><br>`;
        
        // Just show quest titles as hooks, not full descriptions
        quests.forEach((quest, index) => {
            questsMessage += `<em>"...something about ${quest.questTitle.toLowerCase()}..."</em><br>`;
        });
    
        questsMessage += `<br>
                    The details are unclear from here. Perhaps talking to the townspeople would reveal more.<br><br>
                    <strong>The world awaits. What do you do?</strong>
                    <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                </div>
            </div>
        `;
    
        gameLog.innerHTML += questsMessage;
        gameLog.scrollTop = gameLog.scrollHeight;
    
        // Return a concise version for the game log
        let returnMessage = `You notice the locals seem preoccupied. Snippets of conversation mention: `;
        returnMessage += quests.map(q => q.questTitle.toLowerCase()).join(', ');
        returnMessage += `. The details are unclear — perhaps talking to the townspeople would reveal more.`;
    
        return returnMessage;
    }
    
    

    async function fetchGameLogById(gameLogId) {
        if (isLoadingOlderLogs) return;  // Prevent multiple simultaneous requests
        isLoadingOlderLogs = true;

        try {
            const response = await fetch(`/api/game-logs/${gameLogId}/${plotId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch game log');
            }
            const data = await response.json();
            console.log('Fetched game log by ID:', data.messages);  // Debug log
            displayAdditionalGameLogs(data.messages);

            // Update oldestGameLogId to the previous game log ID, if available
            const currentIndex = gameLogIds.indexOf(gameLogId);
            if (currentIndex > 0) {
                oldestGameLogId = gameLogIds[currentIndex - 1];
            } else {
                oldestGameLogId = null;  // No more older logs
            }
        } catch (error) {
            console.error('Error fetching game log:', error);
        } finally {
            isLoadingOlderLogs = false;
        }
    }

    function displayGameLogs(logs) {
        const gameLog = document.getElementById('game-log');
        gameLog.innerHTML = '';
        logs.forEach(message => {
            const authorClass = message.author.toLowerCase() === 'player' ? 'user' : 'ai';
            const messageClass = message.author.toLowerCase() === 'player' ? 'userText' : 'systemText';
            const logEntry = `
                <div class="message ${authorClass}">
                    <div class="author ${authorClass}">${message.author}:</div>
                    <div class="${messageClass}">
                        ${message.content}
                        <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
            `;
            gameLog.innerHTML += logEntry;
        });
        gameLog.scrollTop = gameLog.scrollHeight;
    }

    function displayAdditionalGameLogs(messages) {
        const gameLog = document.getElementById('game-log');
        messages.forEach(message => {
            const authorClass = message.author.toLowerCase() === 'player' ? 'user' : 'ai';
            const messageClass = message.author.toLowerCase() === 'player' ? 'userText' : 'systemText';
            const logEntry = `
                <div class="message ${authorClass}">
                    <div class="author ${authorClass}">${message.author}:</div>
                    <div class="${messageClass}">
                        ${message.content}
                        <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
            `;
            gameLog.insertAdjacentHTML('afterbegin', logEntry); // Insert at the beginning
        });
    }

    async function handlePlayerInput(inputText) {
        const gameLog = document.getElementById('game-log');
        const timestamp = new Date().toLocaleTimeString();

        gameLog.innerHTML += `
          <div class="message user">
            <div class="author user">Player:</div>
            <div class="userText">
              ${inputText}
              <span class="timestamp">${timestamp}</span>
            </div>
          </div>
        `;
        // Scroll to the bottom of the chat section
        gameLog.scrollTop = gameLog.scrollHeight;
    }

    function displayResponse(response) {
        const gameLog = document.getElementById('game-log');
        const timestamp = new Date().toLocaleTimeString();
        
        // Consequence level indicators
        const consequenceIndicators = {
            'none': '',
            'minor': '<span class="consequence minor">⚡</span>',
            'significant': '<span class="consequence significant">⚠️</span>',
            'major': '<span class="consequence major">🔥</span>',
            'catastrophic': '<span class="consequence catastrophic">💀</span>'
        };
        
        const indicator = consequenceIndicators[response.consequence] || '';
        
        gameLog.innerHTML += `
          <div class="message ai ${response.consequence ? 'consequence-' + response.consequence : ''}">
            <div class="author">AI: ${indicator}</div>
            <div class="systemText">
            ${response.message}
              <span class="timestamp">${timestamp}</span>
            </div>
          </div>
        `;
        gameLog.scrollTop = gameLog.scrollHeight;
    }

    // Fetch initial game info and characters
    fetchGameInfo(plotId, characterId);

    // ========== SETTINGS MODAL ==========
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsModal = document.getElementById('close-settings-modal');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const toneSelect = document.getElementById('tone-select');
    const difficultySelect = document.getElementById('difficulty-select');
    const toneDescription = document.getElementById('tone-description');
    const difficultyDescription = document.getElementById('difficulty-description');

    const toneDescriptions = {
        'classic': 'A world of adventure and wonder, with danger and consequence.',
        'dark': 'Harsh and unforgiving. Life is cheap, trust is rare. Violence has real consequences.',
        'whimsical': 'Strange and often absurd, but internally consistent. Fairy tale rules apply.'
    };

    const difficultyDescriptions = {
        'casual': 'Failures result in setbacks, but rarely death. Room to recover from mistakes.',
        'hardcore': 'The world does not pull punches. Poor decisions can and will result in death.'
    };

    // Open settings modal
    if (settingsBtn) {
        settingsBtn.addEventListener('click', async () => {
            // Fetch current settings
            try {
                const response = await fetch(`/api/plots/${plotId}/settings`);
                if (response.ok) {
                    const settings = await response.json();
                    toneSelect.value = settings.tone || 'classic';
                    difficultySelect.value = settings.difficulty || 'casual';
                    toneDescription.textContent = toneDescriptions[toneSelect.value];
                    difficultyDescription.textContent = difficultyDescriptions[difficultySelect.value];
                }
            } catch (error) {
                console.error('Error fetching settings:', error);
            }
            settingsModal.style.display = 'block';
        });
    }

    // Close settings modal
    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }

    // Update descriptions on change
    if (toneSelect) {
        toneSelect.addEventListener('change', () => {
            toneDescription.textContent = toneDescriptions[toneSelect.value];
        });
    }

    if (difficultySelect) {
        difficultySelect.addEventListener('change', () => {
            difficultyDescription.textContent = difficultyDescriptions[difficultySelect.value];
        });
    }

    // Save settings
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/plots/${plotId}/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tone: toneSelect.value,
                        difficulty: difficultySelect.value
                    })
                });
                if (response.ok) {
                    const result = await response.json();
                    console.log('Settings saved:', result);
                    settingsModal.style.display = 'none';
                    showToast(`⚙️ Settings: ${toneSelect.value} tone, ${difficultySelect.value} difficulty`, 'success');
                } else {
                    showToast('Failed to save settings', 'error');
                }
            } catch (error) {
                console.error('Error saving settings:', error);
                showToast('Error saving settings', 'error');
            }
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
        if (event.target === reputationModal) {
            reputationModal.style.display = 'none';
        }
    });

    // ========== REPUTATION MODAL ==========
    const reputationBtn = document.getElementById('reputation-btn');
    const reputationModal = document.getElementById('reputation-modal');
    const closeReputationModal = document.getElementById('close-reputation-modal');

    const dispositionEmojis = {
        'hostile': '😠',
        'unfriendly': '😒',
        'neutral': '😐',
        'friendly': '😊',
        'allied': '🤝'
    };

    const reputationEmojis = {
        'notorious': '💀',
        'disliked': '👎',
        'unknown': '❓',
        'known': '👋',
        'respected': '👍',
        'legendary': '⭐'
    };

    // Open reputation modal
    if (reputationBtn) {
        reputationBtn.addEventListener('click', async () => {
            // Show modal with loading state
            const npcsDiv = document.getElementById('reputation-npcs');
            const factionsDiv = document.getElementById('reputation-factions');
            const locationsDiv = document.getElementById('reputation-locations');
            if (npcsDiv) npcsDiv.innerHTML = '<em>Loading...</em>';
            if (factionsDiv) factionsDiv.innerHTML = '<em>Loading...</em>';
            if (locationsDiv) locationsDiv.innerHTML = '<em>Loading...</em>';
            reputationModal.style.display = 'block';
            
            try {
                const response = await fetch(`/api/plots/${plotId}/reputation`);
                if (response.ok) {
                    const rep = await response.json();
                    
                    // Display NPCs
                    const npcsDiv = document.getElementById('reputation-npcs');
                    if (rep.npcs && rep.npcs.length > 0) {
                        npcsDiv.innerHTML = rep.npcs.map(npc => `
                            <div class="reputation-item">
                                <span class="rep-emoji">${dispositionEmojis[npc.disposition] || '😐'}</span>
                                <span class="rep-name">${npc.name}</span>
                                <span class="rep-status">${npc.disposition}</span>
                                <span class="rep-detail">${npc.lastInteraction || ''}</span>
                            </div>
                        `).join('');
                    } else {
                        npcsDiv.innerHTML = '<em>You haven\'t made any lasting impressions yet.</em>';
                    }
                    
                    // Display Factions
                    const factionsDiv = document.getElementById('reputation-factions');
                    if (rep.factions && rep.factions.length > 0) {
                        factionsDiv.innerHTML = rep.factions.map(f => {
                            const standingText = f.standing > 50 ? 'Friendly' : f.standing < -50 ? 'Hostile' : 'Neutral';
                            const barWidth = Math.abs(f.standing);
                            const barColor = f.standing > 0 ? '#4CAF50' : f.standing < 0 ? '#f44336' : '#888';
                            return `
                                <div class="reputation-item">
                                    <span class="rep-name">${f.name}</span>
                                    <div class="faction-bar">
                                        <div class="faction-bar-fill" style="width: ${barWidth}%; background-color: ${barColor};"></div>
                                    </div>
                                    <span class="rep-status">${standingText} (${f.standing})</span>
                                </div>
                            `;
                        }).join('');
                    } else {
                        factionsDiv.innerHTML = '<em>No faction relationships established.</em>';
                    }
                    
                    // Display Locations
                    const locationsDiv = document.getElementById('reputation-locations');
                    if (rep.locations && rep.locations.length > 0) {
                        locationsDiv.innerHTML = rep.locations.map(loc => `
                            <div class="reputation-item">
                                <span class="rep-emoji">${reputationEmojis[loc.reputation] || '❓'}</span>
                                <span class="rep-name">${loc.name}</span>
                                <span class="rep-status">${loc.reputation}</span>
                                <span class="rep-detail">${loc.knownFor || ''}</span>
                            </div>
                        `).join('');
                    } else {
                        locationsDiv.innerHTML = '<em>You\'re unknown in these lands.</em>';
                    }
                    
                    reputationModal.style.display = 'block';
                }
            } catch (error) {
                console.error('Error fetching reputation:', error);
            }
        });
    }

    // Close reputation modal
    if (closeReputationModal) {
        closeReputationModal.addEventListener('click', () => {
            reputationModal.style.display = 'none';
        });
    }

    // ========== STORY SUMMARY ==========
    const storySummaryBtn = document.getElementById('story-summary-btn');
    
    if (storySummaryBtn) {
        storySummaryBtn.addEventListener('click', async () => {
            // Show loading state
            const gameLog = document.getElementById('game-log');
            const loadingId = 'story-loading-' + Date.now();
            gameLog.innerHTML += `
                <div id="${loadingId}" class="message ai">
                    <div class="author">📜 Story Summary:</div>
                    <div class="systemText">
                        <em>Recalling your adventure...</em>
                    </div>
                </div>
            `;
            gameLog.scrollTop = gameLog.scrollHeight;
            
            try {
                const response = await fetch(`/api/plots/${plotId}/story-summary`);
                if (response.ok) {
                    const data = await response.json();
                    
                    // Remove loading message
                    const loadingEl = document.getElementById(loadingId);
                    if (loadingEl) loadingEl.remove();
                    
                    // Show the summary
                    let keyEventsHtml = '';
                    if (data.keyEvents && data.keyEvents.length > 0) {
                        keyEventsHtml = '<br><br><strong>Key Events:</strong><ul>' +
                            data.keyEvents.map(e => `<li>${e}</li>`).join('') +
                            '</ul>';
                    }
                    
                    gameLog.innerHTML += `
                        <div class="message ai story-summary">
                            <div class="author">📜 The Story So Far:</div>
                            <div class="systemText">
                                ${data.summary}
                                ${keyEventsHtml}
                                <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                            </div>
                        </div>
                    `;
                    gameLog.scrollTop = gameLog.scrollHeight;
                } else {
                    throw new Error('Failed to generate summary');
                }
            } catch (error) {
                console.error('Error fetching story summary:', error);
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) loadingEl.remove();
                
                gameLog.innerHTML += `
                    <div class="message ai">
                        <div class="author">System:</div>
                        <div class="systemText">
                            Unable to generate story summary. Try again later.
                            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                        </div>
                    </div>
                `;
            }
        });
    }

});
