import { setupAuthUI } from './auth.js';
let plotId = null;
let isLoadingOlderLogs = false;
document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    const urlParams = new URLSearchParams(window.location.search);
    const plotId = urlParams.get('plotId');
    const characterId = urlParams.get('characterId');

    if (!plotId || !characterId) {
        alert('No plot or character selected, please go back to the profile page to select.');
        window.location.href = '/profile';
        return;
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
            displayWorldDetails(world);
        } catch (error) {
            console.error('Error fetching world details:', error);
        }
    }

    function displayWorldDetails(world) {
        document.getElementById('map-section').innerHTML = `
            <h2>Map</h2>
            <div class="section-content">
                <p>World Name: ${world.name}</p>
                <h3>Regions:</h3>
                <ul>
                    ${world.regions.map(region => `<li>${region.name}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    async function fetchRegions(worldId) {
        try {
            const response = await fetch(`/api/regions/${worldId}`);
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch regions');
            }
            const regions = await response.json();
            displayRegions(regions);
        } catch (error) {
            console.error('Error fetching regions:', error);
        }
    }

    function displayRegions(regions) {
        const mapSection = document.getElementById('map-section');
        const grid = createRegionGrid(regions);
        mapSection.innerHTML = `
            <h2>Map</h2>
            <div class="section-content">
                <div class="grid-container">
                    ${grid}
                </div>
            </div>
        `;
    }

    function createRegionGrid(regions) {
        const coordinates = regions.map(region => region.coordinates);
        const minX = Math.min(...coordinates.map(coord => coord[0]));
        const maxX = Math.max(...coordinates.map(coord => coord[0]));
        const minY = Math.min(...coordinates.map(coord => coord[1]));
        const maxY = Math.max(...coordinates.map(coord => coord[1]));

        let grid = '';
        for (let y = maxY; y >= minY; y--) {
            for (let x = minX; x <= maxX; x++) {
                const region = regions.find(region => region.coordinates[0] === x && region.coordinates[1] === y);
                if (region) {
                    grid += `<div class="grid-item">${region.name}</div>`;
                } else {
                    grid += `<div class="grid-item empty"></div>`;
                }
            }
        }
        return grid;
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
            displayGameInfo(plot, character);
            if (plot.world && plot.world._id) {
                fetchWorldDetails(plot.world._id);  // Fetch world details using the world ID from the plot
                fetchRegions(plot.world._id);  // Fetch regions for the world
            } else {
                console.error('World ID is not defined in the plot');
            }
        } catch (error) {
            console.error('Error fetching game info:', error);
        }
        fetchRecentGameLog(plotId); // Fetch the most recent game log after game info
    }
    

    function displayGameInfo(plot, character) {
        // Display plot and character information in the UI
        document.getElementById('game-info').innerHTML = `
            <h2>Game Info</h2>
            <div class="section-content">
                <p>Plot: ${plot._id}</p>
                <p>World: ${plot.world.name}</p>
                <p>Character: ${character.name}</p>
                <p>Class: ${character.class}</p>
            </div>
        `;
        document.getElementById('character-details').innerHTML = `
            <h3>Character Details</h3>
            <div class="section-content">
                <p>Name: ${character.name}</p>
                <p>Age: ${character.age}</p>
                <p>Race: ${character.race}</p>
                <p>Class: ${character.class}</p>
                <p>Stats: Strength ${character.stats.strength}, Intelligence ${character.stats.intelligence}, Agility ${character.stats.agility}</p>
                <p>Health: ${character.currentStatus.health}</p>
                <p>Mana: ${character.currentStatus.mana}</p>
                <p>Location: ${character.currentStatus.location ? character.currentStatus.location.name : 'Unknown'}</p>
                <p>Origin: ${character.originLocation ? character.originLocation.name : 'Unknown'}</p>
            </div>
            <h3>Inventory:</h3>
            <div class="section-content">
                <p>${character.inventory.map(item => `${item.itemName} (x${item.quantity})`).join(', ')}</p>
            </div>
        `;
        characterDetails.style.display = 'block';
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

    inputField.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitAction();
        }
    });

    submitBtn.addEventListener('click', submitAction);

    async function submitAction() {
        try {
            const inputText = inputField.value.trim();
            const actionType = document.querySelector('input[name="actionType"]:checked').value;
            if (inputText) {
                handlePlayerInput(inputText); // Display player input
    
                const token = localStorage.getItem('authToken'); // Example method, adjust as needed
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
    
                const response = await fetch('/api/input', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ input: inputText, actionType, plotId })
                });
    
                if (response.status === 401) {
                    window.location.href = '/authorize';
                    return;
                }
    
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                const aiMessage = data.message.outcome || data.message.response || "No response";
                displayResponse({ message: aiMessage }); // Display AI response
    
                // Save the game log entry
                await fetch('/api/game-logs', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ plotId, author: 'Player', content: inputText })
                });
                await fetch('/api/game-logs', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ plotId, author: 'AI', content: aiMessage })
                });
            }
        } catch (error) {
            console.error('Error while submitting action:', error);
            displayResponse({ message: `Error: ${error.message}` }); // Display error in game log
        } finally {
            inputField.value = ''; // Clear input field
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
        gameLog.innerHTML += `
          <div class="message ai">
            <div class="author">AI:</div>
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

});
