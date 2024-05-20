const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const mongoose = require('mongoose');
const { auth, requiresAuth } = require('express-openid-connect');
require('dotenv').config();

const app = express();
const cors = require('cors');
const Plot = require('./db/models/Plot.js');
const Quest = require('./db/models/Quest.js');
const Character = require('./db/models/character.js');
const Settlement = require('./db/models/Settlement.js');
const World = require('./db/models/World.js');
const actionInterpreter = require('./agents/actionInterpreter');

mongoose.connect('mongodb://localhost:27017/dragons', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up CORS to allow requests from your local development environment
const corsOptions = {
    origin: 'https://localhost:3000',
    optionsSuccessStatus: 200,
    credentials: true
};

app.use(cors(corsOptions));

// Auth0 configuration
const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.AUTH0_BASE_URL,
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
    authorizationParams: {
        scope: 'openid profile email' // Ensure correct scopes
    }
};

// Attach Auth0 to the Express application
app.use(auth(config));

// Login route
app.get('/login', (req, res) => {
    res.oidc.login({ returnTo: '/profile' });
});

// Logout route
app.get('/logout', (req, res) => {
    res.oidc.logout({ returnTo: '/landing' });
});

// Authorize route
app.get('/authorize', (req, res) => {
    res.oidc.login({
        authorizationParams: {
            prompt: 'none',
            redirect_uri: `${process.env.AUTH0_BASE_URL}/callback`
        },
        returnTo: '/profile'
    });
});

// Authentication status check endpoint
app.get('/auth/status', (req, res) => {
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

// Middleware to check if the user is authenticated and has selected a world
function checkWorldSelection(req, res, next) {
    if (!req.oidc.isAuthenticated()) {
        return res.redirect('/');
    }
    if (!req.query.worldId) {
        return res.redirect('/profile');
    }
    next();
}

// Middleware to check if the user is authenticated and redirect if not
function ensureAuthenticated(req, res, next) {
    if (!req.oidc.isAuthenticated()) {
        return res.redirect('/landing.html');
    }
    next();
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

// Serve index.html with world selection and authentication check
app.get('/index.html', ensureAuthenticated, checkWorldSelection, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fetch all worlds
app.get('/api/worlds', ensureAuthenticated, async (req, res) => {
    try {
        const worlds = await World.find({});
        res.json(worlds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch characters by world ID
app.get('/api/characters', ensureAuthenticated, async (req, res) => {
    try {
        const { worldId } = req.query;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        const characters = await Character.find({ world: worldId });
        res.json(characters);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch Game Info
app.get('/api/game-info', ensureAuthenticated, async (req, res) => {
    try {
        const worldId = req.query.worldId;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        const plot = await Plot.findOne({ world: new mongoose.Types.ObjectId(worldId) }).populate({
            path: 'quests',
            model: 'Quest'
        });
        if (!plot) {
            return res.status(404).send('Plot not found');
        }
        res.json(plot);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Fetch Quest Details
app.get('/api/quest-details', ensureAuthenticated, async (req, res) => {
    try {
        const questId = req.query.questId;
        if (!mongoose.Types.ObjectId.isValid(questId)) {
            return res.status(400).send('Invalid questId format');
        }
        const plot = await Plot.findOne({ "quests._id": questId }, { 'quests.$': 1 }).populate({
            path: 'quests.quest',
            model: 'Quest'
        });
        if (!plot || !plot.quests.length) {
            return res.status(404).send('Quest not found');
        }
        const quest = plot.quests[0];
        res.json(quest);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Interpret User Input
app.post('/api/input', ensureAuthenticated, async (req, res) => {
    try {
        const { input } = req.body;
        const response = await actionInterpreter.interpret(input);
        res.json(response);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Create or fetch plot for a given world
app.post('/api/plot', ensureAuthenticated, async (req, res) => {
    try {
        const { worldId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        let plot = await Plot.findOne({ world: worldId }).populate({
            path: 'quests',
            model: 'Quest'
        });
        if (!plot) {
            plot = new Plot({ world: worldId, quests: [], milestones: [] });
            await plot.save();
        }
        res.json(plot);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Update Active Quest in Plot
app.put('/api/plots/:plotId', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    const { activeQuest } = req.body;
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).send('Plot not found');
        }
        const quest = await Quest.findById(activeQuest);
        if (!quest) {
            return res.status(404).send('Quest not found');
        }
        quest.status = 'Active - In progress';
        await quest.save();
        plot.activeQuest = activeQuest;
        await plot.save();
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});

// Create a new character
app.post('/api/characters', ensureAuthenticated, async (req, res) => {
    try {
        const character = new Character(req.body);
        await character.save();
        res.status(201).json(character);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get a character by ID
app.get('/api/characters/:id', ensureAuthenticated, async (req, res) => {
    try {
        const character = await Character.findById(req.params.id).populate('currentStatus.location').populate('originLocation');
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        res.json(character);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update a character
app.put('/api/characters/:id', ensureAuthenticated, async (req, res) => {
    try {
        const character = await Character.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        res.json(character);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete a character
app.delete('/api/characters/:id', ensureAuthenticated, async (req, res) => {
    try {
        const character = await Character.findByIdAndDelete(req.params.id);
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Assign character to plot and fetch plot details
app.post('/api/assign-character', ensureAuthenticated, async (req, res) => {
    try {
        const { characterId, plotId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(characterId) || !mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).send('Invalid ID format');
        }
        const character = await Character.findById(characterId);
        if (!character) {
            return res.status(404).send('Character not found');
        }
        const plot = await Plot.findById(plotId).populate({
            path: 'quests',
            model: 'Quest'
        });
        if (!plot) {
            return res.status(404).send('Plot not found');
        }
        character.plot = plotId;
        await character.save();
        res.json(plot);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

const httpsOptions = {
    key: fs.readFileSync('localhost-key.pem'),
    cert: fs.readFileSync('localhost.pem')
};

const PORT = process.env.PORT || 3000;
https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
});
