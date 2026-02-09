const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const Plot = require('../db/models/Plot.js');
const GameLog = require('../db/models/GameLog.js');
const actionInterpreter = require('../agents/actionInterpreter');
const { summarizeLogs } = require('../services/gptService');
const gameAgent = require('../services/gameAgent');
const inputClassifier = require('../services/inputClassifier');
const fastActionService = require('../services/fastActionService');
const worldTickService = require('../services/worldTickService');

// Fetch recent game log messages for a plot (spans log boundaries)
router.get('/game-logs/recent/:plotId', ensureAuthenticated, async (req, res) => {
    try {
        const plotId = req.params.plotId;
        const limit = parseInt(req.query.limit, 10) || 20;
        if (!mongoose.Types.ObjectId.isValid(plotId)) {
            return res.status(400).send('Invalid plotId format');
        }

        const gameLogService = require('../services/gameLogService');
        const messages = await gameLogService.getRecentMessages(plotId, limit, false);

        if (!messages.length) {
            return res.status(404).send('No game logs found for this plot');
        }

        // Get the current log ID for the client
        const currentLog = await GameLog.findOne({ plotId }).sort({ _id: -1 });
        res.json({ messages, logId: currentLog?._id });
    } catch (error) {
        console.error(`Error processing request for recent game logs: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});



router.get('/game-logs/:gameLogId/:plotId', ensureAuthenticated, async (req, res) => {
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
router.post('/game-logs', ensureAuthenticated, async (req, res) => {
    try {
        const { plotId, author, content, sceneEntities, discoveries, skillCheck, questUpdates } = req.body;
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

        const message = { author, content };
        if (sceneEntities) message.sceneEntities = sceneEntities;
        if (discoveries && discoveries.length > 0) message.discoveries = discoveries;
        if (skillCheck) message.skillCheck = skillCheck;
        if (questUpdates && questUpdates.length > 0) message.questUpdates = questUpdates;
        gameLog.messages.push(message);
        await gameLog.save();

        res.status(201).json(gameLog);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Streaming endpoint for real-time AI responses
router.post('/input/stream', ensureAuthenticated, async (req, res) => {
    try {
        const { input, inputType, plotId, moveTarget } = req.body;

        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        if (inputType === 'askGM') {
            // Ask GM uses the old simple path — no tools needed
            const stream = actionInterpreter.interpretStream(input, 'askGM', plotId);
            let fullResponse = '';
            for await (const chunk of stream) {
                fullResponse += chunk;
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
            // Save both messages to game log
            try {
                const gameLogService = require('../services/gameLogService');
                await gameLogService.saveMessage(plotId, { author: 'Player', content: input });
                await gameLogService.saveMessage(plotId, { author: 'AI', content: fullResponse });
            } catch (e) {
                console.error('[AskGM] Game log save failed:', e.message);
            }
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } else {
            // Classify input to determine processing tier
            const classification = await inputClassifier.classify(input, plotId, { moveTarget });

            // Tier 0/1: fast path. Tier 2/3: full game agent.
            let stream;
            if (classification.tier <= 1) {
                // Set up world tick callback — streams reactions after done
                const worldTickCallback = (playerInput, actionType, result) => {
                    worldTickService.check(plotId, playerInput, actionType, result, (reaction) => {
                        try {
                            res.write(`data: ${JSON.stringify({ world_reaction: reaction.narrative })}\n\n`);
                        } catch (e) {
                            // Connection may be closed
                        }
                    });
                };
                stream = fastActionService.execute(input, plotId, classification, { moveTarget, worldTickCallback });
            } else {
                // Cancel any pending world ticks — full agent handles its own context
                worldTickService.cancel(plotId);
                stream = gameAgent.processInput(input, plotId, { moveTarget });
            }

            for await (const event of stream) {
                switch (event.type) {
                    case 'tool_call':
                        res.write(`data: ${JSON.stringify({ tool_call: event.display })}\n\n`);
                        break;
                    case 'chunk':
                        res.write(`data: ${JSON.stringify({ chunk: event.content })}\n\n`);
                        break;
                    case 'scene_entities':
                        res.write(`data: ${JSON.stringify({ scene_entities: event.entities })}\n\n`);
                        break;
                    case 'discoveries':
                        res.write(`data: ${JSON.stringify({ discoveries: event.entities })}\n\n`);
                        break;
                    case 'skill_check':
                        res.write(`data: ${JSON.stringify({ skill_check: event.data })}\n\n`);
                        break;
                    case 'debug':
                        res.write(`data: ${JSON.stringify({ debug: { category: event.category, message: event.message, detail: event.detail } })}\n\n`);
                        break;
                    case 'categorized_actions':
                        res.write(`data: ${JSON.stringify({ categorized_actions: event.categories })}\n\n`);
                        break;
                    case 'suggested_actions':
                        res.write(`data: ${JSON.stringify({ suggested_actions: event.actions })}\n\n`);
                        break;
                    case 'scene_context':
                        res.write(`data: ${JSON.stringify({ scene_context: event.context })}\n\n`);
                        break;
                    case 'quest_discovered':
                        res.write(`data: ${JSON.stringify({ quest_discovered: event.quests })}\n\n`);
                        break;
                    case 'quest_update':
                        res.write(`data: ${JSON.stringify({ quest_update: event.data })}\n\n`);
                        break;
                    case 'grid_updated':
                        res.write(`data: ${JSON.stringify({ grid_updated: true })}\n\n`);
                        break;
                    case 'world_reaction':
                        res.write(`data: ${JSON.stringify({ world_reaction: event.content })}\n\n`);
                        break;
                    case 'done':
                        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                        break;
                }
            }

            // For fast-path actions, keep connection open briefly for world tick reactions
            if (classification.tier <= 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        res.end();
    } catch (error) {
        console.error('[Stream] Error:', error.message);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
