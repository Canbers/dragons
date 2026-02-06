// Middleware to check if the user is authenticated and redirect if not
function ensureAuthenticated(req, res, next) {
    // Skip auth check in dev mode
    if (process.env.SKIP_AUTH) {
        return next();
    }
    if (!req.oidc.isAuthenticated()) {
        return res.redirect('/landing.html');
    }
    next();
}

module.exports = ensureAuthenticated;
