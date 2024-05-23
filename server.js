const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const mongoose = require('mongoose');
const { auth } = require('express-openid-connect');
require('dotenv').config();
const bodyParser = require('body-parser');
const app = express();
const cors = require('cors');
const Plot = require('./db/models/Plot.js');
const Quest = require('./db/models/Quest.js');
const Character = require('./db/models/Character.js');
const Region = require('./db/models/Region'); 
const Settlement = require('./db/models/Settlement.js');
const World = require('./db/models/World.js');
const GameLog = require('./db/models/GameLog.js');
const actionInterpreter = require('./agents/actionInterpreter');
const { summarizeLogs } = require('./services/gptService');

mongoose.connect('mongodb://localhost:27017/dragons', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
app.get('/index.html', ensureAuthenticated, (req, res) => {
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

// Fetch World Details
app.get('/api/worlds/:worldId', ensureAuthenticated, async (req, res) => {
    try {
        const worldId = req.params.worldId;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        const world = await World.findById(worldId);
        if (!world) {
            return res.status(404).send('World not found');
        }
        res.json(world);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch Regions by World ID
app.get('/api/regions/:worldId', ensureAuthenticated, async (req, res) => {
    try {
        const worldId = req.params.worldId;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        const regions = await Region.find({ world: worldId });
        if (!regions) {
            return res.status(404).send('No regions found for this world');
        }
        res.json(regions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Describe settlements in a region
app.post('/api/describe-settlements/:regionId', ensureAuthenticated, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        if (!mongoose.Types.ObjectId.isValid(regionId)) {
            return res.status(400).send('Invalid regionId format');
        }
        await regionFactory.describeSettlements(regionId);
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Fetch Game Info
app.get('/api/game-info', ensureAuthenticated, async (req, res) => {
    try {
        const plotId = req.query.plotId;
        const characterId = req.query.characterId;
        if (!mongoose.Types.ObjectId.isValid(plotId) || !mongoose.Types.ObjectId.isValid(characterId)) {
            return res.status(400).send('Invalid ID format');
        }
        const plot = await Plot.findById(plotId).populate('world').populate({
            path: 'quests.quest',
            model: 'Quest'
        });
        const character = await Character.findById(characterId);
        if (!plot || !character) {
            return res.status(404).send('Plot or Character not found');
        }
        res.json({ plot, character });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Fetch the most recent game log associated with a plot
app.get('/api/game-logs/recent/:plotId', ensureAuthenticated, async (req, res) => {
    try {
        console.log(`Received request for recent game logs with plotId: ${req.params.plotId}`);
        const plotId = req.params.plotId;
        const limit = parseInt(req.query.limit, 10) || 20;  // Default to 20 if limit is not provided or invalid
        if (!mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).send('Invalid plotId format');
        }

        const plot = await Plot.findById(plotId).populate({
            path: 'gameLogs',
            options: { sort: { _id: -1 }, limit: 1 }
        });

        if (!plot || !plot.gameLogs.length) {
            console.log(`No game logs found for plotId: ${plotId}`);
            return res.status(404).send('No game logs found for this plot');
        }

        const recentMessages = plot.gameLogs[0].messages.slice(-limit);  // Get the most recent messages up to the limit
        res.json({ messages: recentMessages, logId: plot.gameLogs[0]._id });
    } catch (error) {
        console.error(`Error processing request for recent game logs: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});



app.get('/api/game-logs/:gameLogId/:plotId', ensureAuthenticated, async (req, res) => {
    try {
        const { gameLogId, plotId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(gameLogId) || !mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).send('Invalid ID format');
        }

        const plot = await Plot.findById(plotId).populate('gameLogs');
        if (!plot) {
            return res.status(404).send('Plot not found');
        }

        const currentIndex = plot.gameLogs.findIndex(log => log.equals(gameLogId));
        if (currentIndex <= 0) {
            return res.status(404).send('No older game logs found');
        }

        const olderGameLogId = plot.gameLogs[currentIndex - 1];
        const olderGameLog = await GameLog.findById(olderGameLogId);

        if (!olderGameLog) {
            return res.status(404).send('Older game log not found');
        }

        res.json({ messages: olderGameLog.messages, logId: olderGameLog._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Create or update a game log entry
app.post('/api/game-logs', ensureAuthenticated, async (req, res) => {
    try {
        const { plotId, author, content } = req.body;
        const plot = await Plot.findById(plotId).populate('gameLogs');
        if (!plot) return res.status(404).send('Plot not found');

        let gameLog = plot.gameLogs[plot.gameLogs.length - 1];
        if (!gameLog || gameLog.messages.length >= 50) {
            if (gameLog) {
                // Summarize the messages of the current game log that reached its cap
                const logsToSummarize = gameLog.messages;
                const summary = await summarizeLogs(logsToSummarize);
                gameLog.summary = summary;  // Add the summary to the same game log
                await gameLog.save();
            }

            // Create a new game log
            gameLog = new GameLog({ plotId, messages: [] });
            plot.gameLogs.push(gameLog._id);
            await plot.save();
        } else {
            gameLog = await GameLog.findById(gameLog._id);
        }

        gameLog.messages.push({ author, content });
        await gameLog.save();

        res.status(201).json(gameLog);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        const { input, actionType, plotId } = req.body;
        const cookies = req.headers.cookie; // Extract cookies from the request headers

        if (!cookies) {
            return res.status(401).send('Cookies are missing');
        }

        const response = await actionInterpreter.interpret(input, actionType, plotId, cookies);
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
        const plot = new Plot({ world: worldId, quests: [], milestones: [] });
        await plot.save();
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
        const characterData = { ...req.body, user: req.oidc.user.sub }; // Add Auth0 user ID
        const character = new Character(characterData);
        await character.save();
        res.status(201).json(character);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Fetch characters for the authenticated user
app.get('/api/characters', ensureAuthenticated, async (req, res) => {
    try {
        const characters = await Character.find({ user: req.oidc.user.sub })
            .populate({
                path: 'plot',
                populate: {
                    path: 'world',
                    model: 'World'
                }
            });
        res.json(characters);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// Assign character to plot and update plot with character details
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
            path: 'players.character',
            model: 'Character'
        });
        if (!plot) {
            return res.status(404).send('Plot not found');
        }

        // Check if the character is already in the plot
        const isCharacterInPlot = plot.players.some(player => player.character._id.equals(character._id));
        if (!isCharacterInPlot) {
            plot.players.push({
                user: character.user,
                character: character._id,
                name: character.name
            });
            await plot.save();
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
