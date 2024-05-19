const express = require('express');
const path = require('path');
const app = express();
const Plot = require('./db/models/Plot.js');
const Quest = require('./db/models/Quest.js');
const Character = require('./db/models/character.js');
const Settlement = require('./db/models/Settlement.js');
const World = require('./db/models/World.js');
const actionInterpreter = require('./agents/actionInterpreter');
const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/dragons', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch all worlds
app.get('/api/worlds', async (req, res) => {
    try {
        const worlds = await World.find({});
        res.json(worlds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch characters by world ID
app.get('/api/characters', async (req, res) => {
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
app.get('/api/game-info', async (req, res) => {
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
app.get('/api/quest-details', async (req, res) => {
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
app.post('/api/input', async (req, res) => {
    try {
        const { input } = req.body;
        const response = await actionInterpreter.interpret(input);
        res.json(response);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Create or fetch plot for a given world
app.post('/api/plot', async (req, res) => {
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
app.put('/api/plots/:plotId', async (req, res) => {
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
app.post('/api/characters', async (req, res) => {
    try {
        const character = new Character(req.body);
        await character.save();
        res.status(201).json(character);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get a character by ID
app.get('/api/characters/:id', async (req, res) => {
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
app.put('/api/characters/:id', async (req, res) => {
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
app.delete('/api/characters/:id', async (req, res) => {
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
app.post('/api/assign-character', async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
