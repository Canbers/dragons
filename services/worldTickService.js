/**
 * worldTickService.js - Background consequence checker for Tier 0/1 actions.
 *
 * Fires after fast actions to check if the world needs to react.
 * Debounced (500ms): batches rapid actions into a single check.
 * Uses UTILITY_MODEL (nano) for speed.
 *
 * Skip conditions (no GPT call):
 *   - No NPCs present AND tension is calm
 *   - Pure flavor action in a safe area
 *   - Player just moved 1-2 tiles in a safe area
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');
const { getSettlementAndLocation } = require('./locationResolver');
const { chatCompletion, UTILITY_MODEL } = require('./gptService');
const { buildNpcPromptContext, formatTensions } = require('./npcContextService');

// Per-plot debounce timers and action buffers
const plotTimers = new Map();
const plotActions = new Map();

// Actions that rarely provoke reactions in calm scenes
const QUIET_ACTIONS = new Set(['grid_move', 'grid_click', 'grid_move_to', 'wait', 'gesture', 'flavor_action', 'look_around', 'check_exits']);

/**
 * Queue a world tick check. Debounced per-plot — batches rapid actions.
 *
 * @param {string} plotId - The plot ID
 * @param {string} input - What the player typed
 * @param {string} actionType - Classification action type
 * @param {string} result - Template/response text shown to player
 * @param {Function} callback - function(reaction) called if world reacts. reaction = { narrative, tensionChange? }
 */
function check(plotId, input, actionType, result, callback) {
    // Buffer the action
    if (!plotActions.has(plotId)) plotActions.set(plotId, []);
    plotActions.get(plotId).push({ input, actionType, result, timestamp: Date.now() });

    // Reset debounce timer
    if (plotTimers.has(plotId)) {
        clearTimeout(plotTimers.get(plotId));
    }

    plotTimers.set(plotId, setTimeout(() => {
        const actions = plotActions.get(plotId) || [];
        plotActions.delete(plotId);
        plotTimers.delete(plotId);

        // Fire-and-forget
        processCheck(plotId, actions, callback).catch(err => {
            console.error('[WorldTick] Error:', err.message);
        });
    }, 500));
}

/**
 * Process the batched actions and decide if world reacts.
 */
async function processCheck(plotId, recentActions, callback) {
    if (!recentActions || recentActions.length === 0) return;

    const startTime = Date.now();

    // Load scene context
    let tension, npcsPresent, location, settlement;
    try {
        const result = await getSettlementAndLocation(plotId);
        const sc = result.plot.current_state?.sceneContext || {};
        tension = sc.tension || 'calm';
        npcsPresent = sc.npcsPresent || [];
        location = result.location;
        settlement = result.settlement;

        // Also check POI NPCs at this location
        if (npcsPresent.length === 0 && settlement && location) {
            const npcCount = await Poi.countDocuments({
                settlement: settlement._id,
                locationId: location._id,
                type: 'npc'
            });
            if (npcCount === 0 && tension === 'calm') {
                console.log(`[WorldTick] Skip — no NPCs, calm scene (${Date.now() - startTime}ms)`);
                return;
            }
        }
    } catch (e) {
        console.error('[WorldTick] Context load failed:', e.message);
        return;
    }

    // Skip conditions
    const allQuiet = recentActions.every(a => QUIET_ACTIONS.has(a.actionType));
    if (allQuiet && tension === 'calm' && npcsPresent.length === 0) {
        console.log(`[WorldTick] Skip — all quiet actions in calm empty scene (${Date.now() - startTime}ms)`);
        return;
    }

    if (allQuiet && tension === 'calm') {
        // Even with NPCs, pure movement/flavor in calm areas rarely triggers reactions
        // 20% chance to still check — keeps world feeling alive occasionally
        if (Math.random() > 0.2) {
            console.log(`[WorldTick] Skip — quiet actions in calm scene (random skip) (${Date.now() - startTime}ms)`);
            return;
        }
    }

    // Build the action summary
    const actionSummary = recentActions.map(a =>
        `${a.actionType}: "${a.input}" → ${a.result?.substring(0, 80) || '(action taken)'}`
    ).join('\n');

    const npcList = npcsPresent.map(n =>
        `${n.name} (${n.attitude || 'neutral'}, ${n.status || 'observing'}${n.intent ? ' — ' + n.intent : ''})`
    ).join(', ');

    const prompt = `You are a world simulation. The player just took a quick action.

SCENE: ${location?.name || 'unknown'} (tension: ${tension})
NPCs PRESENT: ${npcList || 'none'}

PLAYER ACTIONS (most recent):
${actionSummary}

Does anyone or anything react? Consider:
- Would any NPC present notice and care about this?
- Is the player ignoring danger?
- Does this change the scene dynamics?

RULES:
- Most quick actions don't need reactions. Only react if it's genuinely interesting.
- Don't react to basic movement unless NPCs are paying attention to the player.
- Reactions should be brief — 1-2 sentences maximum.
- Stay in character for the NPCs. Respect their attitudes and dispositions.

If nothing noteworthy: respond with ONLY the word "none"
If something happens: respond with a brief narrative (1-2 sentences). Start with what happens, not "The..."`;

    try {
        const response = await chatCompletion(UTILITY_MODEL, [
            { role: 'system', content: 'You simulate world reactions in an RPG. Be concise. Most actions need no reaction.' },
            { role: 'user', content: prompt }
        ]);

        const text = (response.content || '').trim();
        const ms = Date.now() - startTime;

        if (!text || text.toLowerCase() === 'none' || text.toLowerCase().startsWith('no reaction') || text.length < 10) {
            console.log(`[WorldTick] No reaction (${ms}ms)`);
            return;
        }

        console.log(`[WorldTick] Reaction: "${text.substring(0, 80)}..." (${ms}ms)`);

        // Deliver reaction
        if (callback) {
            callback({ narrative: text });
        }

        // Save to game log
        try {
            const gameLogService = require('./gameLogService');
            await gameLogService.saveMessage(plotId, {
                author: 'AI',
                content: text,
                messageType: 'world_reaction'
            });
        } catch (e) {
            console.error('[WorldTick] Log save failed:', e.message);
        }

    } catch (e) {
        console.error('[WorldTick] GPT call failed:', e.message);
    }

    // Proactive NPC action (~10% chance)
    await proactiveNpcAction(plotId, location, settlement, callback);
}

/**
 * Proactive NPC action — an NPC does something on their own, independent of player.
 * Fires with ~10% probability per tick. Uses goal/problem to drive behavior.
 */
async function proactiveNpcAction(plotId, location, settlement, callback) {
    if (Math.random() > 0.10) return;
    if (!settlement || !location) return;

    try {
        // Find NPCs at current location with goals
        const npcs = await Poi.find({
            settlement: settlement._id,
            locationId: location._id,
            type: 'npc',
            goal: { $ne: null }
        }).limit(5);

        if (npcs.length === 0) return;

        // Pick one randomly
        const npc = npcs[Math.floor(Math.random() * npcs.length)];
        const npcContext = buildNpcPromptContext(npc);
        const tensionContext = formatTensions(location.tensions);

        const prompt = `An NPC is going about their life. Generate a brief (1-2 sentence) observation of what they're doing — something the player would notice in the background.

NPC:
${npcContext}

LOCATION: ${location.name}
${tensionContext}

RULES:
- Background action — NPC is NOT talking to the player.
- Action should relate to their goal, problem, or personality.
- Atmospheric: "Aldric counts coins nervously, glancing at the door." NOT "Aldric is trying to pay off his debt."
- Use second person: "You notice..." or describe what happens.
- 1-2 sentences maximum.`;

        const response = await chatCompletion(UTILITY_MODEL, [
            { role: 'system', content: 'You generate brief atmospheric NPC observations for an RPG. Be concise and evocative.' },
            { role: 'user', content: prompt }
        ]);

        const text = (response.content || '').trim();
        if (!text || text.length < 10) return;

        console.log(`[WorldTick] Proactive NPC action: ${npc.name} — "${text.substring(0, 80)}..."`);

        if (callback) {
            callback({ narrative: text });
        }

        // Save to game log
        try {
            const gameLogService = require('./gameLogService');
            await gameLogService.saveMessage(plotId, {
                author: 'AI',
                content: text,
                messageType: 'world_reaction'
            });
        } catch (e) {
            console.error('[WorldTick] Proactive log save failed:', e.message);
        }
    } catch (e) {
        console.error('[WorldTick] Proactive NPC action failed:', e.message);
    }
}

/**
 * Cancel any pending tick for a plot (e.g., when a Tier 2/3 action starts).
 */
function cancel(plotId) {
    if (plotTimers.has(plotId)) {
        clearTimeout(plotTimers.get(plotId));
        plotTimers.delete(plotId);
        plotActions.delete(plotId);
    }
}

module.exports = { check, cancel };
