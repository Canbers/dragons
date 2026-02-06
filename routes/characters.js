const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const Character = require('../db/models/Character.js');
const Plot = require('../db/models/Plot.js');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement.js');

// Create a new character
router.post('/characters', ensureAuthenticated, async (req, res) => {
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
router.get('/characters', ensureAuthenticated, async (req, res) => {
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
router.get('/characters/:id', ensureAuthenticated, async (req, res) => {
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
router.put('/characters/:id', ensureAuthenticated, async (req, res) => {
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
router.delete('/characters/:id', ensureAuthenticated, async (req, res) => {
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
router.post('/assign-character', ensureAuthenticated, async (req, res) => {
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

        // Update character's plot, currentStatus.location, coordinates, locationName, and locationDescription
        character.plot = plotId;
        character.currentStatus.location = plot.current_state.current_location.settlement;
        character.currentStatus.coordinates = plot.current_state.current_location.coordinates;

        if (plot.current_state.current_location.settlement) {
            const settlement = await Settlement.findById(plot.current_state.current_location.settlement);
            character.currentStatus.locationName = settlement.name;
            character.currentStatus.locationDescription = settlement.description;
        } else {
            const region = await Region.findById(plot.current_state.current_location.region);
            character.currentStatus.locationName = region.name;
            character.currentStatus.locationDescription = region.description;
        }

        await character.save();

        res.json(plot);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

module.exports = router;
