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
const Poi = require('../db/models/Poi');
const GameLog = require('../db/models/GameLog');
const { openai, buildSystemPrompt, GAME_MODEL, UTILITY_MODEL, simplePrompt } = require('./gptService');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const questService = require('./questService');
const sceneGridService = require('./sceneGridService');
const spatialService = require('./spatialService');

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
            populationLevel: 'isolated',
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

    // First impression: auto-populate POIs for fresh locations
    const poiCount = await Poi.countDocuments({ settlement: settlement._id, locationId: currentLoc._id });
    let firstImpressionResult = null;
    if (poiCount === 0) {
        firstImpressionResult = await generateFirstImpression(settlement, currentLoc);
    }

    // Query ALL POIs at this location (AI needs full context; frontend filters by discovered)
    const pois = await Poi.find({ settlement: settlement._id, locationId: currentLoc._id });

    // Generate scene grid if not already generated
    if (!currentLoc.gridGenerated) {
        try {
            const gridParams = firstImpressionResult?.gridParams || null;
            const { grid, width, height, doors } = sceneGridService.generateSceneGrid(settlement, currentLoc, gridParams);
            const { poiPositions, playerStart } = sceneGridService.placeEntitiesOnGrid(grid, pois, doors, currentLoc.type);

            // Build occupied set for ambient NPC placement
            const occupied = new Set();
            for (const [, pos] of poiPositions) occupied.add(`${pos.x},${pos.y}`);
            occupied.add(`${playerStart.x},${playerStart.y}`);

            // Generate ambient (background) NPCs based on population level
            const popLevel = currentLoc.populationLevel || 'populated';
            const ambientNpcs = sceneGridService.generateAmbientNpcs(grid, popLevel, occupied);

            // Save grid + ambient NPCs to location
            currentLoc.interiorGrid = grid;
            currentLoc.gridParams = gridParams;
            currentLoc.gridGenerated = true;
            currentLoc.ambientNpcs = ambientNpcs;
            await settlement.save();

            // Save POI grid positions
            for (const [poiId, pos] of poiPositions) {
                await Poi.findByIdAndUpdate(poiId, { gridPosition: pos });
            }

            // Save player grid position
            plot.current_state.gridPosition = playerStart;
            plot.markModified('current_state.gridPosition');
            await plot.save();

            console.log(`[SceneGrid] Generated ${width}x${height} grid for ${currentLoc.name}, placed ${poiPositions.size} entities + ${ambientNpcs.length} ambient NPCs, player at (${playerStart.x},${playerStart.y})`);
        } catch (gridError) {
            console.error(`[SceneGrid] Generation failed for ${currentLoc.name}:`, gridError.message);
        }
    }

    const exits = (currentLoc.connections || []).map(conn => ({
        direction: conn.direction,
        name: conn.locationName,
        via: conn.description || ''
    }));

    const npcsPresent = pois
        .filter(p => p.type === 'npc')
        .map(p => ({ name: p.name, description: p.description || '', disposition: p.disposition || '', discovered: p.discovered }));

    const objects = pois
        .filter(p => p.type !== 'npc')
        .map(p => ({ name: p.name, type: p.type, description: p.description || '', discovered: p.discovered }));

    return {
        location: currentLoc.name,
        locationType: currentLoc.type,
        populationLevel: currentLoc.populationLevel || 'populated',
        description: currentLoc.description || '',
        settlement: settlement.name,
        timeOfDay: plot.current_state.current_time || 'day',
        activity: plot.current_state.current_activity || 'exploring',
        exits,
        npcsPresent,
        objects
    };
}

/**
 * Helper: prompt additions for type-specific gridParams
 */
function getTypeSpecificParamsPrompt(locationType) {
    const base = `gridParams fields: "condition" (pristine|well-kept|worn|dilapidated|ruined), "wealth" (poor|modest|comfortable|wealthy|opulent), "clutter" (minimal|moderate|cluttered|packed), "lighting" (bright|well-lit|dim|dark)`;
    return base;
}

/**
 * Generate first-impression POIs for a location that has none.
 * Creates 2-4 obvious things you'd see when entering (barkeep in tavern, guard at gate, etc.)
 */
async function generateFirstImpression(settlement, location) {
    console.log(`[FirstImpression] Generating POIs for ${location.name} (${location.type}) in ${settlement.name}`);

    const prompt = `You are populating a ${location.type} location in an RPG settlement.

Settlement: ${settlement.name} — ${settlement.short || settlement.description?.substring(0, 150) || 'a settlement'}
Location: ${location.name}
Location type: ${location.type}
Description: ${location.description || 'No description yet.'}

Generate 2-4 immediately obvious things a player would notice when entering this place. These are the FIRST THINGS you'd see — not hidden secrets.

Rules:
- NPCs must have PROPER NAMES — unique, creative names (NOT generic titles like "the barkeep")
- Objects should be specific and notable (NOT generic like "some furniture")
- Match the location type (tavern → barkeep, patron; gate → guard; market → merchant)
- type MUST be one of: npc, object, entrance, landmark, danger, quest, shop, other
- Include a brief description for each (one sentence)
- Include an appropriate emoji icon for each
- For NPCs, include a "disposition" — a short phrase describing their personality and current mood. Make these VARIED: friendly, nervous, bored, eager, grumpy, flirtatious, distracted, desperate, cheerful, secretive, etc. NOT everyone is suspicious or guarded.

Also pick the POPULATION LEVEL for this location — how busy it feels:
- "crowded": many people (busy markets, festivals, packed taverns)
- "populated": staff and regulars (normal taverns, shops, temples)
- "sparse": few people (alleys, warehouses, run-down places)
- "isolated": empty (ruins, caves, abandoned buildings)

Also output a "gridParams" object to control interior layout generation. Choose values that match this location's narrative feel:
${getTypeSpecificParamsPrompt(location.type)}

Return ONLY valid JSON matching this structure (do NOT copy these example names — generate unique ones for this specific location):
{
    "populationLevel": "populated",
    "gridParams": {
        "condition": "well-kept",
        "wealth": "modest",
        "clutter": "moderate",
        "lighting": "well-lit"
    },
    "pois": [
        { "name": "<UNIQUE_NPC_NAME>", "type": "npc", "description": "<what they look like and are doing>", "disposition": "<personality and mood>", "icon": "👤" },
        { "name": "<NOTABLE_OBJECT>", "type": "object", "description": "<brief description>", "icon": "📋" }
    ]
}`;

    try {
        const result = await simplePrompt(UTILITY_MODEL,
            'You generate RPG location details as JSON. Return valid JSON only.',
            prompt
        );

        let jsonContent = result.content;
        const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonContent = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonContent);
        const pois = parsed.pois || parsed;

        if (!Array.isArray(pois) || pois.length === 0) {
            console.log('[FirstImpression] No POIs generated');
            return;
        }

        // Save population level if AI provided one and location doesn't have one
        const validPopLevels = ['crowded', 'populated', 'sparse', 'isolated'];
        if (parsed.populationLevel && validPopLevels.includes(parsed.populationLevel) && !location.populationLevel) {
            location.populationLevel = parsed.populationLevel;
            await settlement.save();
            console.log(`[FirstImpression] Set populationLevel=${parsed.populationLevel} for ${location.name}`);
        }

        // Validate type enum
        const validTypes = ['npc', 'object', 'entrance', 'landmark', 'danger', 'quest', 'shop', 'other'];

        const created = [];
        for (const p of pois.slice(0, 4)) {
            const poiData = {
                name: p.name,
                type: validTypes.includes(p.type) ? p.type : 'other',
                description: p.description || '',
                disposition: p.disposition || '',
                icon: p.icon || '',
                persistent: true,
                autoGenerated: true
            };
            const poi = await settlementsFactory.addPoi(settlement._id, location.name, poiData);
            if (poi) created.push(poi.name);
        }
        if (created.length > 0) {
            console.log(`[FirstImpression] Created ${created.length} POIs at ${location.name}: ${created.join(', ')}`);
        }

        // Return gridParams if AI provided them
        return { gridParams: parsed.gridParams || null };

    } catch (e) {
        console.error(`[FirstImpression] Failed for ${location.name}:`, e.message);
        return { gridParams: null };
    }
}

async function executeLookupNpc(plotId, npcName) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');

    // Check reputation records
    const repNpc = (plot.reputation?.npcs || []).find(n =>
        n.name.toLowerCase().includes(npcName.toLowerCase())
    );

    // Check POIs across the settlement via Poi collection
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

// ============ DISPLAY HELPERS ============

function getToolDisplay(toolName, args) {
    switch (toolName) {
        case 'get_scene': return 'Observing the scene...';
        case 'lookup_npc': return `Recalling ${args.name || 'character'}...`;
        case 'move_player': return `Moving to ${args.destination || 'location'}...`;
        case 'update_npc_relationship': return `Noting reaction from ${args.npc_name || 'NPC'}...`;
        case 'skill_check': return `Rolling for ${args.type || 'skill'} check...`;
        case 'update_quest': return `Updating quest progress...`;
        default: return 'Thinking...';
    }
}

function formatToolResult(toolName, result) {
    switch (toolName) {
        case 'get_scene':
            const popHints = {
                crowded: 'crowded — many ambient people naturally present, new NPCs appropriate',
                populated: 'populated — staff and regulars expected, new NPCs appropriate to location OK',
                sparse: 'sparse — few people around, only introduce NPCs with a clear world-logic reason',
                isolated: 'isolated — no one here unless listed below, do NOT create or invent NPCs'
            };
            let scene = `CURRENT SCENE: ${result.location}${result.locationType ? ' (' + result.locationType + ')' : ''} in ${result.settlement || 'the wilds'}`;
            scene += `\nPOPULATION: ${popHints[result.populationLevel] || popHints.populated}`;
            scene += `\n${result.description}`;
            scene += `\nTime: ${result.timeOfDay}`;
            if (result.exits?.length > 0) {
                scene += `\nEXITS: ${result.exits.map(e => `${e.direction}: ${e.name}${e.via ? ' — ' + e.via : ''}`).join('; ')}`;
            }
            if (result.npcsPresent?.length > 0) {
                scene += `\nPEOPLE HERE: ${result.npcsPresent.map(n => {
                    let entry = n.name;
                    if (n.description) entry += ` — ${n.description}`;
                    if (n.disposition) entry += ` [disposition: ${n.disposition}]`;
                    return entry;
                }).join('; ')}`;
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

        case 'skill_check':
            if (result.result === 'fail') {
                return `SKILL CHECK FAILED (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.minPass}). The action "${result.action}" FAILS. Describe a proportionate consequence — not catastrophic, but clearly unsuccessful.`;
            } else if (result.result === 'strong_success') {
                return `STRONG SUCCESS (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.strongPass}+). The action "${result.action}" succeeds impressively. Describe a bonus outcome or extra benefit.`;
            } else {
                return `SKILL CHECK PASSED (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.minPass}). The action "${result.action}" succeeds adequately. Nothing remarkable, just competent execution.`;
            }

        case 'update_quest':
            if (!result.success) return `QUEST UPDATE FAILED: ${result.error}`;
            return `QUEST UPDATED: "${result.quest.title}" — ${result.quest.updateType}. Status: ${result.quest.status}`;

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

// ============ POST-NARRATIVE HELPERS (parallel / background) ============

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

        // Refresh scene entities after marking discoveries
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

/**
 * Generate categorized action suggestions. Returns { categories, flatActions } or null.
 */
async function generateCategorizedSuggestions(enrichedContext, input, fullResponse) {
    try {
        const suggestionResponse = await openai.chat.completions.create({
            model: GAME_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You suggest player actions for an RPG, categorized by type. Return ONLY valid JSON, no other text.
Format: {"categories": {"movement": [{"label": "Short Label", "action": "I do something"}], "social": [...], "explore": [...], "combat": [...]}}
Rules:
- 2 actions per RELEVANT category only
- Omit categories with no relevant actions (empty array or omit key)
- Labels: 2-4 words (button text)
- Actions: first-person "I ..." sentences
- movement: going to places, traveling
- social: talking, asking, interacting with people
- explore: examining, investigating, searching
- combat: fighting, attacking, defending
- Be contextually relevant`
                },
                {
                    role: "user",
                    content: `SCENE:\n${enrichedContext}\n\nPLAYER DID: "${input}"\n\nAI RESPONDED: "${fullResponse}"\n\nSuggest categorized actions. Return ONLY JSON.`
                }
            ]
        });

        const suggestionsText = suggestionResponse.choices[0]?.message?.content;
        if (!suggestionsText) return null;

        let jsonStr = suggestionsText.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonStr);
        if (!parsed.categories) return null;

        const categories = parsed.categories;
        const flatActions = [];
        for (const cat of ['social', 'explore', 'movement', 'combat']) {
            if (categories[cat]) {
                flatActions.push(...categories[cat]);
            }
        }
        return { categories, flatActions: flatActions.slice(0, 3) };
    } catch (e) {
        console.error('[GameAgent] Suggestion generation failed (non-critical):', e.message);
        return null;
    }
}

/**
 * Update scene context in the background. Fire-and-forget — does not block the player response.
 */
async function updateSceneContextBackground(plotId, prevContext, enrichedContext, input, fullResponse) {
    try {
        const sceneUpdatePrompt = `You are tracking scene state for an RPG. Analyze what just happened and return updated scene context as JSON.

PREVIOUS SCENE CONTEXT:
${JSON.stringify(prevContext)}

TOOL RESULTS (what the game world knows):
${enrichedContext}

PLAYER INPUT: "${input}"

AI NARRATIVE RESPONSE:
${fullResponse}

Return a JSON object with these fields:
{
  "summary": "1-2 sentence factual summary of the current scene situation",
  "tension": one of "calm", "cautious", "tense", "hostile", "critical",
  "npcsPresent": [{"name": "string", "status": one of "engaged"/"observing"/"leaving"/"hostile"/"unconscious"/"fled"/"dead", "attitude": one of "friendly"/"neutral"/"wary"/"hostile"/"terrified", "intent": "brief description of what they want to do next"}],
  "activeEvents": ["ongoing situations like 'bar fight' or 'guard patrol'"],
  "playerGoal": "what the player seems to be trying to do",
  "recentOutcomes": ["last 1-3 notable outcomes, include skill check results"]
}

Rules:
- Only include NPCs actually present in the scene (not fled/dead ones)
- recentOutcomes max 3 entries, newest first. Include skill check results verbatim (e.g. "Intimidation check: rolled 19, strong success")
- Be factual, not dramatic. "Player succeeded intimidation, guard is terrified" not "a bone-chilling display of power"
- Tension should reflect the actual mood: successful intimidation of a hostile NPC = tension might DROP (threat neutralized), failed attack = tension RISES
- playerGoal: infer from context, keep brief`;

        const sceneResult = await simplePrompt(UTILITY_MODEL,
            'You track RPG scene state. Return valid JSON only.',
            sceneUpdatePrompt
        );

        let sceneJson = sceneResult.content;
        const jsonMatch = sceneJson.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) sceneJson = jsonMatch[1].trim();

        const parsed = JSON.parse(sceneJson);

        const validTensions = ['calm', 'cautious', 'tense', 'hostile', 'critical'];
        const validStatuses = ['engaged', 'observing', 'leaving', 'hostile', 'unconscious', 'fled', 'dead'];
        const validAttitudes = ['friendly', 'neutral', 'wary', 'hostile', 'terrified'];

        const sanitized = {
            summary: (parsed.summary || '').substring(0, 500),
            tension: validTensions.includes(parsed.tension) ? parsed.tension : 'calm',
            npcsPresent: (parsed.npcsPresent || [])
                .filter(n => n.name && !['fled', 'dead'].includes(n.status))
                .slice(0, 10)
                .map(n => ({
                    name: (n.name || '').substring(0, 100),
                    status: validStatuses.includes(n.status) ? n.status : 'observing',
                    attitude: validAttitudes.includes(n.attitude) ? n.attitude : 'neutral',
                    intent: (n.intent || '').substring(0, 200)
                })),
            activeEvents: (parsed.activeEvents || []).slice(0, 5).map(e => (e || '').substring(0, 200)),
            playerGoal: (parsed.playerGoal || '').substring(0, 300),
            recentOutcomes: (parsed.recentOutcomes || []).slice(0, 3).map(o => (o || '').substring(0, 300)),
            turnCount: (prevContext.turnCount || 0) + 1
        };

        // Use atomic $set to avoid overwriting gridPosition (this runs fire-and-forget,
        // concurrent with updateGridPositions which also saves to the same Plot)
        await Plot.findByIdAndUpdate(plotId, {
            $set: { 'current_state.sceneContext': sanitized }
        });
        const scPlot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');

        console.log(`[GameAgent] Scene context updated: tension=${sanitized.tension}, ${sanitized.npcsPresent.length} NPCs, turn ${sanitized.turnCount}`);

        // ---- NPC reactive grid movement based on scene context changes ----
        try {
            const scSettlement = scPlot.current_state?.current_location?.settlement;
            const scLocId = scPlot.current_state?.current_location?.locationId;
            if (!scSettlement || !scLocId) return;

            const scLoc = scSettlement.locations?.find(l => l._id.toString() === scLocId.toString());
            if (!scLoc?.gridGenerated || !scLoc.interiorGrid) return;

            const prevNames = new Set((prevContext.npcsPresent || []).map(n => n.name.toLowerCase()));
            const currNames = new Set(sanitized.npcsPresent.map(n => n.name.toLowerCase()));

            // NPCs that left: clear their grid position
            const departed = [...prevNames].filter(n => !currNames.has(n));
            if (departed.length > 0) {
                for (const name of departed) {
                    await Poi.updateMany(
                        { settlement: scSettlement._id, locationId: scLoc._id, type: 'npc',
                          name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                        { $unset: { 'gridPosition.x': '', 'gridPosition.y': '' } }
                    );
                }
                console.log(`[GridMovement] NPCs departed: ${departed.join(', ')}`);
            }

            // NPCs that arrived: ensure they have a grid position (from ambient or door)
            const arrived = [...currNames].filter(n => !prevNames.has(n));
            if (arrived.length > 0) {
                for (const name of arrived) {
                    const poi = await Poi.findOne({
                        settlement: scSettlement._id, locationId: scLoc._id,
                        name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                    });
                    if (poi && poi.gridPosition?.x == null) {
                        // Try to use an ambient NPC position
                        if (scLoc.ambientNpcs?.length > 0) {
                            const amb = scLoc.ambientNpcs[0];
                            poi.gridPosition = { x: amb.x, y: amb.y };
                            await poi.save();
                            scLoc.ambientNpcs.pull(amb._id);
                            await scSettlement.save();
                            console.log(`[GridMovement] NPC arrived (from ambient): ${poi.name} at (${amb.x},${amb.y})`);
                        } else {
                            // Place at a door
                            const doors = sceneGridService.findDoors(scLoc.interiorGrid);
                            if (doors.length > 0) {
                                poi.gridPosition = { x: doors[0].x, y: doors[0].y };
                                await poi.save();
                                console.log(`[GridMovement] NPC arrived (at door): ${poi.name} at (${doors[0].x},${doors[0].y})`);
                            }
                        }
                    }
                }
            }

            // NPCs with "leaving" status: move them toward nearest door
            for (const npc of sanitized.npcsPresent) {
                if (npc.status !== 'leaving') continue;
                const poi = await Poi.findOne({
                    settlement: scSettlement._id, locationId: scLoc._id, type: 'npc',
                    name: { $regex: new RegExp(`^${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                    'gridPosition.x': { $ne: null }
                });
                if (!poi) continue;

                const doors = sceneGridService.findDoors(scLoc.interiorGrid);
                if (doors.length === 0) continue;

                // Find nearest door
                doors.sort((a, b) => {
                    const da = spatialService.manhattanDistance(poi.gridPosition.x, poi.gridPosition.y, a.x, a.y);
                    const db = spatialService.manhattanDistance(poi.gridPosition.x, poi.gridPosition.y, b.x, b.y);
                    return da - db;
                });

                const occupied = new Set();
                const allPois = await Poi.find({ settlement: scSettlement._id, locationId: scLoc._id, 'gridPosition.x': { $ne: null } });
                for (const p of allPois) occupied.add(`${p.gridPosition.x},${p.gridPosition.y}`);

                occupied.delete(`${poi.gridPosition.x},${poi.gridPosition.y}`);
                let pos = { ...poi.gridPosition };
                for (let i = 0; i < 3; i++) {
                    const step = sceneGridService.stepToward(scLoc.interiorGrid, pos, doors[0], occupied);
                    if (!step) break;
                    occupied.delete(`${pos.x},${pos.y}`);
                    pos = step;
                    occupied.add(`${pos.x},${pos.y}`);
                }
                if (pos.x !== poi.gridPosition.x || pos.y !== poi.gridPosition.y) {
                    poi.gridPosition = { x: pos.x, y: pos.y };
                    await poi.save();
                    console.log(`[GridMovement] NPC leaving: ${poi.name} moved toward door → (${pos.x},${pos.y})`);
                }
            }
        } catch (gridErr) {
            console.error('[GridMovement] NPC reactive movement failed (non-critical):', gridErr.message);
        }

    } catch (sceneError) {
        console.error('[GameAgent] Scene context update failed (non-critical):', sceneError.message);
    }
}

// ============ GRID MOVEMENT ============

/**
 * Update grid positions for player and NPCs after an action.
 * - Player moves toward the entity they interacted with (fuzzy name match on input)
 * - Interacted NPC moves toward the player (1-2 steps)
 * - On location change (didMove), player position is reset by executeGetScene
 *
 * @returns {{ playerMoved: boolean, npcsMoved: string[] }}
 */
async function updateGridPositions(plotId, input, didMove, lookedUpNpcNames = []) {
    console.log(`[GridMovement] Called: input="${input?.substring(0, 40)}", didMove=${didMove}, lookedUpNpcs=${lookedUpNpcNames.join(',')}`);
    if (didMove) return { playerMoved: false, npcsMoved: [] }; // executeGetScene handles new location

    try {
        const plot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');

        const settlement = plot?.current_state?.current_location?.settlement;
        const locationId = plot?.current_state?.current_location?.locationId;
        let playerPos = plot?.current_state?.gridPosition;

        console.log(`[GridMovement] Data: settlement=${!!settlement}, locationId=${!!locationId}, playerPos=${JSON.stringify(playerPos)}`);

        if (!settlement || !locationId) {
            return { playerMoved: false, npcsMoved: [] };
        }

        const currentLoc = settlement.locations?.find(
            l => l._id.toString() === locationId.toString()
        );

        if (!currentLoc?.gridGenerated || !currentLoc.interiorGrid) {
            return { playerMoved: false, npcsMoved: [] };
        }

        // Backfill player position if missing
        if (!playerPos || playerPos.x == null) {
            playerPos = sceneGridService.findPlayerStart(currentLoc.interiorGrid);
            plot.current_state.gridPosition = playerPos;
            plot.markModified('current_state.gridPosition');
            await plot.save();
            console.log(`[GridMovement] Backfilled player position: (${playerPos.x},${playerPos.y})`);
        }

        const grid = currentLoc.interiorGrid;
        const pois = await Poi.find({
            settlement: settlement._id,
            locationId: currentLoc._id,
            'gridPosition.x': { $ne: null }
        });

        if (pois.length === 0) return { playerMoved: false, npcsMoved: [] };

        // Build occupied set (all entity positions + player)
        const occupied = new Set();
        for (const p of pois) occupied.add(`${p.gridPosition.x},${p.gridPosition.y}`);
        occupied.add(`${playerPos.x},${playerPos.y}`);

        const inputLower = input.toLowerCase();
        const inputWords = inputLower.split(/\s+/).filter(w => w.length > 2);
        const result = { playerMoved: false, npcsMoved: [] };

        // --- Find which entity the player is interacting with ---
        let targetPoi = null;
        let bestMatchLen = 0;

        for (const poi of pois) {
            const nameLower = poi.name.toLowerCase();
            // Full name in input: "I talk to Theron Ashwater" matches "theron ashwater"
            if (inputLower.includes(nameLower) && nameLower.length > bestMatchLen) {
                targetPoi = poi;
                bestMatchLen = nameLower.length;
            }
            // First name match: "I talk to Theron" matches "theron ashwater"
            if (!targetPoi || nameLower.length > bestMatchLen) {
                const firstName = nameLower.split(/\s+/)[0];
                if (firstName.length > 2 && inputWords.includes(firstName) && firstName.length > bestMatchLen) {
                    targetPoi = poi;
                    bestMatchLen = firstName.length;
                }
            }
        }

        // Fallback: if no name match from input, check if AI looked up an NPC via tool call
        if (!targetPoi && lookedUpNpcNames.length > 0) {
            for (const npcName of lookedUpNpcNames) {
                const npcLower = npcName.toLowerCase();
                const match = pois.find(p => p.name.toLowerCase() === npcLower ||
                    p.name.toLowerCase().includes(npcLower) ||
                    npcLower.includes(p.name.toLowerCase()));
                if (match) {
                    targetPoi = match;
                    console.log(`[GridMovement] Matched via lookup_npc tool: ${match.name}`);
                    break;
                }
            }
        }

        // Also check for exit/door keywords
        const exitKeywords = ['door', 'exit', 'leave', 'outside', 'entrance'];
        const wantsExit = exitKeywords.some(kw => inputLower.includes(kw));

        if (targetPoi) {
            // Move player toward the target entity
            const targetPos = targetPoi.gridPosition;
            const dist = spatialService.manhattanDistance(playerPos.x, playerPos.y, targetPos.x, targetPos.y);

            if (dist > 1) {
                // Remove player's old position from occupied
                occupied.delete(`${playerPos.x},${playerPos.y}`);

                const candidates = sceneGridService.findAdjacentWalkable(grid, targetPos, playerPos, occupied);
                if (candidates.length > 0) {
                    const newPos = candidates[0];
                    plot.current_state.gridPosition = { x: newPos.x, y: newPos.y };
                    occupied.add(`${newPos.x},${newPos.y}`);
                    result.playerMoved = true;
                } else {
                    // Can't get adjacent — take steps toward target instead
                    occupied.delete(`${playerPos.x},${playerPos.y}`);
                    let pos = { ...playerPos };
                    for (let i = 0; i < Math.min(dist - 1, 3); i++) {
                        const step = sceneGridService.stepToward(grid, pos, targetPos, occupied);
                        if (!step) break;
                        occupied.delete(`${pos.x},${pos.y}`);
                        pos = step;
                        occupied.add(`${pos.x},${pos.y}`);
                    }
                    if (pos.x !== playerPos.x || pos.y !== playerPos.y) {
                        plot.current_state.gridPosition = { x: pos.x, y: pos.y };
                        result.playerMoved = true;
                    }
                }

                // If target is an NPC, move them toward the player too (conversation proximity)
                if (targetPoi.type === 'npc' && dist > 2) {
                    const newPlayerPos = plot.current_state.gridPosition;
                    occupied.delete(`${targetPoi.gridPosition.x},${targetPoi.gridPosition.y}`);
                    let npcPos = { ...targetPoi.gridPosition };
                    // NPC takes 1-2 steps toward player
                    for (let i = 0; i < 2; i++) {
                        const step = sceneGridService.stepToward(grid, npcPos, newPlayerPos, occupied);
                        if (!step) break;
                        occupied.delete(`${npcPos.x},${npcPos.y}`);
                        npcPos = step;
                        occupied.add(`${npcPos.x},${npcPos.y}`);
                    }
                    if (npcPos.x !== targetPoi.gridPosition.x || npcPos.y !== targetPoi.gridPosition.y) {
                        targetPoi.gridPosition = { x: npcPos.x, y: npcPos.y };
                        await targetPoi.save();
                        result.npcsMoved.push(targetPoi.name);
                    }
                }
            }
        } else if (wantsExit) {
            // Move player toward the nearest door
            const doors = sceneGridService.findDoors(grid);
            if (doors.length > 0) {
                // Find closest door to player
                doors.sort((a, b) => {
                    const da = spatialService.manhattanDistance(playerPos.x, playerPos.y, a.x, a.y);
                    const db = spatialService.manhattanDistance(playerPos.x, playerPos.y, b.x, b.y);
                    return da - db;
                });
                const door = doors[0];
                const dist = spatialService.manhattanDistance(playerPos.x, playerPos.y, door.x, door.y);
                if (dist > 1) {
                    occupied.delete(`${playerPos.x},${playerPos.y}`);
                    const candidates = sceneGridService.findAdjacentWalkable(grid, door, playerPos, occupied);
                    if (candidates.length > 0) {
                        plot.current_state.gridPosition = { x: candidates[0].x, y: candidates[0].y };
                        result.playerMoved = true;
                    }
                }
            }
        }

        if (result.playerMoved || result.npcsMoved.length > 0) {
            plot.markModified('current_state.gridPosition');
            await plot.save();
            const pp = plot.current_state.gridPosition;
            console.log(`[GridMovement] Player→(${pp.x},${pp.y})${result.npcsMoved.length ? ', NPCs moved: ' + result.npcsMoved.join(', ') : ''}`);
        }

        return result;
    } catch (err) {
        console.error('[GridMovement] Error:', err.message);
        return { playerMoved: false, npcsMoved: [] };
    }
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

        // Emit tool call event for frontend
        yield { type: 'tool_call', tool: toolName, display: getToolDisplay(toolName, args) };

        const toolStart = Date.now();
        const result = await executeTool(plotId, toolName, args);
        const toolMs = Date.now() - toolStart;
        rawToolResults.push({ toolName, result });
        toolResultTexts.push(formatToolResult(toolName, result));

        // Debug: summarize tool result
        if (toolName === 'get_scene') {
            const npcs = (result.npcsPresent || []).map(n => n.name).join(', ') || 'none';
            const exits = (result.exits || []).map(e => `${e.direction}→${e.name}`).join(', ') || 'none';
            yield { type: 'debug', category: 'db', message: `get_scene → ${result.location || '?'}`, detail: `NPCs: ${npcs} | Exits: ${exits} | ${toolMs}ms` };
        } else if (toolName === 'lookup_npc') {
            yield { type: 'debug', category: 'db', message: `lookup_npc → ${result.name || args.name}`, detail: `Found: ${result.found} | Disposition: ${result.disposition || '?'} | ${toolMs}ms` };
        } else if (toolName === 'move_player') {
            yield { type: 'debug', category: 'db', message: `move_player → ${args.destination}`, detail: `Success: ${result.success}${result.reason ? ' | ' + result.reason : ''} | ${toolMs}ms` };
        } else if (toolName === 'skill_check') {
            yield { type: 'debug', category: 'roll', message: `🎲 d20=${result.roll} (${result.difficulty} ${result.type}) → ${result.result}`, detail: `"${result.action}" | need ${result.minPass} to pass, ${result.strongPass} for crit | ${toolMs}ms` };
        } else if (toolName === 'update_npc_relationship') {
            yield { type: 'debug', category: 'db', message: `update_npc → ${args.npc_name} = ${args.new_disposition}`, detail: `Reason: ${args.reason} | ${toolMs}ms` };
        } else if (toolName === 'update_quest') {
            yield { type: 'debug', category: 'db', message: `update_quest → "${args.quest_title}" (${args.update_type})`, detail: `${args.summary} | ${toolMs}ms` };
        }

        // If movement happened, capture the narration
        if (toolName === 'move_player' && result.success) {
            movementNarration = result.narration;
        }

        // If skill check, emit SSE event and store for persistence
        if (toolName === 'skill_check') {
            skillCheckData = result;
            yield { type: 'skill_check', data: result };
        }

        // If quest update, emit SSE event
        if (toolName === 'update_quest' && result.success) {
            questUpdateData = result.quest;
            yield { type: 'quest_update', data: result.quest };
        }
    }

    console.log(`[GameAgent] Tools executed (${Date.now() - startTime}ms)`);
    yield { type: 'debug', category: 'system', message: `All tools executed`, detail: `${Date.now() - startTime}ms total` };

    // If movement happened, re-run get_scene at the NEW location so entities are fresh
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
        // Replace old get_scene results with fresh data
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
    // Only include DISCOVERED entities in what the frontend shows (scene panel, entity links)
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

    // Build scene context block from persisted state
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
        // Non-critical: spatial context is a nice-to-have
        console.error('[Spatial] Context injection failed:', spatialErr.message);
    }

    // Inject quest context
    const questContext = await questService.getQuestContext(plotId);
    const fullContext = sceneContextBlock + enrichedContext + spatialContextBlock + questContext;

    // Get optional quest hook for narrator
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

        // Post-processing: use atomic $set to avoid overwriting gridPosition
        const lowerInput = input.toLowerCase();
        const activityUpdate = {};
        if (lowerInput.includes('rest') || lowerInput.includes('sleep')) {
            activityUpdate['current_state.current_activity'] = 'resting';
            if (lowerInput.includes('until morning')) activityUpdate['current_state.current_time'] = 'morning';
        } else if (lowerInput.includes('attack') || lowerInput.includes('fight')) {
            activityUpdate['current_state.current_activity'] = 'in combat';
        } else {
            // Check if currently resting — need to read current state
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

        // ---- Detect untracked departure: clear stale scene entities immediately ----
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

        // ---- Fire-and-forget: scene context update (runs in background, doesn't block player) ----
        // This GPT call takes 10-25s but the player doesn't need it for this turn.
        // It'll be ready in the DB for the next turn's context.
        updateSceneContextBackground(plotId, plot.current_state?.sceneContext || {}, enrichedContext, input, fullResponse);

        // ---- Fire-and-forget: quest seed generation ----
        questService.shouldGenerateSeeds(plotId).then(should => {
            if (should) questService.generateQuestSeeds(plotId).catch(err =>
                console.error('[Quest] Seed gen failed:', err.message));
        });

        // ---- Fire-and-forget: expire stale quests on movement ----
        if (didMove) {
            questService.expireStaleQuests(plotId).catch(err =>
                console.error('[Quest] Expiration failed:', err.message));
        }

        // ---- Discovery parsing + suggestion generation + quest discovery in parallel ----
        yield { type: 'debug', category: 'ai', message: `Generating suggested actions → ${GAME_MODEL}` };

        const [discoveryResult, suggestionsResult, questDiscovery] = await Promise.all([
            runDiscoveryParsing(plotId, fullResponse, input, featureTypes),
            generateCategorizedSuggestions(enrichedContext, input, fullResponse),
            questService.detectQuestDiscovery(plotId, fullResponse)
        ]);

        // Yield discovery events
        if (discoveryResult) {
            yield { type: 'debug', category: 'db', message: `Discoveries: ${discoveryResult.discoveryEntities.length} new`, detail: discoveryResult.discoveryEntities.map(d => `${d.type}:${d.name}`).join(', ') };
            yield { type: 'discoveries', entities: discoveryResult.discoveryEntities };
            sceneEntities = discoveryResult.updatedSceneEntities;
            yield { type: 'scene_entities', entities: discoveryResult.updatedSceneEntities };
        }

        // Yield suggestion events
        if (suggestionsResult) {
            const catSummary = Object.entries(suggestionsResult.categories).filter(([,v]) => v && v.length > 0).map(([k,v]) => `${k}(${v.length})`).join(', ');
            yield { type: 'debug', category: 'ai', message: `Suggestions generated: ${catSummary}`, detail: `${Date.now() - startTime}ms total` };
            yield { type: 'categorized_actions', categories: suggestionsResult.categories };

            if (suggestionsResult.flatActions.length > 0) {
                yield { type: 'suggested_actions', actions: suggestionsResult.flatActions };
            }
            console.log(`[GameAgent] Suggestions yielded (${Date.now() - startTime}ms)`);
        }

        // Yield quest discovery events
        if (questDiscovery && questDiscovery.length > 0) {
            yield { type: 'debug', category: 'db', message: `Quest discoveries: ${questDiscovery.length}`, detail: questDiscovery.map(q => q.title).join(', ') };
            yield { type: 'quest_discovered', quests: questDiscovery };
        }

        // Yield quest update event (if AI used update_quest tool)
        if (questUpdateData) {
            yield { type: 'quest_update', data: questUpdateData };
        }

        // ---- Update grid positions (player + NPC movement) ----
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
