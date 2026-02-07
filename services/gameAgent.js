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
const { openai, buildSystemPrompt, GAME_MODEL, simplePrompt } = require('./gptService');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');

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
    if (poiCount === 0) {
        await generateFirstImpression(settlement, currentLoc);
    }

    // Query ALL POIs at this location (AI needs full context; frontend filters by discovered)
    const pois = await Poi.find({ settlement: settlement._id, locationId: currentLoc._id });

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
- NPCs must have PROPER NAMES (e.g. "Grimjaw" not "the barkeep")
- Objects should be specific and notable (e.g. "Notice Board" not "some furniture")
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

Return ONLY valid JSON:
{
    "populationLevel": "populated",
    "pois": [
        { "name": "Grimjaw", "type": "npc", "description": "A grizzled barkeep polishing a cracked mug", "disposition": "gruff but fair, respects direct talk", "icon": "👤" },
        { "name": "Notice Board", "type": "object", "description": "A weathered board pinned with faded requests", "icon": "📋" }
    ]
}`;

    try {
        const result = await simplePrompt('gpt-5-mini',
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

    } catch (e) {
        console.error(`[FirstImpression] Failed for ${location.name}:`, e.message);
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

async function executeTool(plotId, toolName, args) {
    switch (toolName) {
        case 'get_scene': return await executeGetScene(plotId);
        case 'lookup_npc': return await executeLookupNpc(plotId, args.name);
        case 'move_player': return await executeMovePlayer(plotId, args.destination);
        case 'update_npc_relationship': return await executeUpdateRelationship(plotId, args.npc_name, args.new_disposition, args.reason);
        case 'skill_check': return executeSkillCheck(args.action, args.difficulty, args.type);
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

        const sceneResult = await simplePrompt('gpt-5-mini',
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

        const scPlot = await Plot.findById(plotId);
        scPlot.current_state.sceneContext = sanitized;
        await scPlot.save();

        console.log(`[GameAgent] Scene context updated: tension=${sanitized.tension}, ${sanitized.npcsPresent.length} NPCs, turn ${sanitized.turnCount}`);
    } catch (sceneError) {
        console.error('[GameAgent] Scene context update failed (non-critical):', sceneError.message);
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
    const fullContext = sceneContextBlock + enrichedContext;

    const narrativeSystemPrompt = `${buildSystemPrompt(tone, difficulty)}

RESPONSE RULES:
- Respond DIRECTLY to what the player just said or did. First sentence = immediate reaction to THIS action.
- Do NOT re-describe the scene. The player is already there.
- If the player is talking to someone, that person responds. Don't introduce unrelated characters.
- Keep conversation continuity — if a conversation is in progress, continue it naturally.
- If the player both acts AND speaks, handle both in one response.
- Respect the POPULATION level in the scene data. In isolated/sparse areas, do NOT invent NPCs. In populated/crowded areas, ambient NPCs fitting the location are natural.
- If the player has left an area (per conversation history), NPCs from that area are gone. Do not let the player interact with them.`;

    const narrativeMessages = [
        { role: "system", content: narrativeSystemPrompt },
        {
            role: "user",
            content: `GAME STATE:\n${fullContext}\n\nRECENT CONVERSATION:\n${historyContext}\n\nPLAYER: "${input}"\n\nRespond to the player's action/words. Be direct and concise.`
        }
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

        // Post-processing: state updates (reload plot to avoid version conflicts from tool saves)
        const freshPlot = await Plot.findById(plotId);
        const lowerInput = input.toLowerCase();
        if (lowerInput.includes('rest') || lowerInput.includes('sleep')) {
            freshPlot.current_state.current_activity = 'resting';
            if (lowerInput.includes('until morning')) freshPlot.current_state.current_time = 'morning';
        } else if (lowerInput.includes('attack') || lowerInput.includes('fight')) {
            freshPlot.current_state.current_activity = 'in combat';
        } else if (freshPlot.current_state.current_activity === 'resting') {
            freshPlot.current_state.current_activity = 'exploring';
        }
        await freshPlot.save();

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

        // ---- Discovery parsing + suggestion generation in parallel ----
        yield { type: 'debug', category: 'ai', message: `Generating suggested actions → ${GAME_MODEL}` };

        const [discoveryResult, suggestionsResult] = await Promise.all([
            runDiscoveryParsing(plotId, fullResponse, input, featureTypes),
            generateCategorizedSuggestions(enrichedContext, input, fullResponse)
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

    } catch (error) {
        console.error('[GameAgent] Narrative streaming failed:', error.message);
        yield { type: 'chunk', content: 'The world falls silent for a moment...' };
    }

    yield { type: 'done' };
}

module.exports = { processInput, TOOLS };
