const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement.js');
const World = require('../db/models/World.js');
const { simplePrompt } = require('../services/gptService');

// Fetch Regions by World ID
router.get('/regions/:worldId', ensureAuthenticated, async (req, res) => {
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

// Fetch a specific region by ID
router.get('/region/:regionId', ensureAuthenticated, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        if (!mongoose.Types.ObjectId.isValid(regionId)) {
            return res.status(400).send('Invalid regionId format');
        }
        const region = await Region.findById(regionId); // Fetch the full region record
        if (!region) {
            return res.status(404).send('Region not found');
        }
        res.json(region); // Return the full region record
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Region selection screen: returns regions instantly from DB (no GPT)
router.get('/worlds/:worldId/region-selection', ensureAuthenticated, async (req, res) => {
    try {
        const { worldId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }

        const regions = await Region.find({ world: worldId }).populate('ecosystem');
        const describedRegions = regions.filter(r => r.described && r.name);

        if (describedRegions.length === 0) {
            return res.status(404).json({ error: 'No described regions found in this world' });
        }

        const result = describedRegions.map(r => ({
            _id: r._id,
            name: r.name,
            short: r.short || r.description || '',
            ecosystem: { name: r.ecosystem?.name || 'Unknown' },
            hook: null
        }));

        res.json(result);
    } catch (error) {
        console.error('[RegionSelection] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generate adventure hooks for regions (called async by frontend after cards render)
router.get('/worlds/:worldId/region-hooks', ensureAuthenticated, async (req, res) => {
    try {
        const { worldId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }

        const world = await World.findById(worldId);
        if (!world) {
            return res.status(404).send('World not found');
        }

        const regions = await Region.find({ world: worldId }).populate('ecosystem');
        const describedRegions = regions.filter(r => r.described && r.name);

        const regionList = describedRegions.map(r =>
            `- ${r.name}: ${r.short || r.description || 'A mysterious region'} (Ecosystem: ${r.ecosystem?.name || 'unknown'})`
        ).join('\n');

        const hookPrompt = `You are creating adventure hooks for a tabletop RPG world called "${world.name}".
${world.description ? `World description: ${world.description}` : ''}

For each region below, write a 1-2 sentence adventure hook that entices a player to start their journey there. The hook should hint at danger, mystery, or opportunity specific to that region.

Regions:
${regionList}

Respond in JSON format:
{
  "hooks": {
    "RegionName": "Your hook here"
  }
}`;

        const response = await simplePrompt('gpt-5-mini',
            'You write compelling adventure hooks for RPG worlds. Be concise and evocative.',
            hookPrompt
        );
        const parsed = JSON.parse(response.content);
        res.json(parsed.hooks || {});
    } catch (error) {
        console.error('[RegionHooks] Error:', error);
        res.json({});
    }
});

// Endpoint to fetch all settlements by region ID
router.get('/settlements/region/:regionId', ensureAuthenticated, async (req, res) => {
    try {
        const { regionId } = req.params;
        const settlements = await Settlement.find({ region: regionId });
        res.json(settlements);
    } catch (error) {
        console.error('Error fetching settlements:', error);
        res.status(500).json({ error: 'Failed to fetch settlements' });
    }
});

module.exports = router;
