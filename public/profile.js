import { setupAuthUI } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');
    const userMenuButton = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    const characterTable = document.getElementById('character-table').querySelector('tbody');
    const createCharacterBtn = document.getElementById('create-character-btn');
    const createCharacterDropdown = document.getElementById('create-character-dropdown');
    const loadingSpinner = document.getElementById('loading-spinner');


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

    // Show spinner
    function showSpinner() {
        loadingSpinner.style.display = 'flex';
    }

    // Hide spinner
    function hideSpinner() {
        loadingSpinner.style.display = 'none';
    }

    // Toggle create character dropdown
    createCharacterBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const dropdown = createCharacterBtn.closest('.dropdown');
        dropdown.classList.toggle('show');
    });

    // Close the dropdown if the user clicks outside of it
    window.addEventListener('click', (event) => {
        if (!event.target.matches('#create-character-btn') && !event.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
        }
    });

    // General modal handling code
    const modals = document.querySelectorAll('.modal');
    const closeButtons = document.querySelectorAll('.close');
    

    closeButtons.forEach((btn, index) => {
        btn.addEventListener('click', () => {
            modals[index].style.display = 'none';
        });
    });

    window.addEventListener('click', (event) => {
        modals.forEach(modal => {
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        });
    });


    // Fetch and display characters for the logged-in user
    async function fetchCharacters() {
        showSpinner();
        try {
            const response = await fetch('/api/characters');
            if (response.status === 401) {
                window.location.href = '/authorize';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to fetch characters');
            }
            hideSpinner();
            const characters = await response.json();
            characterTable.innerHTML = characters.map(character => `
                <tr>
                    <td>${character.name}</td>
                    <td>${character.race}</td>
                    <td>${character.class}</td>
                    <td>${character.plot?.world?.name || 'N/A'}</td>
                    <td>
                        <button class="select-character-btn" data-plot-id="${character.plot?._id || 'undefined'}" data-character-id="${character._id}">Select</button>
                        <button class="delete-character-btn" data-character-id="${character._id}" data-character-name="${character.name}">🗑️ Delete</button>
                    </td>
                </tr>
            `).join('');
            
            // Add event listeners for select buttons
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
            
            // Add event listeners for delete buttons
            document.querySelectorAll('.delete-character-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const characterId = event.target.getAttribute('data-character-id');
                    const characterName = event.target.getAttribute('data-character-name');
                    
                    // Show confirmation dialog
                    const confirmed = confirm(
                        `⚠️ DELETE CHARACTER: ${characterName}\n\n` +
                        `This action CANNOT be undone.\n` +
                        `All story progress for this character will be permanently lost.\n\n` +
                        `Are you absolutely sure you want to delete this character?`
                    );
                    
                    if (confirmed) {
                        showSpinner();
                        try {
                            const response = await fetch(`/api/characters/${characterId}`, {
                                method: 'DELETE'
                            });
                            
                            if (!response.ok) {
                                throw new Error('Failed to delete character');
                            }
                            
                            hideSpinner();
                            // Refresh the character list
                            fetchCharacters();
                        } catch (error) {
                            hideSpinner();
                            alert('Error deleting character. Please try again.');
                            console.error('Error deleting character:', error);
                        }
                    }
                });
            });
        } catch (error) {
            hideSpinner();
            console.error('Error fetching characters:', error);
        }
    }

    // Handle create character options
    // Join Existing Game
    document.getElementById('join-existing-game-btn').addEventListener('click', () => {
        document.getElementById('join-game-modal').style.display = 'block';
    });
    
    document.getElementById('validate-plot-id').addEventListener('click', async () => {
        const plotId = document.getElementById('plot-id-input').value;
        showSpinner();
        try {
            const response = await fetch(`/api/plots/${plotId}`);
            if (!response.ok) {
                throw new Error('Plot not found');
            }
            // Plot is valid
            hideSpinner();
            document.getElementById('join-game-modal').style.display = 'none';
            openCharacterCreatorModal(plotId);
        } catch (error) {
            hideSpinner();
            document.getElementById('plot-id-error').style.display = 'block';
        }
    });

    // New Plot/Game in existing world
    document.getElementById('create-new-plot-btn').addEventListener('click', async () => {
        document.getElementById('new-plot-modal').style.display = 'block';
        showSpinner();
        try {
            const response = await fetch('/api/worlds');
            const worlds = await response.json();
            hideSpinner();
            const worldSelect = document.getElementById('world-select');
            worldSelect.innerHTML = worlds.map(world => `<option value="${world._id}">${world.name}</option>`).join('');
        } catch (error) {
            hideSpinner();
            console.error('Error fetching worlds:', error);
        }
    });
    
    document.getElementById('world-select').addEventListener('change', async (event) => {
        const worldId = event.target.value;
        showSpinner();
        try {
            const response = await fetch(`/api/worlds/${worldId}`);
            const world = await response.json();
            hideSpinner();
            document.getElementById('world-description').innerText = world.description;
        } catch (error) {
            hideSpinner();
            console.error('Error fetching world description:', error);
        }
    });
    
    document.getElementById('generate-new-plot').addEventListener('click', async () => {
        const worldId = document.getElementById('world-select').value;
        showSpinner();
        try {
            const response = await fetch('/api/plot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ worldId })
            });
            const plot = await response.json();
            hideSpinner();
            document.getElementById('new-plot-modal').style.display = 'none';
            openCharacterCreatorModal(plot._id);
        } catch (error) {
            hideSpinner();
            console.error('Error creating plot:', error);
        }
    });
    
    // New world
    document.getElementById('create-new-world-btn').addEventListener('click', () => {
        document.getElementById('new-world-modal').style.display = 'block';
    });
    
    document.getElementById('generate-new-world').addEventListener('click', async () => {
        const worldName = document.getElementById('new-world-name').value;
        showSpinner();
        try {
            const worldResponse = await fetch('/api/generate-world', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ worldName })
            });
            const newWorld = await worldResponse.json();
            const plotResponse = await fetch('/api/plot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ worldId: newWorld._id })
            });
            const plot = await plotResponse.json();
            hideSpinner();
            document.getElementById('new-world-modal').style.display = 'none';
            openCharacterCreatorModal(plot._id);
        } catch (error) {
            hideSpinner();
            console.error('Error generating new world and plot:', error);
        }
    });
    
    // Character Creator
    function openCharacterCreatorModal(plotId) {
        document.getElementById('character-creator-modal').style.display = 'block';
        document.getElementById('confirm-character').addEventListener('click', async () => {
            const characterData = {
                name: document.getElementById('char-name').value,
                age: parseInt(document.getElementById('char-age').value, 10),
                race: document.getElementById('char-race').value,
                class: document.getElementById('char-class').value,
                plot: plotId,
                stats: assignBaseStats(document.getElementById('char-race').value, document.getElementById('char-class').value),
            };
            showSpinner();
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
                hideSpinner();
                document.getElementById('character-creator-modal').style.display = 'none';
                fetchCharacters(); // Refresh the character list
            } catch (error) {
                hideSpinner();
                console.error('Error creating character:', error);
            }
        });
    }
    
    function assignBaseStats(race, charClass) {
        const baseStats = {
            Human: { strength: 10, intelligence: 10, agility: 10 },
            Elf: { strength: 8, intelligence: 12, agility: 10 },
            Dwarf: { strength: 12, intelligence: 8, agility: 10 },
        };
    
        const classModifiers = {
            Warrior: { strength: 2, intelligence: 0, agility: 1 },
            Mage: { strength: 0, intelligence: 3, agility: 0 },
            Rogue: { strength: 1, intelligence: 0, agility: 2 },
        };
    
        const raceStats = baseStats[race] || { strength: 10, intelligence: 10, agility: 10 };
        const classStats = classModifiers[charClass] || { strength: 0, intelligence: 0, agility: 0 };
    
        return {
            strength: raceStats.strength + classStats.strength,
            intelligence: raceStats.intelligence + classStats.intelligence,
            agility: raceStats.agility + classStats.agility,
        };
    }    
    

    // Fetch initial character list
    fetchCharacters();
});
