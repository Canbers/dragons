console.log('🐉 Dragons server starting...');
console.log('  [1/10] Loading express...');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
console.log('  [2/10] Loading mongoose...');
const mongoose = require('mongoose');
require('dotenv').config();
console.log('  [4/10] Auth0 skip:', !!process.env.SKIP_AUTH);
const auth = process.env.SKIP_AUTH ? null : require('express-openid-connect').auth;
const app = express();
const cors = require('cors');
const ensureAuthenticated = require('./middleware/auth');

// Security headers
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for legacy pages
}));

// MongoDB connection
mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 5000
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// CORS configuration
const PORT = process.env.PORT || 3000;
const allowedOrigins = [
    `http://localhost:${PORT}`,
    `https://localhost:${PORT}`,
    'http://localhost:5173',
    'https://dragons.canby.ca',
    process.env.AUTH0_ISSUER_BASE_URL
];

const corsOptions = {
    origin: (origin, callback) => {
        if (allowedOrigins.includes(origin) || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    optionsSuccessStatus: 200,
    credentials: true
};

// Apply CORS middleware first
app.use(cors(corsOptions));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.oidc?.user?.sub || req.ip
});

const gptLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.oidc?.user?.sub || req.ip,
    message: { error: 'Too many requests — please wait before submitting another action.' }
});

const initLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.oidc?.user?.sub || req.ip,
    message: { error: 'Too many initialization requests — please wait.' }
});

app.use('/api', generalLimiter);
app.use('/api/input/stream', gptLimiter);
app.use('/api/plots/:id/initialize', initLimiter);
app.use('/api/generate-world', initLimiter);

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/mapIcons', express.static(path.join(__dirname, 'agents', 'world', 'factories', 'mapIcons')));

// Auth0 configuration (skipped in local dev with SKIP_AUTH=true)
if (!process.env.SKIP_AUTH) {
    const config = {
        authRequired: false,
        auth0Logout: true,
        secret: process.env.AUTH0_SECRET,
        baseURL: process.env.AUTH0_BASE_URL,
        clientID: process.env.AUTH0_CLIENT_ID,
        issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
        authorizationParams: {
            scope: 'openid profile email'
        }
    };
    app.use(auth(config));
} else {
    console.log('⚠️  SKIP_AUTH enabled - running without Auth0');
    // Mock req.oidc for routes that expect it
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { sub: 'dev-user', name: 'Developer' } };
        next();
    });
}

// Default route
app.get('/', (req, res) => {
    res.redirect('/landing.html');
});

// Serve landing page
app.get('/landing.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Serve profile.html with authentication check
app.get('/profile', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Mount route modules
app.use(require('./routes/auth'));
app.use('/api', require('./routes/worlds'));
app.use('/api', require('./routes/regions'));
app.use('/api', require('./routes/plots'));
app.use('/api', require('./routes/characters'));
app.use('/api', require('./routes/gameLogs'));

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Error handling middleware (AFTER routes)
app.use((err, req, res, next) => {
    console.error(`${new Date().toISOString()} - Error:`, err);
    if (err.message === 'Not allowed by CORS') {
        console.error(`Rejected Origin: ${req.headers.origin}`);
    }
    res.status(500).send('An unexpected error occurred');
});

// Environment-specific configuration
const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'production') {
    // Production mode: use regular HTTP, Railway handles HTTPS
    http.createServer(app).listen(PORT, () => {
        console.log(`Server is running in production mode on port ${PORT}`);
    });
} else {
    // Development mode: use HTTPS if certs exist, otherwise fall back to HTTP
    const keyPath = path.join(__dirname, 'localhost-key.pem');
    const certPath = path.join(__dirname, 'localhost.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const httpsOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        https.createServer(httpsOptions, app).listen(PORT, () => {
            console.log(`Server is running in development mode on https://localhost:${PORT}`);
        });
    } else {
        http.createServer(app).listen(PORT, () => {
            console.log(`Server is running in development mode on http://localhost:${PORT} (no SSL certs found)`);
        });
    }
}
