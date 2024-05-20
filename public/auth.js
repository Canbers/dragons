export function displayUserDetails(user) {
    const userDetails = document.getElementById('user-details');
    if (userDetails) {
        userDetails.innerHTML = `
            <p>Name: ${user.name}</p>
            <p>Email: ${user.email}</p>
        `;
    }
}

export async function setupAuthUI() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');
    const userMenuButton = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    const usernameDisplay = document.getElementById('username');
    const userMenu = document.getElementById('user-menu');

    // Check authentication status
    try {
        const response = await fetch('/auth/status');
        if (response.status === 200) {
            const data = await response.json();
            if (data.authenticated) {
                loginBtn.style.display = 'none';
                userMenu.style.display = 'flex';
                usernameDisplay.textContent = data.name;
                displayUserDetails(data);
            } else {
                loginBtn.style.display = 'block';
                userMenu.style.display = 'none';
            }
        } else {
            loginBtn.style.display = 'block';
            userMenu.style.display = 'none';
        }
    } catch (error) {
        loginBtn.style.display = 'block';
        userMenu.style.display = 'none';
        console.log('User not authenticated:', error);
    }

    // Login action
    loginBtn.addEventListener('click', () => {
        window.location.href = '/login';
    });

    // Logout action
    logoutBtn.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    // View profile action
    profileBtn.addEventListener('click', () => {
        window.location.href = '/profile';
    });

    // User menu dropdown
    userMenuButton.addEventListener('click', () => {
        userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
    });

    // Close the dropdown if the user clicks outside of it
    window.addEventListener('click', (event) => {
        if (!event.target.matches('#user-menu-button') && !event.target.matches('#username') && !event.target.matches('.arrow')) {
            if (userDropdown.style.display === 'block') {
                userDropdown.style.display = 'none';
            }
        }
    });
}

