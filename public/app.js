document.addEventListener('DOMContentLoaded', () => {
    // New code for world and character selection
    const urlParams = new URLSearchParams(window.location.search);
    const worldId = urlParams.get('worldId');

    if (worldId) {
        fetchCharacters(worldId);
    } else {
        alert('No world selected, please go back to the landing page.');
        window.location.href = '/landing.html';
    }

    const characterIdInput = document.getElementById('character-id-input');
    const fetchCharacterBtn = document.getElementById('fetch-character-btn');
    const createCharacterBtn = document.getElementById('create-character-btn');
    const characterList = document.getElementById('character-list');
    const characterDetails = document.getElementById('character-details');
    const characterSelection = document.getElementById('character-selection');

    async function fetchCharacters(worldId) {
        try {
            const response = await fetch(`/api/characters?worldId=${worldId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch characters');
            }
            const characters = await response.json();
            characterList.innerHTML = characters.map(character => `<option value="${character._id}">${character.name}</option>`).join('');
        } catch (error) {
            console.error('Error fetching characters:', error);
        }
    }

    fetchCharacterBtn.addEventListener('click', () => {
        const characterId = characterIdInput.value.trim();
        if (characterId) {
            fetchCharacter(characterId);
        } else {
            alert('Please enter a valid character ID');
        }
    });

    createCharacterBtn.addEventListener('click', async () => {
        const characterData = {
            name: prompt('Enter character name:'),
            age: parseInt(prompt('Enter character age:'), 10),
            race: prompt('Enter character race:'),
            class: prompt('Enter character class:'),
            stats: {
                strength: parseInt(prompt('Enter character strength:'), 10),
                intelligence: parseInt(prompt('Enter character intelligence:'), 10),
                agility: parseInt(prompt('Enter character agility:'), 10)
            },
            currentStatus: {
                health: 100,
                mana: 100,
                location: null,
                statusEffects: []
            },
            originLocation: null,
            inventory: [],
            world: worldId // Associate character with the selected world
        };

        try {
            const response = await fetch('/api/characters', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(characterData)
            });

            if (!response.ok) {
                throw new Error('Failed to create character');
            }

            const newCharacter = await response.json();
            alert(`New character created: ${newCharacter.name}`);
            fetchCharacters(worldId); // Refresh the character list
        } catch (error) {
            console.error('Error creating character:', error);
        }
    });

    async function fetchCharacter(characterId) {
        try {
            const response = await fetch(`/api/characters/${characterId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch character');
            }
            const character = await response.json();
            displayCharacter(character);
        } catch (error) {
            console.error('Error fetching character:', error);
        }
    }

    function displayCharacter(character) {
        characterDetails.innerHTML = `
            <p>Character Name: ${character.name}</p>
            <p>Age: ${character.age}</p>
            <p>Race: ${character.race}</p>
            <p>Class: ${character.class}</p>
            <p>Stats: Strength ${character.stats.strength}, Intelligence ${character.stats.intelligence}, Agility ${character.stats.agility}</p>
            <p>Health: ${character.currentStatus.health}</p>
            <p>Mana: ${character.currentStatus.mana}</p>
            <p>Location: ${character.currentStatus.location ? character.currentStatus.location.name : 'Unknown'}</p>
            <p>Origin: ${character.originLocation ? character.originLocation.name : 'Unknown'}</p>
            <p>Inventory: ${character.inventory.map(item => `${item.itemName} (x${item.quantity})`).join(', ')}</p>
        `;
        characterDetails.style.display = 'block';
        characterSelection.style.display = 'none';

        handleCharacter(character);
    }

    async function handleCharacter(character) {
        try {
            const plot = await createOrFetchPlot(worldId);
            assignCharacterToPlot(character._id, plot._id);
        } catch (error) {
            console.error('Error handling character:', error);
        }
    }

    async function createOrFetchPlot(worldId) {
        try {
            const response = await fetch('/api/plot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ worldId })
            });

            if (!response.ok) {
                throw new Error('Failed to create or fetch plot');
            }

            const plot = await response.json();
            return plot;
        } catch (error) {
            console.error('Error creating or fetching plot:', error);
            throw error;
        }
    }

    async function assignCharacterToPlot(characterId, plotId) {
        try {
            const response = await fetch('/api/assign-character', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ characterId, plotId })
            });

            if (!response.ok) {
                throw new Error('Failed to assign character to plot');
            }

            const plot = await response.json();
            displayGameInfo(plot); // Display the plot details in the game info section
        } catch (error) {
            console.error('Error assigning character to plot:', error);
        }
    }

    async function fetchGameInfo(worldId) {
        try {
            const response = await fetch(`/api/game-info?worldId=${worldId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch game info');
            }
            const plot = await response.json();
            displayGameInfo(plot);
        } catch (error) {
            console.error('Error fetching game info:', error);
        }
    }

    async function displayGameInfo(plot) {
        const questsTableContainer = document.getElementById('quests-table-container');
        let htmlContent = `
            <table>
                <thead>
                    <tr>
                        <th>Quest</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>`;

        if (Array.isArray(plot.quests)) {
            for (const quest of plot.quests) {
                const details = await fetchQuestDetails(quest._id);
                if (details) {
                    htmlContent += `
                        <tr>
                            <td class="quest-title">${details.questTitle}</td>
                            <td class="quest-description">${details.quest.description}</td>
                            <td>${details.quest.status}</td>
                            <td><button class="select-quest-btn" data-quest-id="${quest._id}">Select</button></td>
                        </tr>`;
                }
            }
        } else {
            console.error('plot.quests is not an array');
        }

        htmlContent += `</tbody></table>`;
        questsTableContainer.innerHTML = htmlContent;

        document.querySelectorAll('.select-quest-btn').forEach(btn => {
            btn.addEventListener('click', (event) => {
                const questId = event.target.getAttribute('data-quest-id');
                setActiveQuest(plot._id, questId);
            });
        });
    }

    async function fetchQuestDetails(questId) {
        try {
            const response = await fetch(`/api/quest-details?questId=${questId}`);
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
            if (response.ok) {
                console.log(`Quest ${questId} selected as active`);
                fetchGameInfo(plotId);
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
        fetchGameInfo(worldId);
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
          <div class="message">
            <div class="author">Player:</div>
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
          <div class="message">
            <div class="author">AI:</div>
            <div class="systemText">
            ${response.message}
              <span class="timestamp">${timestamp}</span>
            </div>
          </div>
        `;
        gameLog.scrollTop = gameLog.scrollHeight;
    }
});
