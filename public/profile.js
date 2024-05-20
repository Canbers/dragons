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
    const worldList = document.getElementById('world-list');
    const selectWorldBtn = document.getElementById('select-world-btn');    

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

    // Fetch and display worlds
    async function fetchWorlds() {
        try {
            const response = await fetch('/api/worlds');
            if (response.status === 401) {
                // Redirect to authorize endpoint
                window.location.href = '/authorize';
                return;
            }
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
            console.log('routing user to game in ${selectedWorldId}')
            window.location.href = `/index.html?worldId=${selectedWorldId}`;
        } else {
            alert('Please select a world');
        }
    });

    // Fetch initial world list
    fetchWorlds();
});
