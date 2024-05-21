import { setupAuthUI } from './auth.js';
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
        } catch (error) {
            console.error('Error fetching game info:', error);
        }
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
    const startGameBtn = document.getElementById('start-game-btn');

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

    // Event listener for the Start Game button
    startGameBtn.addEventListener('click', () => {
        fetchGameInfo(plotId, characterId);
    });

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
            if (inputText) {
                handlePlayerInput(inputText); // Display player input
                const response = await fetch('/api/input', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ input: inputText })
                });
                if (response.status === 401) {
                    window.location.href = '/authorize';
                    return;
                }

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                displayResponse(data); // Display AI response
            }
        } catch (error) {
            console.error('Error while submitting action:', error);
            displayResponse({ message: `Error: ${error.message}` }); // Display error in game log
        } finally {
            inputField.value = ''; // Clear input field
        }
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