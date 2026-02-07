const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ensureAuthenticated = require('../middleware/auth');
const Plot = require('../db/models/Plot.js');
const GameLog = require('../db/models/GameLog.js');
const actionInterpreter = require('../agents/actionInterpreter');
const { summarizeLogs } = require('../services/gptService');
const gameAgent = require('../services/gameAgent');

// Fetch the most recent game log associated with a plot
router.get('/game-logs/recent/:plotId', ensureAuthenticated, async (req, res) => {
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
        const { plotId, author, content, sceneEntities, discoveries, skillCheck } = req.body;
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
        const { input, inputType, plotId } = req.body;

        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        if (inputType === 'askGM') {
            // Ask GM uses the old simple path — no tools needed
            const stream = actionInterpreter.interpretStream(input, 'askGM', plotId);
            for await (const chunk of stream) {
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
        } else {
            // All player input (action + speech unified) goes through the game agent
            const stream = gameAgent.processInput(input, plotId);
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
                    case 'done':
                        // handled below
                        break;
                }
            }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (error) {
        console.error('[Stream] Error:', error.message);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
