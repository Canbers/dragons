const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const { generateWorld } = require('../agents/world/factories/worldFactory');
const World = require('../db/models/World.js');

router.post('/generate-world', ensureAuthenticated, async (req, res) => {
    try {
        const { worldName } = req.body;

        const existingWorld = await World.findOne({ name: worldName });
        if (existingWorld) {
            return res.status(400).json({ error: 'World name already exists. Please choose a different name.' });
        }

        const newWorld = await generateWorld(worldName);

        res.json(newWorld);
    } catch (error) {
        console.error("Error generating world:", error);
        res.status(500).json({ error: error.message });
    }
});

// Fetch all worlds
router.get('/worlds', ensureAuthenticated, async (req, res) => {
    try {
        const worlds = await World.find({});
        res.json(worlds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch World Details
router.get('/worlds/:worldId', ensureAuthenticated, async (req, res) => {
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

module.exports = router;
