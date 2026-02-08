const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const Plot = require('../db/models/Plot.js');
const Quest = require('../db/models/Quest.js');
const Character = require('../db/models/Character.js');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement.js');
const Poi = require('../db/models/Poi.js');
const GameLog = require('../db/models/GameLog.js');
const { generateStorySummary } = require('../services/gptService');
const { getWorldAndRegionDetails } = require('../agents/world/storyTeller.js');
const questService = require('../services/questService');
const movementService = require('../services/movementService');
const sceneGridService = require('../services/sceneGridService');
const settlementsFactory = require('../agents/world/factories/settlementsFactory.js');
const { initializePlot } = require('../services/plotInitService');
const { getCurrentLocation } = require('../services/locationResolver');

// Fetch world and region details
router.get('/world-and-region/:plotId', ensureAuthenticated, async (req, res) => {
    try {
        const plotId = req.params.plotId;
        if (!mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).send('Invalid plotId format');
        }
        const data = await getWorldAndRegionDetails(plotId);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch Game Info
router.get('/game-info', ensureAuthenticated, async (req, res) => {
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

// Fetch Quest Details
router.get('/quest-details', ensureAuthenticated, async (req, res) => {
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

// Get a plot by ID
router.get('/plots/:plotId', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId)
        if (!plot) {
            return res.status(404).json({ error: 'Game not found' });
        }
        res.json(plot);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Create plot for a given world — instant, no GPT calls
router.post('/plot', ensureAuthenticated, async (req, res) => {
    try {
        const { worldId, regionId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }

        let initialRegion;
        if (regionId && mongoose.Types.ObjectId.isValid(regionId)) {
            initialRegion = await Region.findById(regionId);
            if (!initialRegion || initialRegion.world.toString() !== worldId) {
                return res.status(400).send('Region not found in this world');
            }
        } else {
            const regions = await Region.find({ world: worldId });
            if (!regions.length) {
                return res.status(404).send('No regions found in this world');
            }
            initialRegion = regions[Math.floor(Math.random() * regions.length)];
        }

        const initialSettlement = initialRegion.settlements.length
            ? initialRegion.settlements[Math.floor(Math.random() * initialRegion.settlements.length)]
            : null;

        let coordinates = [0, 0];
        if (initialSettlement) {
            const settlement = await Settlement.findById(initialSettlement);
            if (settlement && settlement.coordinates && settlement.coordinates.length > 0) {
                const randomIndex = Math.floor(Math.random() * settlement.coordinates.length);
                coordinates = settlement.coordinates[randomIndex] || [0, 0];
            }
        } else if (initialRegion.coordinates && initialRegion.coordinates.length >= 2) {
            coordinates = initialRegion.coordinates;
        }

        const plot = new Plot({
            world: worldId,
            status: 'created',
            quests: [],
            milestones: [],
            current_state: {
                current_activity: 'exploring',
                current_location: {
                    region: initialRegion._id,
                    settlement: initialSettlement ? (initialSettlement._id || initialSettlement) : null,
                    locationId: null,
                    coordinates: coordinates,
                    locationName: initialRegion.name || 'Unknown',
                    locationDescription: initialRegion.short || 'An unexplored land awaits.',
                    description: initialRegion.short || 'An unexplored land awaits.',
                },
                current_time: 'morning',
                environment_conditions: 'clear',
                mood_tone: 'neutral'
            },
            settings: {
                tone: 'classic',
                difficulty: 'casual'
            }
        });

        await plot.save();
        res.json(plot);
    } catch (error) {
        console.error('[Plot] Error creating plot:', error);
        res.status(500).send(error.message);
    }
});

// Initialize a newly created plot — SSE endpoint with progress events
router.post('/plot/:plotId/initialize', ensureAuthenticated, async (req, res) => {
    try {
        const { plotId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).json({ error: 'Invalid plotId format' });
        }

        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        if (plot.status === 'ready' || plot.status === undefined) {
            return res.json({ status: 'ready', message: 'Plot already initialized' });
        }

        if (plot.status === 'initializing') {
            const updatedAt = plot.updatedAt || plot._id.getTimestamp();
            const stuckMs = Date.now() - new Date(updatedAt).getTime();
            if (stuckMs < 120000) {
                return res.json({ status: 'initializing', message: 'Plot initialization already in progress' });
            }
            console.warn(`[Init] Plot ${plot._id} stuck at 'initializing' for ${Math.round(stuckMs/1000)}s, resetting`);
        }

        // Begin SSE stream
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const sendEvent = (type, data) => {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        };

        plot.status = 'initializing';
        await plot.save();

        try {
            await initializePlot(plot, sendEvent);
            res.end();
        } catch (initError) {
            console.error('[Init] Error during initialization:', initError);
            plot.status = 'error';
            await plot.save();
            sendEvent('error', { message: 'Initialization failed. You can retry.' });
            res.end();
        }

    } catch (error) {
        console.error('[Init] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update Active Quest in Plot
router.put('/plots/:plotId', ensureAuthenticated, async (req, res) => {
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

// Update plot settings (tone/difficulty)
router.put('/plots/:plotId/settings', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    const { tone, difficulty } = req.body;

    const validTones = ['dark', 'classic', 'whimsical'];
    const validDifficulties = ['casual', 'hardcore'];

    if (tone && !validTones.includes(tone)) {
        return res.status(400).json({ error: `Invalid tone. Must be one of: ${validTones.join(', ')}` });
    }
    if (difficulty && !validDifficulties.includes(difficulty)) {
        return res.status(400).json({ error: `Invalid difficulty. Must be one of: ${validDifficulties.join(', ')}` });
    }

    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        if (!plot.settings) {
            plot.settings = { tone: 'classic', difficulty: 'casual' };
        }

        if (tone) plot.settings.tone = tone;
        if (difficulty) plot.settings.difficulty = difficulty;

        await plot.save();
        res.json({ message: 'Settings updated', settings: plot.settings });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get plot settings
router.get('/plots/:plotId/settings', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }
        res.json(plot.settings || { tone: 'classic', difficulty: 'casual' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get scene context
router.get('/plots/:plotId/scene-context', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }
        res.json(plot.current_state?.sceneContext || {});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get scene grid data for tile-based interior map
router.get('/plots/:plotId/scene-grid', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');

        if (!plot) return res.status(404).json({ error: 'Plot not found' });

        const settlement = plot.current_state?.current_location?.settlement;
        const locationId = plot.current_state?.current_location?.locationId;

        if (!settlement || !locationId) {
            return res.json({ grid: null, message: 'No location data' });
        }

        const currentLoc = settlement.locations?.find(
            l => l._id.toString() === locationId.toString()
        );

        if (!currentLoc?.gridGenerated || !currentLoc.interiorGrid) {
            return res.json({ grid: null, message: 'Grid not generated yet' });
        }

        const pois = await Poi.find({
            settlement: settlement._id,
            locationId: currentLoc._id
        });

        const entities = pois
            .filter(p => p.gridPosition?.x != null)
            .map(p => ({
                id: p._id.toString(),
                name: p.name,
                type: p.type,
                gridPosition: p.gridPosition,
                discovered: p.discovered,
                icon: p.icon || ''
            }));

        // Ensure player has a grid position
        let playerPosition = plot.current_state?.gridPosition || null;
        if (!playerPosition || playerPosition.x == null) {
            playerPosition = sceneGridService.findPlayerStart(currentLoc.interiorGrid);
            plot.current_state.gridPosition = playerPosition;
            plot.markModified('current_state.gridPosition');
            await plot.save();
        }

        // Ambient NPCs — backfill for grids generated before ambient system
        let ambientNpcs = (currentLoc.ambientNpcs || []).map(a => ({ x: a.x, y: a.y }));
        if (ambientNpcs.length === 0 && currentLoc.interiorGrid) {
            const occupied = new Set();
            for (const e of entities) {
                if (e.gridPosition?.x != null) occupied.add(`${e.gridPosition.x},${e.gridPosition.y}`);
            }
            if (playerPosition) occupied.add(`${playerPosition.x},${playerPosition.y}`);
            const popLevel = currentLoc.populationLevel || 'populated';
            const generated = sceneGridService.generateAmbientNpcs(currentLoc.interiorGrid, popLevel, occupied);
            currentLoc.ambientNpcs = generated;
            await settlement.save();
            ambientNpcs = generated.map(a => ({ x: a.x, y: a.y }));
        }

        const exits = (currentLoc.connections || []).map(conn => ({
            name: conn.locationName,
            direction: conn.direction
        }));

        res.json({
            grid: currentLoc.interiorGrid,
            width: currentLoc.interiorGrid[0]?.length || 0,
            height: currentLoc.interiorGrid.length,
            playerPosition,
            entities,
            ambientNpcs,
            exits,
            gridParams: currentLoc.gridParams
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get quest journal (player-visible quests)
router.get('/plots/:plotId/quests', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const quests = await questService.getJournalQuests(plotId);
        res.json(quests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Track a discovered quest (player activates it)
router.post('/plots/:plotId/quests/:questId/track', ensureAuthenticated, async (req, res) => {
    const { plotId, questId } = req.params;
    try {
        const result = await questService.activateQuest(plotId, questId);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get plot reputation
router.get('/plots/:plotId/reputation', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }
        res.json(plot.reputation || { npcs: [], factions: [], locations: [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get world changes caused by player
router.get('/plots/:plotId/world-changes', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }
        res.json(plot.worldChanges || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate AI story summary
router.get('/plots/:plotId/story-summary', ensureAuthenticated, async (req, res) => {
    const { plotId } = req.params;
    try {
        const plot = await Plot.findById(plotId)
            .populate('world')
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');

        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        const logs = await GameLog.find({ plotId: plotId })
            .sort({ _id: -1 })
            .limit(5);

        const allMessages = logs.reverse().flatMap(log => log.messages);
        const worldName = plot.world?.name || 'Unknown World';
        const locationName = plot.current_state?.current_location?.settlement?.name ||
                            plot.current_state?.current_location?.region?.name || 'Unknown';

        const result = await generateStorySummary(worldName, locationName, allMessages);
        res.json(result);
    } catch (error) {
        console.error('Error generating story summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== SEMANTIC MAP API ==========

// Get map data for current location
router.get('/plots/:plotId/map', ensureAuthenticated, async (req, res) => {
    try {
        const plot = await Plot.findById(req.params.plotId)
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');

        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        const region = plot.current_state.current_location.region;
        const settlement = plot.current_state.current_location.settlement;
        const { location: currentLocation } = getCurrentLocation(plot, settlement);

        let connections = [];
        let pois = [];

        if (currentLocation) {
            connections = currentLocation.connections || [];
            pois = await Poi.find({
                settlement: settlement._id,
                locationId: currentLocation._id,
                discovered: true
            });
        }

        res.json({
            region: {
                name: region?.name || 'Unknown Region',
                description: region?.description || '',
                map: region?.map || null,
                settlements: []
            },
            local: {
                settlementName: settlement?.name || 'Unknown Settlement',
                current: currentLocation?.name || plot.current_state.current_location.locationName || 'Unknown Location',
                currentDescription: currentLocation?.description || plot.current_state.current_location.description || '',
                connections: connections.map(c => ({
                    name: c.locationName,
                    direction: c.direction,
                    description: c.description,
                    distance: c.distance || 'adjacent'
                })),
                discoveredLocations: (settlement?.locations || [])
                    .filter(l => l.discovered)
                    .map(l => ({
                        name: l.name,
                        type: l.type,
                        shortDescription: l.shortDescription,
                        coordinates: l.coordinates,
                        isCurrent: currentLocation && l._id.toString() === currentLocation._id.toString()
                    }))
            },
            scene: {
                location: currentLocation?.name || plot.current_state.current_location.locationName || 'Unknown',
                description: currentLocation?.description || '',
                pois: pois.map(p => ({
                    id: p._id,
                    name: p.name,
                    type: p.type,
                    description: p.description,
                    icon: p.icon,
                    interactionCount: p.interactionCount || 0
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching map data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Execute quick action from map
router.post('/plots/:plotId/quick-action', ensureAuthenticated, async (req, res) => {
    try {
        const { actionType, target, customPrompt, poi_id } = req.body;

        let prompt;
        switch(actionType) {
            case 'travel':
                prompt = customPrompt || `I travel to ${target}`;
                break;
            case 'poi-action':
                prompt = customPrompt;
                break;
            case 'poi-custom':
                prompt = `${customPrompt} (interacting with ${target})`;
                break;
            case 'location-info':
                prompt = `Tell me more about ${target}`;
                break;
            case 'location-scout':
                prompt = `I scout ahead toward ${target}`;
                break;
            case 'location-custom':
                prompt = `Regarding ${target}: ${customPrompt}`;
                break;
            default:
                prompt = customPrompt;
        }

        if (poi_id) {
            const poi = await Poi.findById(poi_id);
            if (poi) {
                poi.interactionCount = (poi.interactionCount || 0) + 1;
                poi.lastInteraction = prompt?.substring(0, 200);
                poi.discovered = true;
                await poi.save();
            }
        }

        res.json({ prompt });
    } catch (error) {
        console.error('Error handling quick action:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== MOVEMENT API ==========

router.get('/plots/:plotId/location', ensureAuthenticated, async (req, res) => {
    try {
        const locationData = await movementService.getCurrentLocation(req.params.plotId);
        res.json(locationData);
    } catch (error) {
        console.error('Error getting location:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/plots/:plotId/moves', ensureAuthenticated, async (req, res) => {
    try {
        const moves = await movementService.getValidMoves(req.params.plotId);
        res.json({ moves });
    } catch (error) {
        console.error('Error getting valid moves:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/plots/:plotId/move', ensureAuthenticated, async (req, res) => {
    try {
        const { targetId, targetName, direction } = req.body;

        if (!targetId && !targetName && !direction) {
            return res.status(400).json({
                error: 'Must provide targetId, targetName, or direction',
                errorCode: 'MISSING_TARGET'
            });
        }

        const result = await movementService.moveToLocation(req.params.plotId, {
            targetId, targetName, direction
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        const plot = await Plot.findById(req.params.plotId).populate('gameLogs');

        if (plot && result.narration) {
            let gameLog = plot.gameLogs[plot.gameLogs.length - 1];
            if (!gameLog || gameLog.messages?.length >= 50) {
                gameLog = new GameLog({ plotId: req.params.plotId, messages: [] });
                plot.gameLogs.push(gameLog._id);
                await plot.save();
            } else {
                gameLog = await GameLog.findById(gameLog._id);
            }

            gameLog.messages.push({
                author: 'System',
                content: result.narration,
                timestamp: new Date()
            });
            await gameLog.save();
        }

        res.json(result);
    } catch (error) {
        console.error('Error moving:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/plots/:plotId/can-move', ensureAuthenticated, async (req, res) => {
    try {
        const { targetId, targetName, direction } = req.body;
        const result = await movementService.canMoveTo(req.params.plotId, {
            targetId, targetName, direction
        });
        res.json(result);
    } catch (error) {
        console.error('Error checking move:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/plots/:plotId/sync-location', ensureAuthenticated, async (req, res) => {
    try {
        const locationId = await movementService.syncLocationId(req.params.plotId);
        res.json({ synced: !!locationId, locationId });
    } catch (error) {
        console.error('Error syncing location:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== POI (Points of Interest) API ==========

router.get('/plots/:plotId/pois', ensureAuthenticated, async (req, res) => {
    try {
        const locationData = await movementService.getCurrentLocation(req.params.plotId);
        res.json({
            location: locationData.location?.name || 'Unknown',
            pois: locationData.pois || []
        });
    } catch (error) {
        console.error('Error getting POIs:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/plots/:plotId/pois', ensureAuthenticated, async (req, res) => {
    try {
        const { name, type, description, icon, persistent } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'POI name is required' });
        }

        const plot = await Plot.findById(req.params.plotId)
            .populate('current_state.current_location.settlement');

        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        const settlementId = plot.current_state.current_location.settlement?._id;
        const locationName = plot.current_state.current_location.locationName;

        if (!settlementId || !locationName) {
            return res.status(400).json({ error: 'Not at a valid location' });
        }

        const poi = await settlementsFactory.addPoi(settlementId, locationName, {
            name,
            type: type || 'other',
            description: description || '',
            icon: icon || '',
            persistent: persistent !== false
        });

        if (!poi) {
            return res.status(400).json({ error: 'Failed to add POI' });
        }

        res.json({ success: true, poi });
    } catch (error) {
        console.error('Error adding POI:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/plots/:plotId/pois/:poiId/interact', ensureAuthenticated, async (req, res) => {
    try {
        const { interaction } = req.body;

        const poi = await Poi.findById(req.params.poiId);

        if (!poi) {
            return res.status(404).json({ error: 'POI not found' });
        }

        poi.interactionCount = (poi.interactionCount || 0) + 1;
        if (interaction) {
            poi.lastInteraction = interaction.substring(0, 200);
        }
        poi.discovered = true;

        await poi.save();

        res.json({
            success: true,
            poi: {
                id: poi._id,
                name: poi.name,
                interactionCount: poi.interactionCount,
                lastInteraction: poi.lastInteraction
            }
        });
    } catch (error) {
        console.error('Error recording POI interaction:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
