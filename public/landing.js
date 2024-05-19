document.addEventListener('DOMContentLoaded', () => {
    const worldList = document.getElementById('world-list');
    const selectWorldBtn = document.getElementById('select-world-btn');

    // Fetch and display worlds
    async function fetchWorlds() {
        try {
            const response = await fetch('/api/worlds');
            if (!response.ok) {
                throw new Error('Failed to fetch worlds');
            }
            const worlds = await response.json();
            worldList.innerHTML = worlds.map(world => `<option value="${world._id}">${world.name}</option>`).join('');
        } catch (error) {
            console.error('Error fetching worlds:', error);
        }
    }

    // Handle world selection
    selectWorldBtn.addEventListener('click', () => {
        const selectedWorldId = worldList.value;
        if (selectedWorldId) {
            // Redirect to the main game page with the selected worldId as a query parameter
            window.location.href = `/index.html?worldId=${selectedWorldId}`;
        } else {
            alert('Please select a world');
        }
    });

    // Fetch initial world list
    fetchWorlds();
});
