const express = require('express');
const router = express.Router();

// Login route
router.get('/login', (req, res) => {
    res.oidc.login({ returnTo: '/' });
});

// Logout route
router.get('/logout', (req, res) => {
    res.oidc.logout({ returnTo: '/' });
});

// Authorize route
router.get('/authorize', (req, res) => {
    res.oidc.login({
        authorizationParams: {
            prompt: 'none',
            redirect_uri: `${process.env.AUTH0_BASE_URL}/callback`
        },
        returnTo: '/'
    });
});

// Authentication status check endpoint
router.get('/auth/status', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        res.json({
            authenticated: true,
            name: req.oidc.user.name,
            email: req.oidc.user.email
        });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;
