/**
 * gameLogService.js - Central persistence layer for game log messages.
 *
 * All GameLog writes and reads go through here. Handles:
 * - Automatic log rotation at 50 messages
 * - Fire-and-forget summarization of full logs
 * - Cross-log-boundary retrieval
 * - Duplicate message protection
 */

const GameLog = require('../db/models/GameLog');
const Plot = require('../db/models/Plot');

const MAX_MESSAGES_PER_LOG = 50;

/**
 * Save a message to the game log, with automatic rotation.
 *
 * @param {string} plotId - The plot ID
 * @param {Object} message - { author, content, sceneEntities?, discoveries?, skillCheck?, questUpdates? }
 */
async function saveMessage(plotId, message) {
    // Find the most recent log for this plot
    let currentLog = await GameLog.findOne({ plotId }).sort({ _id: -1 });

    // Rotate if no log exists or current log is full
    if (!currentLog || currentLog.messages.length >= MAX_MESSAGES_PER_LOG) {
        if (currentLog && currentLog.messages.length >= MAX_MESSAGES_PER_LOG) {
            // Fire-and-forget summarization on the full log
            summarizeInBackground(currentLog._id, currentLog.messages);
        }

        // Create new log and link to plot
        currentLog = new GameLog({ plotId, messages: [] });
        await currentLog.save();
        await Plot.findByIdAndUpdate(plotId, { $push: { gameLogs: currentLog._id } });
    }

    // Duplicate check: skip if last message has same author + content
    const lastMsg = currentLog.messages[currentLog.messages.length - 1];
    if (lastMsg && lastMsg.author === message.author && lastMsg.content === message.content) {
        return currentLog;
    }

    // Build the message object
    const msg = {
        author: message.author,
        content: message.content,
        timestamp: new Date()
    };
    if (message.sceneEntities) msg.sceneEntities = message.sceneEntities;
    if (message.discoveries?.length > 0) msg.discoveries = message.discoveries;
    if (message.skillCheck) msg.skillCheck = message.skillCheck;
    if (message.questUpdates?.length > 0) msg.questUpdates = message.questUpdates;
    if (message.messageType) msg.messageType = message.messageType;

    currentLog.messages.push(msg);
    await currentLog.save();
    return currentLog;
}

/**
 * Get recent messages across log boundaries.
 *
 * @param {string} plotId - The plot ID
 * @param {number} limit - Max messages to return (default 20)
 * @param {boolean} includeSummaries - If true, prepend older logs' summaries as System entries
 * @returns {Array} Messages in chronological order (oldest first)
 */
async function getRecentMessages(plotId, limit = 20, includeSummaries = false) {
    // Fetch logs newest-first
    const logs = await GameLog.find({ plotId }).sort({ _id: -1 });
    if (!logs.length) return [];

    const collected = [];
    let remaining = limit;

    for (const log of logs) {
        if (remaining <= 0) break;

        const msgs = log.messages || [];
        if (msgs.length <= remaining) {
            // Take all messages from this log
            collected.unshift(...msgs.map(m => m.toObject ? m.toObject() : m));
            remaining -= msgs.length;

            // If we took all messages and there are older logs, include the summary
            if (includeSummaries && log.summary && remaining > 0) {
                collected.unshift({
                    author: 'System',
                    type: 'summary',
                    content: log.summary,
                    timestamp: msgs[0]?.timestamp || new Date()
                });
                remaining--;
            }
        } else {
            // Take only the most recent `remaining` messages from this log
            const slice = msgs.slice(-remaining).map(m => m.toObject ? m.toObject() : m);
            collected.unshift(...slice);
            remaining = 0;
        }
    }

    // If includeSummaries, add summaries from logs we didn't pull messages from
    if (includeSummaries && remaining > 0) {
        // We've exhausted messages from logs we visited; check remaining older logs
        // (already handled in the loop above)
    }

    return collected; // chronological order (oldest first)
}

/**
 * Fire-and-forget GPT summarization of a full log.
 *
 * @param {string} logId - The GameLog _id
 * @param {Array} messages - The messages to summarize
 */
function summarizeInBackground(logId, messages) {
    (async () => {
        try {
            const { summarizeLogs } = require('./gptService');
            const summary = await summarizeLogs(messages);
            await GameLog.findByIdAndUpdate(logId, { $set: { summary } });
            console.log(`[GameLogService] Summarized log ${logId}`);
        } catch (err) {
            console.error('[GameLogService] Summarization failed:', err.message);
        }
    })();
}

/**
 * Save a quick (Tier 0/1) action in compressed format.
 * Merges consecutive quick actions into a single entry to prevent history bloat.
 *
 * @param {string} plotId - The plot ID
 * @param {string} playerInput - What the player typed
 * @param {string} actionType - Classification action type (e.g., 'grid_move', 'look_around')
 */
async function saveQuickAction(plotId, playerInput, actionType) {
    let currentLog = await GameLog.findOne({ plotId }).sort({ _id: -1 });

    if (!currentLog || currentLog.messages.length >= MAX_MESSAGES_PER_LOG) {
        if (currentLog && currentLog.messages.length >= MAX_MESSAGES_PER_LOG) {
            summarizeInBackground(currentLog._id, currentLog.messages);
        }
        currentLog = new GameLog({ plotId, messages: [] });
        await currentLog.save();
        await Plot.findByIdAndUpdate(plotId, { $push: { gameLogs: currentLog._id } });
    }

    const lastMsg = currentLog.messages[currentLog.messages.length - 1];

    // If last message was also a quick action, merge into it
    if (lastMsg && lastMsg.messageType === 'quick_action') {
        // Append to the compressed entry
        const prevContent = lastMsg.content || '';
        const separator = prevContent.endsWith('.') ? ' ' : '. ';
        lastMsg.content = prevContent + separator + `Then: ${playerInput}`;
        lastMsg.timestamp = new Date();
        await currentLog.save();
        return currentLog;
    }

    // Otherwise create a new compressed entry
    currentLog.messages.push({
        author: 'Player',
        content: playerInput,
        messageType: 'quick_action',
        timestamp: new Date()
    });
    await currentLog.save();
    return currentLog;
}

module.exports = { saveMessage, getRecentMessages, summarizeInBackground, saveQuickAction };
