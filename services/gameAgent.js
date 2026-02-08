/**
 * Game Agent - AI with tool-calling for grounded game responses
 *
 * Flow:
 * 1. Player sends input
 * 2. AI decides which tools to call (fast, non-streaming)
 * 3. Tools execute against the database
 * 4. AI generates narrative with tool results as context (streaming)
 *
 * Extracted services:
 * - sceneManager.js — executeGetScene, generateFirstImpression
 * - gridMovementService.js — updateGridPositions
 * - sceneContextService.js — updateSceneContextBackground
 * - toolFormatters.js — getToolDisplay, formatToolResult
 * - suggestionService.js — generateCategorizedSuggestions
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');
const Poi = require('../db/models/Poi');
const GameLog = require('../db/models/GameLog');
const { buildSystemPrompt, toolPlanPrompt, streamMessages, GAME_MODEL, UTILITY_MODEL } = require('./gptService');
const questService = require('./questService');
const spatialService = require('./spatialService');

// Extracted services
const { executeGetScene } = require('./sceneManager');
const { updateGridPositions } = require('./gridMovementService');
const { updateSceneContextBackground } = require('./sceneContextService');
const { getToolDisplay, formatToolResult } = require('./toolFormatters');
const { generateCategorizedSuggestions } = require('./suggestionService');

// ============ TOOL DEFINITIONS ============

const TOOLS = [
    {
        type: "function",
        function: {
            name: "get_scene",
            description: "Get details about the player's current location: what the place looks like, who is present, available exits, and notable objects. Call this to understand what's around the player.",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "lookup_npc",
            description: "Look up a specific NPC by name to get their attitude toward the player and past interactions. Use when the player talks to, asks about, or interacts with a named character.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Name or partial name of the NPC" }
                },
                required: ["name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "move_player",
            description: "Move the player to a connected location. ONLY call when the player explicitly wants to go somewhere (e.g. 'I go to the market', 'I head north'). Do NOT call for small movements within the same location.",
            parameters: {
                type: "object",
                properties: {
                    destination: { type: "string", description: "Name of the location to move to" }
                },
                required: ["destination"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_npc_relationship",
            description: "Update an NPC's attitude toward the player after a significant interaction. Only call when something meaningful changes the relationship (insult, help, betrayal, gift, etc).",
            parameters: {
                type: "object",
                properties: {
                    npc_name: { type: "string", description: "The NPC's name" },
                    new_disposition: {
                        type: "string",
                        enum: ["hostile", "unfriendly", "neutral", "friendly", "allied"],
                        description: "New attitude"
                    },
                    reason: { type: "string", description: "Brief reason for change" }
                },
                required: ["npc_name", "new_disposition", "reason"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "skill_check",
            description: "Call when the player attempts something with uncertain outcome that could plausibly fail. DO call for: persuasion, physical feats, risky actions, crafting, sneaking, deception, intimidation, picking locks, climbing, swimming in rough water, haggling. Do NOT call for: trivial actions, basic conversation, simple movement, looking at things, opening unlocked doors, ordering a drink.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", description: "Brief description of what the player is attempting" },
                    difficulty: { type: "string", enum: ["easy", "moderate", "hard", "extreme"] },
                    type: { type: "string", enum: ["physical", "social", "mental", "survival"] }
                },
                required: ["action", "difficulty", "type"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_quest",
            description: "Update quest progress when the player completes an objective, learns critical info, or a quest resolves. Only use for quests the player is actively tracking.",
            parameters: {
                type: "object",
                properties: {
                    quest_title: { type: "string", description: "Title of the quest to update" },
                    update_type: {
                        type: "string",
                        enum: ["objective_complete", "new_info", "quest_complete", "quest_failed"],
                        description: "Type of update"
                    },
                    summary: { type: "string", description: "Brief description of what just happened" }
                },
                required: ["quest_title", "update_type", "summary"]
            }
        }
    }
];

// ============ TOOL EXECUTORS ============

async function executeLookupNpc(plotId, npcName) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');

    const repNpc = (plot.reputation?.npcs || []).find(n =>
        n.name.toLowerCase().includes(npcName.toLowerCase())
    );

    const settlement = plot.current_state?.current_location?.settlement;
    let poiNpc = null;
    if (settlement) {
        const found = await Poi.findOne({
            settlement: settlement._id,
            type: 'npc',
            name: { $regex: new RegExp(npcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        });
        if (found) {
            poiNpc = { name: found.name, description: found.description, foundAt: found.locationName, interactionCount: found.interactionCount };
        }
    }

    if (!repNpc && !poiNpc) {
        return { found: false, name: npcName, note: 'Unknown NPC. This may be someone new — you can introduce them naturally.' };
    }

    return {
        found: true,
        name: repNpc?.name || poiNpc?.name || npcName,
        disposition: repNpc?.disposition || 'neutral',
        lastInteraction: repNpc?.lastInteraction || 'None recorded',
        location: poiNpc?.foundAt || repNpc?.location || 'Unknown',
        description: poiNpc?.description || '',
        interactionCount: poiNpc?.interactionCount || 0
    };
}

async function executeMovePlayer(plotId, destination) {
    const movementService = require('./movementService');

    const canMove = await movementService.canMoveTo(plotId, destination);
    if (!canMove.valid) {
        return { success: false, reason: canMove.reason || `Cannot reach "${destination}" from here.` };
    }

    const result = await movementService.moveToLocation(plotId, destination);
    if (!result.success) {
        return { success: false, reason: result.error || 'Movement failed.' };
    }

    return {
        success: true,
        newLocation: result.location?.name || destination,
        narration: result.narration || `You arrive at ${destination}.`
    };
}

async function executeUpdateRelationship(plotId, npcName, newDisposition, reason) {
    const plot = await Plot.findById(plotId);
    if (!plot.reputation) plot.reputation = { npcs: [], factions: [], locations: [] };
    if (!plot.reputation.npcs) plot.reputation.npcs = [];

    const existing = plot.reputation.npcs.find(n => n.name.toLowerCase() === npcName.toLowerCase());
    if (existing) {
        existing.disposition = newDisposition;
        existing.lastInteraction = reason;
    } else {
        plot.reputation.npcs.push({
            name: npcName,
            disposition: newDisposition,
            lastInteraction: reason,
            location: plot.current_state?.current_location?.locationName || 'Unknown'
        });
    }

    await plot.save();
    return { updated: true, npc: npcName, disposition: newDisposition };
}

function executeSkillCheck(action, difficulty, type) {
    const THRESHOLDS = {
        easy:     { minPass: 4,  strongPass: 16 },
        moderate: { minPass: 8,  strongPass: 16 },
        hard:     { minPass: 13, strongPass: 18 },
        extreme:  { minPass: 16, strongPass: 20 },
    };
    const t = THRESHOLDS[difficulty] || THRESHOLDS.moderate;
    const roll = Math.floor(Math.random() * 20) + 1;
    const result = roll < t.minPass ? 'fail' : roll >= t.strongPass ? 'strong_success' : 'pass';
    return { action, type, difficulty, roll, minPass: t.minPass, strongPass: t.strongPass, result };
}

async function executeUpdateQuest(plotId, questTitle, updateType, summary) {
    return await questService.updateQuestProgress(plotId, questTitle, updateType, summary);
}

async function executeTool(plotId, toolName, args) {
    switch (toolName) {
        case 'get_scene': return await executeGetScene(plotId);
        case 'lookup_npc': return await executeLookupNpc(plotId, args.name);
        case 'move_player': return await executeMovePlayer(plotId, args.destination);
        case 'update_npc_relationship': return await executeUpdateRelationship(plotId, args.npc_name, args.new_disposition, args.reason);
        case 'skill_check': return executeSkillCheck(args.action, args.difficulty, args.type);
        case 'update_quest': return await executeUpdateQuest(plotId, args.quest_title, args.update_type, args.summary);
        default: return { error: `Unknown tool: ${toolName}` };
    }
}

// ============ GET RECENT MESSAGES ============

async function getRecentMessages(plotId, limit = 10) {
    const logs = await GameLog.find({ plotId })
        .sort({ _id: -1 })
        .limit(3);

    if (!logs.length) return [];

    const allMessages = [];
    for (const log of logs) {
        for (const msg of log.messages) {
            allMessages.push(msg);
        }
    }

    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = allMessages.slice(0, limit).reverse();
    return recent;
}

// ============ POST-NARRATIVE HELPERS ============

/**
 * Parse discoveries from narrative text. Returns discovery entities + refreshed scene, or null.
 */
async function runDiscoveryParsing(plotId, fullResponse, input, featureTypes) {
    try {
        const discoveryService = require('./discoveryService');
        if (!discoveryService.likelyHasDiscoveries(fullResponse)) return null;
        const applied = await discoveryService.parseDiscoveries(plotId, fullResponse, input);
        if (!applied) return null;

        const discoveryEntities = [];
        if (applied.npcs) {
            for (const npc of applied.npcs) {
                discoveryEntities.push({ name: npc.name, type: 'npc', description: npc.description || '' });
            }
        }
        if (applied.objects) {
            for (const obj of applied.objects) {
                discoveryEntities.push({ name: obj.name, type: 'object', description: obj.description || '' });
            }
        }
        if (applied.locations) {
            for (const loc of applied.locations) {
                discoveryEntities.push({ name: loc.name, type: 'location', description: loc.description || '' });
            }
        }
        if (discoveryEntities.length === 0) return null;

        const freshScene = await executeTool(plotId, 'get_scene', {});
        const updatedEntities = { npcs: [], objects: [], features: [], locations: [], currentLocation: freshScene.location || '' };
        if (freshScene.npcsPresent) {
            updatedEntities.npcs.push(...freshScene.npcsPresent.filter(n => n.discovered).map(n => n.name));
        }
        if (freshScene.objects) {
            for (const o of freshScene.objects) {
                if (!o.discovered) continue;
                if (featureTypes.has(o.type)) {
                    updatedEntities.features.push(o.name);
                } else {
                    updatedEntities.objects.push(o.name);
                }
            }
        }
        if (freshScene.exits) {
            updatedEntities.locations.push(...freshScene.exits.map(e => e.name));
        }
        return { discoveryEntities, updatedSceneEntities: updatedEntities };
    } catch (e) {
        console.error('[Discovery] Parse error (non-critical):', e.message);
        return null;
    }
}

// ============ MAIN AGENT FLOW ============

/**
 * Process player input through the agent pipeline.
 * Yields events: { type: 'tool_call' | 'chunk' | 'done', ... }
 */
async function* processInput(input, plotId) {
    const startTime = Date.now();

    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.region')
        .populate('current_state.current_location.settlement');

    if (!plot) {
        yield { type: 'chunk', content: 'Error: Game not found.' };
        yield { type: 'done' };
        return;
    }

    // Ensure descriptions exist
    if (plot.current_state?.current_location?.region?._id) {
        const Region = require('../db/models/Region');
        const regionFactory = require('../agents/world/factories/regionsFactory');
        const settlementsFactory = require('../agents/world/factories/settlementsFactory');
        const region = await Region.findById(plot.current_state.current_location.region._id);
        const settlementId = plot.current_state.current_location.settlement?._id;

        if (!region.described) {
            yield { type: 'tool_call', tool: 'system', display: 'Discovering new lands...' };
            await regionFactory.describe(region._id);
        }
        if (settlementId) {
            const settlement = await Settlement.findById(settlementId);
            if (!settlement.described) {
                await regionFactory.describeSettlements(region._id);
            }
            if (settlement.described && !settlement.locationsGenerated) {
                await settlementsFactory.ensureLocations(settlementId);
            }
        }
    }

    // Get conversation history
    const recentMessages = await getRecentMessages(plotId, 10);
    const historyContext = recentMessages.length > 0
        ? recentMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n')
        : 'This is the start of the adventure.';

    const locationName = plot.current_state?.current_location?.settlement?.name || 'Unknown';
    const currentLocName = plot.current_state?.current_location?.locationName || '';
    const tone = plot.settings?.tone || 'classic';
    const difficulty = plot.settings?.difficulty || 'casual';
    const sc = plot.current_state?.sceneContext;

    console.log(`[GameAgent] Planning phase... (${Date.now() - startTime}ms)`);
    yield { type: 'debug', category: 'ai', message: `Planning call → ${GAME_MODEL}`, detail: `Player: "${input}" | Location: ${currentLocName || locationName}` };

    // ---- STEP 1: Planning call ----
    const planMessages = [
        {
            role: "system",
            content: `You are a game world AI deciding how to handle a player's action. Pick the tools you need.

RULES:
- Call get_scene to understand the player's surroundings (usually always useful)
- Call lookup_npc when the player talks to or asks about a NAMED character WHO IS PRESENT. If conversation history shows the player left an area, NPCs from that area are NOT available.
- Call move_player ONLY for explicit movement to a different named location
- Call update_npc_relationship ONLY after a significant attitude-changing interaction
- Call skill_check when the player attempts something with uncertain outcome: persuasion, physical feats, sneaking, picking locks, climbing, deception, intimidation, haggling, crafting. Do NOT call for trivial actions (looking around, basic conversation, simple movement, opening unlocked doors).
- Call update_quest when the player makes meaningful progress on a tracked quest (completing an objective, discovering critical info, or resolving the quest). Do NOT call for trivial interactions.
- You can call multiple tools
- For simple actions in the current location, get_scene alone is enough

CONTEXT: Player is at ${currentLocName || locationName}. Time: ${plot.current_state?.current_time || 'day'}.${sc && sc.summary ? ` SCENE: ${sc.summary} (tension: ${sc.tension || 'calm'})` : ''}

RECENT CONVERSATION:
${historyContext}`
        },
        { role: "user", content: input }
    ];

    let toolCalls = [];
    try {
        const msg = await toolPlanPrompt(GAME_MODEL, planMessages, TOOLS, 'auto');
        if (msg.tool_calls?.length > 0) {
            toolCalls = msg.tool_calls;
        }
    } catch (error) {
        console.error('[GameAgent] Planning failed:', error.message);
    }

    if (toolCalls.length === 0) {
        toolCalls = [{
            id: 'default_scene',
            type: 'function',
            function: { name: 'get_scene', arguments: '{}' }
        }];
    }

    const toolNames = toolCalls.map(t => t.function.name);
    console.log(`[GameAgent] Tools selected: ${toolNames.join(', ')} (${Date.now() - startTime}ms)`);
    yield { type: 'debug', category: 'tool', message: `AI selected ${toolNames.length} tool(s): ${toolNames.join(', ')}`, detail: `${Date.now() - startTime}ms elapsed` };

    // ---- STEP 2: Execute tools ----
    const toolResultTexts = [];
    const rawToolResults = [];
    let movementNarration = null;
    let skillCheckData = null;
    let questUpdateData = null;

    for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');

        yield { type: 'tool_call', tool: toolName, display: getToolDisplay(toolName, args) };

        const toolStart = Date.now();
        const result = await executeTool(plotId, toolName, args);
        const toolMs = Date.now() - toolStart;
        rawToolResults.push({ toolName, result });
        toolResultTexts.push(formatToolResult(toolName, result));

        // Debug events
        if (toolName === 'get_scene') {
            const npcs = (result.npcsPresent || []).map(n => n.name).join(', ') || 'none';
            const exits = (result.exits || []).map(e => `${e.direction}→${e.name}`).join(', ') || 'none';
            yield { type: 'debug', category: 'db', message: `get_scene → ${result.location || '?'}`, detail: `NPCs: ${npcs} | Exits: ${exits} | ${toolMs}ms` };
        } else if (toolName === 'lookup_npc') {
            yield { type: 'debug', category: 'db', message: `lookup_npc → ${result.name || args.name}`, detail: `Found: ${result.found} | Disposition: ${result.disposition || '?'} | ${toolMs}ms` };
        } else if (toolName === 'move_player') {
            yield { type: 'debug', category: 'db', message: `move_player → ${args.destination}`, detail: `Success: ${result.success}${result.reason ? ' | ' + result.reason : ''} | ${toolMs}ms` };
        } else if (toolName === 'skill_check') {
            yield { type: 'debug', category: 'roll', message: `d20=${result.roll} (${result.difficulty} ${result.type}) → ${result.result}`, detail: `"${result.action}" | need ${result.minPass} to pass, ${result.strongPass} for crit | ${toolMs}ms` };
        } else if (toolName === 'update_npc_relationship') {
            yield { type: 'debug', category: 'db', message: `update_npc → ${args.npc_name} = ${args.new_disposition}`, detail: `Reason: ${args.reason} | ${toolMs}ms` };
        } else if (toolName === 'update_quest') {
            yield { type: 'debug', category: 'db', message: `update_quest → "${args.quest_title}" (${args.update_type})`, detail: `${args.summary} | ${toolMs}ms` };
        }

        if (toolName === 'move_player' && result.success) {
            movementNarration = result.narration;
        }
        if (toolName === 'skill_check') {
            skillCheckData = result;
            yield { type: 'skill_check', data: result };
        }
        if (toolName === 'update_quest' && result.success) {
            questUpdateData = result.quest;
            yield { type: 'quest_update', data: result.quest };
        }
    }

    console.log(`[GameAgent] Tools executed (${Date.now() - startTime}ms)`);
    yield { type: 'debug', category: 'system', message: `All tools executed`, detail: `${Date.now() - startTime}ms total` };

    // If movement happened, re-run get_scene at the NEW location
    const didMove = rawToolResults.some(r => r.toolName === 'move_player' && r.result.success);
    if (didMove) {
        console.log('[GameAgent] Movement detected — resetting scene context, fetching new scene');
        const movePlot = await Plot.findById(plotId);
        movePlot.current_state.sceneContext = {
            summary: '', tension: 'calm', npcsPresent: [],
            activeEvents: [], playerGoal: '', recentOutcomes: [], turnCount: 0
        };
        await movePlot.save();
        const freshScene = await executeTool(plotId, 'get_scene', {});
        const oldIdx = rawToolResults.findIndex(r => r.toolName === 'get_scene');
        if (oldIdx !== -1) {
            rawToolResults[oldIdx] = { toolName: 'get_scene', result: freshScene };
            toolResultTexts[oldIdx] = formatToolResult('get_scene', freshScene);
        } else {
            rawToolResults.push({ toolName: 'get_scene', result: freshScene });
            toolResultTexts.push(formatToolResult('get_scene', freshScene));
        }
    }

    // ---- Extract scene entities from tool results ----
    const featureTypes = new Set(['entrance', 'landmark', 'shop', 'danger', 'quest', 'other']);
    let sceneEntities = { npcs: [], objects: [], features: [], locations: [], currentLocation: '' };
    for (const { toolName, result } of rawToolResults) {
        if (toolName === 'get_scene') {
            sceneEntities.currentLocation = result.location || '';
            if (result.npcsPresent) {
                sceneEntities.npcs.push(...result.npcsPresent.filter(n => n.discovered).map(n => n.name));
            }
            if (result.objects) {
                for (const o of result.objects) {
                    if (!o.discovered) continue;
                    if (featureTypes.has(o.type)) {
                        sceneEntities.features.push(o.name);
                    } else {
                        sceneEntities.objects.push(o.name);
                    }
                }
            }
            if (result.exits) {
                sceneEntities.locations.push(...result.exits.map(e => e.name));
            }
        }
        if (toolName === 'lookup_npc' && result.found) {
            if (!sceneEntities.npcs.includes(result.name)) {
                sceneEntities.npcs.push(result.name);
            }
        }
    }
    yield { type: 'scene_entities', entities: sceneEntities };

    // ---- STEP 3: Stream narrative ----
    const enrichedContext = toolResultTexts.join('\n\n');

    let sceneContextBlock = '';
    if (sc && (sc.summary || sc.tension !== 'calm' || (sc.npcsPresent && sc.npcsPresent.length > 0))) {
        const parts = [];
        if (sc.summary) parts.push(`Summary: ${sc.summary}`);
        parts.push(`Tension: ${sc.tension || 'calm'}`);
        if (sc.npcsPresent && sc.npcsPresent.length > 0) {
            const npcLines = sc.npcsPresent.map(n =>
                `  - ${n.name}: ${n.attitude} (${n.status})${n.intent ? ' — ' + n.intent : ''}`
            );
            parts.push(`NPCs in scene:\n${npcLines.join('\n')}`);
        }
        if (sc.activeEvents && sc.activeEvents.length > 0) {
            parts.push(`Active events: ${sc.activeEvents.join(', ')}`);
        }
        if (sc.recentOutcomes && sc.recentOutcomes.length > 0) {
            parts.push(`Recent outcomes: ${sc.recentOutcomes.join('; ')}`);
        }
        if (sc.playerGoal) parts.push(`Player goal: ${sc.playerGoal}`);
        sceneContextBlock = `\nSCENE CONTEXT (from previous turns):\n${parts.join('\n')}\n\nIMPORTANT: Respect NPC states and attitudes from scene context. A terrified NPC stays terrified. A fleeing NPC is gone. Tension level affects how NPCs react. If conversation history shows the player LEFT a location, NPCs from that area are gone even if scene data still lists them.\n`;
    }

    // Inject spatial context from scene grid
    let spatialContextBlock = '';
    try {
        const spatialPlot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');
        const spatialSettlement = spatialPlot?.current_state?.current_location?.settlement;
        const spatialLocId = spatialPlot?.current_state?.current_location?.locationId;
        const playerGridPos = spatialPlot?.current_state?.gridPosition;

        if (spatialSettlement && spatialLocId && playerGridPos?.x != null) {
            const spatialLoc = spatialSettlement.locations?.find(l => l._id.toString() === spatialLocId.toString());
            if (spatialLoc?.gridGenerated && spatialLoc.interiorGrid) {
                const spatialPois = await Poi.find({
                    settlement: spatialSettlement._id,
                    locationId: spatialLocId,
                    'gridPosition.x': { $ne: null }
                });
                if (spatialPois.length > 0) {
                    spatialContextBlock = '\n' + spatialService.generateSpatialContext(
                        playerGridPos,
                        spatialPois.map(p => ({ name: p.name, type: p.type, gridPosition: p.gridPosition })),
                        { width: spatialLoc.interiorGrid[0]?.length || 0, height: spatialLoc.interiorGrid.length }
                    ) + '\n';
                }
            }
        }
    } catch (spatialErr) {
        console.error('[Spatial] Context injection failed:', spatialErr.message);
    }

    // Inject quest context
    const questContext = await questService.getQuestContext(plotId);
    const fullContext = sceneContextBlock + enrichedContext + spatialContextBlock + questContext;

    const questHook = await questService.getHooksForNarrative(plotId);

    const narrativeSystemPrompt = `${buildSystemPrompt(tone, difficulty)}

RESPONSE RULES:
- Respond DIRECTLY to what the player just said or did. First sentence = immediate reaction to THIS action.
- Do NOT re-describe the scene. The player is already there.
- If the player is talking to someone, that person responds. Don't introduce unrelated characters.
- Keep conversation continuity — if a conversation is in progress, continue it naturally.
- If the player both acts AND speaks, handle both in one response.
- Respect the POPULATION level in the scene data. In isolated/sparse areas, do NOT invent NPCs. In populated/crowded areas, ambient NPCs fitting the location are natural.
- If the player has left an area (per conversation history), NPCs from that area are gone. Do not let the player interact with them.
- If quest context is provided, reference active quests naturally when relevant. Don't force quest references if the scene doesn't call for it.
- If you use the update_quest tool, the quest progress is tracked automatically. Only call it for meaningful progress, not every minor interaction.`;

    let userPromptContent = `GAME STATE:\n${fullContext}\n\nRECENT CONVERSATION:\n${historyContext}\n\nPLAYER: "${input}"\n\nRespond to the player's action/words. Be direct and concise.`;
    if (questHook) {
        userPromptContent += `\n\nBACKGROUND DETAIL (weave naturally IF it fits — skip if scene is tense/urgent): ${questHook}`;
    }

    const narrativeMessages = [
        { role: "system", content: narrativeSystemPrompt },
        { role: "user", content: userPromptContent }
    ];

    yield { type: 'debug', category: 'ai', message: `Narrative streaming → ${GAME_MODEL}`, detail: `Context: ${enrichedContext.length} chars from tool results` };

    try {
        const stream = await streamMessages(GAME_MODEL, narrativeMessages);

        let fullResponse = '';

        if (movementNarration) {
            yield { type: 'chunk', content: movementNarration + '\n\n' };
            fullResponse += movementNarration + '\n\n';
        }

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullResponse += content;
                yield { type: 'chunk', content };
            }
        }

        // Post-processing: use atomic $set to avoid overwriting gridPosition
        const lowerInput = input.toLowerCase();
        const activityUpdate = {};
        if (lowerInput.includes('rest') || lowerInput.includes('sleep')) {
            activityUpdate['current_state.current_activity'] = 'resting';
            if (lowerInput.includes('until morning')) activityUpdate['current_state.current_time'] = 'morning';
        } else if (lowerInput.includes('attack') || lowerInput.includes('fight')) {
            activityUpdate['current_state.current_activity'] = 'in combat';
        } else {
            const freshPlot = await Plot.findById(plotId);
            if (freshPlot?.current_state?.current_activity === 'resting') {
                activityUpdate['current_state.current_activity'] = 'exploring';
            }
        }
        if (Object.keys(activityUpdate).length > 0) {
            await Plot.findByIdAndUpdate(plotId, { $set: activityUpdate });
        }

        console.log(`[GameAgent] Narrative complete (${Date.now() - startTime}ms)`);
        yield { type: 'debug', category: 'ai', message: `Narrative complete (${fullResponse.length} chars)`, detail: `${Date.now() - startTime}ms total` };

        // ---- Detect untracked departure ----
        if (!didMove) {
            const departurePhrases = [
                'sail away', 'sailed away', 'set sail', 'leave the', 'left the',
                'depart from', 'departed', 'walk away', 'walked away', 'ride away',
                'rode away', 'heading away', 'fading behind', 'distance grows',
                'the docks diminish', 'disappear behind', 'growing distant'
            ];
            const combined = (input + ' ' + fullResponse).toLowerCase();
            if (departurePhrases.some(phrase => combined.includes(phrase))) {
                console.log('[GameAgent] Detected untracked departure — clearing stale scene entities');
                sceneEntities = { npcs: [], objects: [], features: [], locations: [], currentLocation: '' };
                yield { type: 'scene_entities', entities: sceneEntities };
            }
        }

        // ---- Fire-and-forget background tasks ----
        updateSceneContextBackground(plotId, plot.current_state?.sceneContext || {}, enrichedContext, input, fullResponse);

        questService.shouldGenerateSeeds(plotId).then(should => {
            if (should) questService.generateQuestSeeds(plotId).catch(err =>
                console.error('[Quest] Seed gen failed:', err.message));
        });

        if (didMove) {
            questService.expireStaleQuests(plotId).catch(err =>
                console.error('[Quest] Expiration failed:', err.message));
        }

        // ---- Discovery + suggestions + quest discovery in parallel ----
        yield { type: 'debug', category: 'ai', message: `Generating suggested actions → ${GAME_MODEL}` };

        const [discoveryResult, suggestionsResult, questDiscovery] = await Promise.all([
            runDiscoveryParsing(plotId, fullResponse, input, featureTypes),
            generateCategorizedSuggestions(enrichedContext, input, fullResponse),
            questService.detectQuestDiscovery(plotId, fullResponse)
        ]);

        if (discoveryResult) {
            yield { type: 'debug', category: 'db', message: `Discoveries: ${discoveryResult.discoveryEntities.length} new`, detail: discoveryResult.discoveryEntities.map(d => `${d.type}:${d.name}`).join(', ') };
            yield { type: 'discoveries', entities: discoveryResult.discoveryEntities };
            sceneEntities = discoveryResult.updatedSceneEntities;
            yield { type: 'scene_entities', entities: discoveryResult.updatedSceneEntities };
        }

        if (suggestionsResult) {
            const catSummary = Object.entries(suggestionsResult.categories).filter(([,v]) => v && v.length > 0).map(([k,v]) => `${k}(${v.length})`).join(', ');
            yield { type: 'debug', category: 'ai', message: `Suggestions generated: ${catSummary}`, detail: `${Date.now() - startTime}ms total` };
            yield { type: 'categorized_actions', categories: suggestionsResult.categories };

            if (suggestionsResult.flatActions.length > 0) {
                yield { type: 'suggested_actions', actions: suggestionsResult.flatActions };
            }
            console.log(`[GameAgent] Suggestions yielded (${Date.now() - startTime}ms)`);
        }

        if (questDiscovery && questDiscovery.length > 0) {
            yield { type: 'debug', category: 'db', message: `Quest discoveries: ${questDiscovery.length}`, detail: questDiscovery.map(q => q.title).join(', ') };
            yield { type: 'quest_discovered', quests: questDiscovery };
        }

        if (questUpdateData) {
            yield { type: 'quest_update', data: questUpdateData };
        }

        // ---- Update grid positions ----
        const lookedUpNpcNames = rawToolResults
            .filter(r => r.toolName === 'lookup_npc' && r.result.found)
            .map(r => r.result.name);
        await updateGridPositions(plotId, input, didMove, lookedUpNpcNames);

    } catch (error) {
        console.error('[GameAgent] Narrative streaming failed:', error.message);
        yield { type: 'chunk', content: 'The world falls silent for a moment...' };
    }

    yield { type: 'done' };
}

module.exports = { processInput, TOOLS };
