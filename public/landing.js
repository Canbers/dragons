import { setupAuthUI } from './auth.js';
document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');
    const notification = document.getElementById('notification');
    const userMenuButton = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    const usernameDisplay = document.getElementById('username');
    const userMenu = document.getElementById('user-menu');
    const authContainer = document.getElementById('auth-container');

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

});
