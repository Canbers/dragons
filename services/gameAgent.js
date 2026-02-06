/**
 * Game Agent - AI with tool-calling for grounded game responses
 *
 * Flow:
 * 1. Player sends input
 * 2. AI decides which tools to call (fast, non-streaming)
 * 3. Tools execute against the database
 * 4. AI generates narrative with tool results as context (streaming)
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');
const GameLog = require('../db/models/GameLog');
const { openai, buildSystemPrompt, GAME_MODEL } = require('./gptService');

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
    }
];

// ============ TOOL EXECUTION ============

async function executeGetScene(plotId) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.region')
        .populate('current_state.current_location.settlement');

    const settlement = plot.current_state?.current_location?.settlement;
    const region = plot.current_state?.current_location?.region;

    if (!settlement?.locations?.length) {
        return {
            location: 'Wilderness',
            region: region?.name || 'Unknown',
            description: region?.description || 'Open terrain.',
            exits: [],
            npcsPresent: [],
            objects: []
        };
    }

    // Find current location
    const locationId = plot.current_state.current_location.locationId;
    const locationName = plot.current_state.current_location.locationName;

    let currentLoc = null;
    if (locationId) {
        currentLoc = settlement.locations.find(l => l._id.toString() === locationId.toString());
    }
    if (!currentLoc && locationName) {
        currentLoc = settlement.locations.find(l => l.name.toLowerCase() === locationName.toLowerCase());
    }
    if (!currentLoc) {
        currentLoc = settlement.locations.find(l => l.isStartingLocation) || settlement.locations[0];
    }

    if (!currentLoc) {
        return { location: settlement.name, description: settlement.description || '', exits: [], npcsPresent: [], objects: [] };
    }

    const exits = (currentLoc.connections || []).map(conn => ({
        direction: conn.direction,
        name: conn.locationName,
        via: conn.description || ''
    }));

    const npcsPresent = (currentLoc.pois || [])
        .filter(p => p.discovered && p.type === 'npc')
        .map(p => ({ name: p.name, description: p.description || '' }));

    const objects = (currentLoc.pois || [])
        .filter(p => p.discovered && p.type !== 'npc')
        .map(p => ({ name: p.name, type: p.type, description: p.description || '' }));

    return {
        location: currentLoc.name,
        locationType: currentLoc.type,
        description: currentLoc.description || '',
        settlement: settlement.name,
        timeOfDay: plot.current_state.current_time || 'day',
        activity: plot.current_state.current_activity || 'exploring',
        exits,
        npcsPresent,
        objects
    };
}

async function executeLookupNpc(plotId, npcName) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');

    // Check reputation records
    const repNpc = (plot.reputation?.npcs || []).find(n =>
        n.name.toLowerCase().includes(npcName.toLowerCase())
    );

    // Check POIs across settlement locations
    const settlement = plot.current_state?.current_location?.settlement;
    let poiNpc = null;
    if (settlement?.locations) {
        for (const loc of settlement.locations) {
            const found = (loc.pois || []).find(p =>
                p.type === 'npc' && p.name.toLowerCase().includes(npcName.toLowerCase())
            );
            if (found) {
                poiNpc = { name: found.name, description: found.description, foundAt: loc.name, interactionCount: found.interactionCount };
                break;
            }
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

async function executeTool(plotId, toolName, args) {
    switch (toolName) {
        case 'get_scene': return await executeGetScene(plotId);
        case 'lookup_npc': return await executeLookupNpc(plotId, args.name);
        case 'move_player': return await executeMovePlayer(plotId, args.destination);
        case 'update_npc_relationship': return await executeUpdateRelationship(plotId, args.npc_name, args.new_disposition, args.reason);
        default: return { error: `Unknown tool: ${toolName}` };
    }
}

// ============ DISPLAY HELPERS ============

function getToolDisplay(toolName, args) {
    switch (toolName) {
        case 'get_scene': return 'Observing the scene...';
        case 'lookup_npc': return `Recalling ${args.name || 'character'}...`;
        case 'move_player': return `Moving to ${args.destination || 'location'}...`;
        case 'update_npc_relationship': return `Noting reaction from ${args.npc_name || 'NPC'}...`;
        default: return 'Thinking...';
    }
}

function formatToolResult(toolName, result) {
    switch (toolName) {
        case 'get_scene':
            let scene = `CURRENT SCENE: ${result.location}${result.locationType ? ' (' + result.locationType + ')' : ''} in ${result.settlement || 'the wilds'}`;
            scene += `\n${result.description}`;
            scene += `\nTime: ${result.timeOfDay}`;
            if (result.exits?.length > 0) {
                scene += `\nEXITS: ${result.exits.map(e => `${e.direction}: ${e.name}${e.via ? ' — ' + e.via : ''}`).join('; ')}`;
            }
            if (result.npcsPresent?.length > 0) {
                scene += `\nPEOPLE HERE: ${result.npcsPresent.map(n => `${n.name}${n.description ? ' — ' + n.description : ''}`).join('; ')}`;
            }
            if (result.objects?.length > 0) {
                scene += `\nNOTABLE OBJECTS: ${result.objects.map(o => `${o.name} (${o.type})`).join('; ')}`;
            }
            return scene;

        case 'lookup_npc':
            if (!result.found) return `NPC "${result.name}": Not previously encountered. This is a new character.`;
            let npc = `NPC: ${result.name}`;
            npc += `\nAttitude toward player: ${result.disposition}`;
            npc += `\nLast interaction: ${result.lastInteraction}`;
            if (result.description) npc += `\nDescription: ${result.description}`;
            if (result.interactionCount > 0) npc += `\nTimes spoken to: ${result.interactionCount}`;
            return npc;

        case 'move_player':
            if (!result.success) return `MOVEMENT BLOCKED: ${result.reason}`;
            return `MOVED TO: ${result.newLocation}\n${result.narration}`;

        case 'update_npc_relationship':
            return `RELATIONSHIP UPDATED: ${result.npc} is now ${result.disposition}`;

        default:
            return JSON.stringify(result);
    }
}

// ============ GET RECENT MESSAGES (direct DB query) ============

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

    // Sort by timestamp descending, take the most recent
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = allMessages.slice(0, limit).reverse();
    return recent;
}

// ============ MAIN AGENT FLOW ============

/**
 * Process player input through the agent pipeline.
 * Yields events: { type: 'tool_call' | 'chunk' | 'done', ... }
 */
async function* processInput(input, plotId) {
    const startTime = Date.now();

    // Load plot
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

    console.log(`[GameAgent] Planning phase... (${Date.now() - startTime}ms)`);

    // ---- STEP 1: Planning call ----
    const planMessages = [
        {
            role: "system",
            content: `You are a game world AI deciding how to handle a player's action. Pick the tools you need.

RULES:
- Call get_scene to understand the player's surroundings (usually always useful)
- Call lookup_npc when the player talks to or asks about a NAMED character
- Call move_player ONLY for explicit movement to a different named location
- Call update_npc_relationship ONLY after a significant attitude-changing interaction
- You can call multiple tools
- For simple actions in the current location, get_scene alone is enough

CONTEXT: Player is at ${currentLocName || locationName}. Time: ${plot.current_state?.current_time || 'day'}.

RECENT CONVERSATION:
${historyContext}`
        },
        { role: "user", content: input }
    ];

    let toolCalls = [];
    try {
        const planResponse = await openai.chat.completions.create({
            model: GAME_MODEL,
            messages: planMessages,
            tools: TOOLS,
            tool_choice: "auto"
        });

        const msg = planResponse.choices[0].message;
        if (msg.tool_calls?.length > 0) {
            toolCalls = msg.tool_calls;
        }
    } catch (error) {
        console.error('[GameAgent] Planning failed:', error.message);
    }

    // Default: always get scene if no tools selected
    if (toolCalls.length === 0) {
        toolCalls = [{
            id: 'default_scene',
            type: 'function',
            function: { name: 'get_scene', arguments: '{}' }
        }];
    }

    console.log(`[GameAgent] Tools selected: ${toolCalls.map(t => t.function.name).join(', ')} (${Date.now() - startTime}ms)`);

    // ---- STEP 2: Execute tools ----
    const toolResultTexts = [];
    let movementNarration = null;

    for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');

        // Emit tool call event for frontend
        yield { type: 'tool_call', tool: toolName, display: getToolDisplay(toolName, args) };

        const result = await executeTool(plotId, toolName, args);
        toolResultTexts.push(formatToolResult(toolName, result));

        // If movement happened, capture the narration
        if (toolName === 'move_player' && result.success) {
            movementNarration = result.narration;
        }
    }

    console.log(`[GameAgent] Tools executed (${Date.now() - startTime}ms)`);

    // ---- STEP 3: Stream narrative ----
    const enrichedContext = toolResultTexts.join('\n\n');

    const narrativeSystemPrompt = `${buildSystemPrompt(tone, difficulty)}

RESPONSE RULES (CRITICAL):
- Respond DIRECTLY to what the player just said or did. First sentence = immediate reaction.
- Do NOT re-describe the scene or location. The player is already there.
- If the player is talking to someone, that person responds. Do NOT introduce random other characters.
- Keep conversation continuity — if a conversation is in progress, continue it naturally.
- Be CONCISE. 2-3 sentences for most responses.
- Focus ONLY on what is NEW — the direct result of this specific input.
- Never narrate the player's thoughts or feelings.
- If the player both acts AND speaks (e.g. "I sit down and say hello"), handle both naturally in one response.`;

    const narrativeMessages = [
        { role: "system", content: narrativeSystemPrompt },
        {
            role: "user",
            content: `GAME STATE:\n${enrichedContext}\n\nRECENT CONVERSATION:\n${historyContext}\n\nPLAYER: "${input}"\n\nRespond to the player's action/words. Be direct and concise.`
        }
    ];

    try {
        const stream = await openai.chat.completions.create({
            model: GAME_MODEL,
            messages: narrativeMessages,
            stream: true
        });

        let fullResponse = '';

        // If movement happened, yield that narration first
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

        // Post-processing: state updates
        const lowerInput = input.toLowerCase();
        if (lowerInput.includes('rest') || lowerInput.includes('sleep')) {
            plot.current_state.current_activity = 'resting';
            if (lowerInput.includes('until morning')) plot.current_state.current_time = 'morning';
        } else if (lowerInput.includes('attack') || lowerInput.includes('fight')) {
            plot.current_state.current_activity = 'in combat';
        } else if (plot.current_state.current_activity === 'resting') {
            plot.current_state.current_activity = 'exploring';
        }
        await plot.save();

        // Async discovery parsing
        try {
            const discoveryService = require('./discoveryService');
            if (discoveryService.likelyHasDiscoveries(fullResponse)) {
                discoveryService.parseDiscoveries(plotId, fullResponse, input)
                    .catch(err => console.error('[Discovery] Background parse failed:', err));
            }
        } catch (e) { /* non-critical */ }

        console.log(`[GameAgent] Narrative complete (${Date.now() - startTime}ms)`);

        // Generate suggested next actions (non-blocking)
        try {
            console.log(`[GameAgent] Generating suggestions...`);
            const suggestionResponse = await openai.chat.completions.create({
                model: GAME_MODEL,
                messages: [
                    {
                        role: "system",
                        content: `You suggest player actions for an RPG. Return ONLY valid JSON, no other text.
Format: {"actions": [{"label": "Short Label", "action": "I do something specific"}, ...]}
Rules:
- Exactly 3 actions
- Labels: 2-4 words (button text)
- Actions: first-person "I ..." sentences
- Contextually relevant and varied
- Never suggest looking around or resting`
                    },
                    {
                        role: "user",
                        content: `SCENE:\n${enrichedContext}\n\nPLAYER DID: "${input}"\n\nAI RESPONDED: "${fullResponse}"\n\nSuggest 3 actions. Return ONLY JSON.`
                    }
                ]
            });

            const suggestionsText = suggestionResponse.choices[0]?.message?.content;
            console.log(`[GameAgent] Suggestion raw response:`, suggestionsText);
            if (suggestionsText) {
                // Extract JSON from response (handle markdown code blocks)
                let jsonStr = suggestionsText.trim();
                const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) jsonStr = jsonMatch[1].trim();

                const parsed = JSON.parse(jsonStr);
                if (parsed.actions && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
                    const actions = parsed.actions.slice(0, 3);
                    console.log(`[GameAgent] Suggestions generated:`, actions);
                    yield { type: 'suggested_actions', actions };
                    console.log(`[GameAgent] Suggestions yielded (${Date.now() - startTime}ms)`);
                }
            }
        } catch (suggestError) {
            console.error('[GameAgent] Suggestion generation failed (non-critical):', suggestError.message);
        }

    } catch (error) {
        console.error('[GameAgent] Narrative streaming failed:', error.message);
        yield { type: 'chunk', content: 'The world falls silent for a moment...' };
    }

    yield { type: 'done' };
}

module.exports = { processInput, TOOLS };
