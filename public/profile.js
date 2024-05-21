import { setupAuthUI } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');
    const userMenuButton = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    const usernameDisplay = document.getElementById('username');
    const userMenu = document.getElementById('user-menu');
    const userDetails = document.getElementById('user-details');
    const characterTable = document.getElementById('character-table').querySelector('tbody');
    const createCharacterBtn = document.getElementById('create-character-btn');
    const modal = document.getElementById('character-modal');
    const closeModal = document.getElementsByClassName('close')[0];
    const gameOptions = document.getElementById('game-options');
    const joinExistingGameBtn = document.getElementById('join-existing-game-btn');
    const createNewGameBtn = document.getElementById('create-new-game-btn');
    const plotIdForm = document.getElementById('plot-id-form');
    const worldSelectionForm = document.getElementById('world-selection-form');
    const characterForm = document.getElementById('character-form');
    const worldIdSelect = document.getElementById('world-id');
    let selectedPlotId = null;

    // Display user details
    function displayUserDetails(user) {
        userDetails.innerHTML = `
            <p>Name: ${user.name}</p>
            <p>Email: ${user.email}</p>
        `;
    }

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

    // Fetch and display characters for the logged-in user
    async function fetchCharacters() {
        try {
            const response = await fetch('/api/characters');
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch characters');
            }
            const characters = await response.json();
            characterTable.innerHTML = characters.map(character => `
                <tr>
                    <td>${character.name}</td>
                    <td>${character.race}</td>
                    <td>${character.class}</td>
                    <td>${character.plot?._id || 'undefined'}</td>
                    <td>${character.plot?.world?.name || 'undefined'}</td>
                    <td><button class="select-character-btn" data-plot-id="${character.plot?._id || 'undefined'}" data-character-id="${character._id}">Select</button></td>
                </tr>
            `).join('');
            document.querySelectorAll('.select-character-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    const plotId = event.target.getAttribute('data-plot-id');
                    const characterId = event.target.getAttribute('data-character-id');
                    if (plotId && plotId !== 'undefined' && characterId && characterId !== 'undefined') {
                        window.location.href = `/index.html?plotId=${plotId}&characterId=${characterId}`;
                    } else {
                        alert('Invalid plot ID or character ID');
                    }
                });
            });
        } catch (error) {
            console.error('Error fetching characters:', error);
        }
    }

    // Fetch and display worlds for creating new plot
    async function fetchWorlds() {
        try {
            const response = await fetch('/api/worlds');
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch worlds');
            }
            const worlds = await response.json();
            worldIdSelect.innerHTML = worlds.map(world => `<option value="${world._id}">${world.name}</option>`).join('');
        } catch (error) {
            console.error('Error fetching worlds:', error);
        }
    }

    // Handle creating a new character
    createCharacterBtn.addEventListener('click', () => {
        gameOptions.style.display = 'block';
        plotIdForm.style.display = 'none';
        worldSelectionForm.style.display = 'none';
        characterForm.style.display = 'none';
        modal.style.display = 'block';
    });

    closeModal.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    joinExistingGameBtn.addEventListener('click', () => {
        gameOptions.style.display = 'none';
        plotIdForm.style.display = 'block';
    });

    createNewGameBtn.addEventListener('click', () => {
        gameOptions.style.display = 'none';
        fetchWorlds();
        worldSelectionForm.style.display = 'block';
    });

    plotIdForm.addEventListener('submit', (event) => {
        event.preventDefault();
        selectedPlotId = document.getElementById('plot-id').value;
        plotIdForm.style.display = 'none';
        characterForm.style.display = 'block';
    });

    worldSelectionForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const worldId = document.getElementById('world-id').value;
        try {
            const plotResponse = await fetch('/api/plot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ worldId })
            });

            if (!plotResponse.ok) {
                throw new Error('Failed to create new plot');
            }

            const newPlot = await plotResponse.json();
            selectedPlotId = newPlot._id;
            worldSelectionForm.style.display = 'none';
            characterForm.style.display = 'block';
        } catch (error) {
            console.error('Error creating plot:', error);
        }
    });

    characterForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const characterData = {
            name: document.getElementById('char-name').value,
            age: parseInt(document.getElementById('char-age').value, 10),
            race: document.getElementById('char-race').value,
            class: document.getElementById('char-class').value,
            plot: selectedPlotId,
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
        };

        try {
            const characterResponse = await fetch('/api/characters', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(characterData)
            });

            if (!characterResponse.ok) {
                throw new Error('Failed to create character');
            }

            const newCharacter = await characterResponse.json();
            
            // Assign character to plot
            await assignCharacterToPlot(newCharacter._id, selectedPlotId);

            alert(`New character created: ${newCharacter.name}`);
            fetchCharacters(); // Refresh the character list
            modal.style.display = 'none';
        } catch (error) {
            console.error('Error creating character:', error);
        }
    });

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

            const updatedPlot = await response.json();
            console.log(`Character assigned to plot: ${updatedPlot}`);
        } catch (error) {
            console.error('Error assigning character to plot:', error);
        }
    }

    // Fetch initial character list
    fetchCharacters();
});
