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
const { summarizeLogs, simplePrompt } = require('../services/gptService');
const { getWorldAndRegionDetails } = require('../agents/world/storyTeller.js');
const questService = require('../services/questService');
const movementService = require('../services/movementService');
const regionFactory = require('../agents/world/factories/regionsFactory.js');
const settlementsFactory = require('../agents/world/factories/settlementsFactory.js');

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
// Initialization (GPT calls) happens later via POST /api/plot/:plotId/initialize
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
            // Backward compat: pick random region
            const regions = await Region.find({ world: worldId });
            if (!regions.length) {
                return res.status(404).send('No regions found in this world');
            }
            initialRegion = regions[Math.floor(Math.random() * regions.length)];
        }

        const initialSettlement = initialRegion.settlements.length
            ? initialRegion.settlements[Math.floor(Math.random() * initialRegion.settlements.length)]
            : null;

        // Use placeholder coordinates
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
                    map_data: {
                        semantic_coordinates: { x: coordinates[0], y: coordinates[1], z: 0 },
                        connections: [],
                        points_of_interest: []
                    }
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
// Performs all the GPT-heavy work: describe region, generate locations, opening narrative
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

        // Guard: already ready
        if (plot.status === 'ready' || plot.status === undefined) {
            return res.json({ status: 'ready', message: 'Plot already initialized' });
        }

        // Guard: already initializing — but allow retry if stuck for >2 minutes
        if (plot.status === 'initializing') {
            const updatedAt = plot.updatedAt || plot._id.getTimestamp();
            const stuckMs = Date.now() - new Date(updatedAt).getTime();
            if (stuckMs < 120000) {
                return res.json({ status: 'initializing', message: 'Plot initialization already in progress' });
            }
            // Stuck for >2 min — treat as failed, allow re-init
            console.warn(`[Init] Plot ${plot._id} stuck at 'initializing' for ${Math.round(stuckMs/1000)}s, resetting`);
        }

        // Begin SSE stream for 'created' or 'error' status
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const sendEvent = (type, data) => {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        };

        // Mark as initializing
        plot.status = 'initializing';
        await plot.save();

        try {
            const regionId = plot.current_state.current_location.region;
            const settlementRef = plot.current_state.current_location.settlement;

            // Step 1: Describe region + starting settlement in parallel (not ALL settlements)
            sendEvent('progress', { step: 1, total: 3, message: 'Describing the region...' });

            const region = await Region.findById(regionId);
            const needsRegionDescribe = !region.described;
            const settlementDoc = settlementRef ? await Settlement.findById(settlementRef) : null;
            const needsSettlementDescribe = settlementDoc && !settlementDoc.described;

            // Run region describe + settlement describe in parallel
            const parallelTasks = [];
            if (needsRegionDescribe) {
                parallelTasks.push(regionFactory.describe(regionId));
            }
            if (needsSettlementDescribe) {
                parallelTasks.push(settlementsFactory.describe([settlementRef._id || settlementRef]));
            }
            if (parallelTasks.length > 0) {
                await Promise.all(parallelTasks);
            }

            // Step 2: Generate locations in the starting settlement
            sendEvent('progress', { step: 2, total: 3, message: 'Generating locations...' });
            let startingLocationName = null;
            let settlement = null;
            if (settlementRef) {
                startingLocationName = await settlementsFactory.ensureLocations(settlementRef);
                settlement = await Settlement.findById(settlementRef);
            }

            // Step 3: Update plot with real names/coordinates, create game log
            sendEvent('progress', { step: 3, total: 3, message: 'Preparing your starting position...' });
            const freshRegion = await Region.findById(regionId);

            if (settlement) {
                plot.current_state.current_location.locationName = startingLocationName || settlement.name || 'Starting Settlement';
                plot.current_state.current_location.locationDescription = settlement.description || 'A place to begin your journey.';
                plot.current_state.current_location.description = settlement.description || 'A place to begin your journey.';
                if (settlement.coordinates && settlement.coordinates.length > 0) {
                    const idx = Math.floor(Math.random() * settlement.coordinates.length);
                    const coords = settlement.coordinates[idx] || [0, 0];
                    plot.current_state.current_location.coordinates = coords;
                    plot.current_state.current_location.map_data.semantic_coordinates = { x: coords[0], y: coords[1], z: 0 };
                }
            } else if (freshRegion) {
                plot.current_state.current_location.locationName = freshRegion.name || 'Starting Region';
                plot.current_state.current_location.locationDescription = freshRegion.description || 'An unexplored land awaits.';
                plot.current_state.current_location.description = freshRegion.description || 'An unexplored land awaits.';
            }
            await plot.save();

            // Sync locationId if settlement has locations
            if (settlementRef) {
                await movementService.syncLocationId(plot._id);
            }

            // Reload plot to get synced data
            const updatedPlot = await Plot.findById(plot._id);
            const finalLocationName = updatedPlot.current_state.current_location.locationName;
            const locationDesc = updatedPlot.current_state.current_location.locationDescription;
            const settlementName = settlement ? settlement.name : (freshRegion ? freshRegion.name : 'the wilds');

            // Create opening narrative and game log

            const openingMessage = `You arrive at ${finalLocationName} in ${settlementName}.\n\n${locationDesc}\n\nThe world stretches before you—alive, indifferent, and full of possibility. What will you do?`;

            const gameLog = new GameLog({
                plotId: plot._id,
                messages: [{
                    author: 'AI',
                    content: openingMessage,
                    timestamp: new Date()
                }]
            });
            await gameLog.save();

            updatedPlot.gameLogs.push(gameLog._id);
            updatedPlot.status = 'ready';
            await updatedPlot.save();

            sendEvent('complete', { message: 'Your adventure is ready!', locationName: finalLocationName });
            res.end();

            // Fire-and-forget background tasks — don't block the player
            // Describe remaining settlements in the region
            regionFactory.describeSettlements(regionId).catch(err => {
                console.error('[Init] Background settlement description failed:', err.message);
            });

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

    // Validate inputs
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

        // Initialize settings if they don't exist
        if (!plot.settings) {
            plot.settings = { tone: 'classic', difficulty: 'casual' };
        }

        // Update only provided fields
        if (tone) plot.settings.tone = tone;
        if (difficulty) plot.settings.difficulty = difficulty;

        await plot.save();
        res.json({
            message: 'Settings updated',
            settings: plot.settings
        });
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

        // Get recent game logs
        const logs = await GameLog.find({ plotId: plotId })
            .sort({ _id: -1 })
            .limit(5); // Get last few log documents

        if (logs.length === 0 || (logs.length === 1 && logs[0].messages.length === 0)) {
            return res.json({
                summary: "Your adventure has just begun. The world awaits your first actions.",
                keyEvents: []
            });
        }

        // Build context for summary - flat map all messages from logs
        const allMessages = logs.reverse().flatMap(log => log.messages);
        const logText = allMessages.map(l => `${l.author}: ${l.content}`).join('\n');
        const worldName = plot.world?.name || 'Unknown World';
        const locationName = plot.current_state?.current_location?.settlement?.name ||
                            plot.current_state?.current_location?.region?.name || 'Unknown';

        // Use GPT to generate summary
        const summaryPrompt = `Summarize this adventure in 3-4 sentences. Focus on key events, decisions, and their consequences. Write it as a story recap, in past tense.

World: ${worldName}
Current Location: ${locationName}

Recent Events:
${logText}

Respond in JSON:
{
    "summary": "Your narrative summary here",
    "keyEvents": ["Event 1", "Event 2", "Event 3"]
}`;

        const response = await simplePrompt('gpt-5-mini',
            'You write concise story summaries for RPG adventures.',
            summaryPrompt
        );

        const result = JSON.parse(response.content);
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
        const currentLocationName = plot.current_state.current_location.locationName;

        // Find current location within settlement (if we have locations)
        let currentLocation = null;
        let connections = [];
        let pois = [];

        if (settlement?.locations?.length > 0) {
            currentLocation = settlement.locations.find(l =>
                l.name.toLowerCase() === currentLocationName?.toLowerCase()
            ) || settlement.locations.find(l => l.isStartingLocation) || settlement.locations[0];

            if (currentLocation) {
                connections = currentLocation.connections || [];
                pois = await Poi.find({
                    settlement: settlement._id,
                    locationId: currentLocation._id,
                    discovered: true
                });
            }
        }

        // Build response with three zoom levels of data
        res.json({
            // Region view data
            region: {
                name: region?.name || 'Unknown Region',
                description: region?.description || '',
                map: region?.map || null,  // The terrain array for canvas rendering
                settlements: []  // TODO: Add other settlements with coords
            },

            // Local view data (locations within settlement)
            local: {
                settlementName: settlement?.name || 'Unknown Settlement',
                current: currentLocation?.name || currentLocationName || 'Unknown Location',
                currentDescription: currentLocation?.description || plot.current_state.current_location.description || '',
                connections: connections.map(c => ({
                    name: c.locationName,
                    direction: c.direction,
                    description: c.description,
                    distance: c.distance || 'adjacent'
                })),
                // All discovered locations in the settlement
                discoveredLocations: (settlement?.locations || [])
                    .filter(l => l.discovered)
                    .map(l => ({
                        name: l.name,
                        type: l.type,
                        shortDescription: l.shortDescription,
                        coordinates: l.coordinates,
                        isCurrent: l.name.toLowerCase() === currentLocation?.name?.toLowerCase()
                    }))
            },

            // Scene view data (POIs at current location)
            scene: {
                location: currentLocation?.name || currentLocationName || 'Unknown',
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

// Update map data (called after AI provides location updates)
router.patch('/plots/:plotId/map', ensureAuthenticated, async (req, res) => {
    try {
        const { connections, pois, coordinates, location_name } = req.body;
        const plot = await Plot.findById(req.params.plotId);

        if (!plot) {
            return res.status(404).json({ error: 'Plot not found' });
        }

        // Initialize if needed
        if (!plot.current_state.current_location.map_data) {
            plot.current_state.current_location.map_data = {
                semantic_coordinates: { x: 0, y: 0, z: 0 },
                connections: [],
                points_of_interest: []
            };
        }

        // Update location name if moved
        if (location_name) {
            plot.current_state.current_location.locationName = location_name;
        }

        // Merge new connections (preserve existing discovered ones)
        if (connections && Array.isArray(connections)) {
            const existingConnections = plot.current_state.current_location.map_data.connections || [];
            const mergedConnections = [...existingConnections];

            connections.forEach(newConn => {
                const existingIndex = mergedConnections.findIndex(c => c.name === newConn.name);
                if (existingIndex >= 0) {
                    // Update existing connection
                    mergedConnections[existingIndex] = {
                        ...mergedConnections[existingIndex],
                        ...newConn
                    };
                } else {
                    // Add new connection
                    mergedConnections.push(newConn);
                }
            });

            plot.current_state.current_location.map_data.connections = mergedConnections;
        }

        // Update POIs
        if (pois && Array.isArray(pois)) {
            plot.current_state.current_location.map_data.points_of_interest = pois;
        }

        // Update coordinates if provided
        if (coordinates) {
            plot.current_state.current_location.map_data.semantic_coordinates = coordinates;
        }

        await plot.save();
        res.json({ updated: true, map_data: plot.current_state.current_location.map_data });
    } catch (error) {
        console.error('Error updating map data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Execute quick action from map (travel, interact with POI, custom)
router.post('/plots/:plotId/quick-action', ensureAuthenticated, async (req, res) => {
    try {
        const { actionType, target, customPrompt, poi_id } = req.body;

        let prompt;
        switch(actionType) {
            case 'travel':
                prompt = customPrompt || `I travel to ${target}`;
                break;
            case 'poi-action':
                prompt = customPrompt; // Pre-built prompt from suggested action
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

        // Mark POI as interacted if applicable
        if (poi_id) {
            const plot = await Plot.findById(req.params.plotId);
            const poi = plot.current_state.current_location.map_data.points_of_interest.find(p => p.poi_id === poi_id);
            if (poi) {
                poi.interacted = true;
                poi.last_interaction = prompt;
                poi.interaction_count = (poi.interaction_count || 0) + 1;
                await plot.save();
            }
        }

        // Return the prompt to be submitted via the existing chat flow
        res.json({ prompt });
    } catch (error) {
        console.error('Error handling quick action:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== MOVEMENT API ==========

// Get current location with full details
router.get('/plots/:plotId/location', ensureAuthenticated, async (req, res) => {
    try {
        const locationData = await movementService.getCurrentLocation(req.params.plotId);
        res.json(locationData);
    } catch (error) {
        console.error('Error getting location:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get valid moves from current location
router.get('/plots/:plotId/moves', ensureAuthenticated, async (req, res) => {
    try {
        const moves = await movementService.getValidMoves(req.params.plotId);
        res.json({ moves });
    } catch (error) {
        console.error('Error getting valid moves:', error);
        res.status(500).json({ error: error.message });
    }
});

// Move to a connected location
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
            targetId,
            targetName,
            direction
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Also log the movement to game log
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

// Check if a move is valid (without executing)
router.post('/plots/:plotId/can-move', ensureAuthenticated, async (req, res) => {
    try {
        const { targetId, targetName, direction } = req.body;
        const result = await movementService.canMoveTo(req.params.plotId, {
            targetId,
            targetName,
            direction
        });
        res.json(result);
    } catch (error) {
        console.error('Error checking move:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync locationId from locationName (migration helper)
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

// Get POIs at current location
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

// Add or update a POI at current location
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

// Record interaction with a POI
router.post('/plots/:plotId/pois/:poiId/interact', ensureAuthenticated, async (req, res) => {
    try {
        const { interaction } = req.body;

        const poi = await Poi.findById(req.params.poiId);

        if (!poi) {
            return res.status(404).json({ error: 'POI not found' });
        }

        // Update interaction tracking
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
