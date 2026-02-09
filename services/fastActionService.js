/**
 * fastActionService.js - Tier 0/1 response handlers.
 *
 * Async generator with same interface as gameAgent.processInput()
 * so the route handler's iteration loop stays identical.
 *
 * Tier 0: Code-only, template responses (~0-1s)
 * Tier 1: UTILITY_MODEL, 1-2 sentence responses (~2-5s)
 *
 * Yields: { type: 'chunk'|'scene_entities'|'done'|'grid_updated'|'world_reaction', ... }
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');
const { getSettlementAndLocation, getCurrentLocation } = require('./locationResolver');
const { updateGridPositions } = require('./gridMovementService');
const { executeGetScene } = require('./sceneManager');
const { chatCompletion, UTILITY_MODEL } = require('./gptService');

// ============ MOVEMENT TEMPLATES ============

const MOVE_TEMPLATES = {
    tavern: [
        "You cross the worn floorboards heading {direction}.",
        "You step {direction}, past a creaky chair.",
        "You weave {direction} between the tables.",
        "Your boots scuff the ale-stained floor as you move {direction}.",
    ],
    docks: [
        "You walk {direction} along the salt-stained planks.",
        "Your boots thud against the dock boards as you head {direction}.",
        "You pick your way {direction} past coiled ropes and crates.",
    ],
    market: [
        "You push {direction} through the crowd.",
        "You weave {direction} past a cluttered stall.",
        "You shoulder {direction} through the market traffic.",
    ],
    temple: [
        "Your footsteps echo as you move {direction} across the stone floor.",
        "You walk {direction}, the quiet pressing in around you.",
    ],
    shop: [
        "You step {direction} past the shelves.",
        "You move {direction} through the cluttered shop.",
    ],
    residential: [
        "You step {direction} across the room.",
        "You move {direction} through the living space.",
    ],
    warehouse: [
        "You move {direction} between stacked crates.",
        "Your footsteps echo as you head {direction} through the warehouse.",
    ],
    default: [
        "You head {direction}.",
        "You move {direction} across the space.",
        "You take a few steps {direction}.",
        "You walk {direction}.",
    ]
};

const WAIT_AMBIANCE = {
    tavern: "the murmur of conversation and clink of tankards",
    docks: "the creak of ships and cry of gulls",
    market: "the bustle of merchants and haggling voices",
    temple: "the silence broken only by distant prayer",
    default: "the world passing by around you"
};

const REST_TEMPLATES = [
    "You find a quiet spot and rest. Time passes as you catch your breath.",
    "You settle in and take a moment to rest. The tension in your muscles eases.",
    "You pause and rest briefly, letting your body recover.",
];

const GESTURE_TEMPLATES = {
    wave: "You raise a hand in greeting.",
    nod: "You give a slow nod.",
    bow: "You bow respectfully.",
    kneel: "You drop to one knee.",
    shrug: "You shrug.",
    "sit down": "You take a seat.",
    "stand up": "You rise to your feet.",
    stretch: "You stretch, working out the stiffness.",
    yawn: "You stifle a yawn.",
    sigh: "You let out a quiet sigh.",
    lean: "You lean back and make yourself comfortable.",
    default: "You do so quietly."
};

// ============ HELPERS ============

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getDirectionWord(input) {
    const dirs = ['northeast', 'northwest', 'southeast', 'southwest', 'north', 'south', 'east', 'west'];
    const lower = input.toLowerCase();
    for (const d of dirs) {
        if (lower.includes(d)) return d;
    }
    return 'forward';
}

function getLocationTypeTemplates(locationType) {
    return MOVE_TEMPLATES[locationType] || MOVE_TEMPLATES.default;
}

/**
 * Build scene entities object from scene data (same format as gameAgent).
 */
function buildSceneEntities(sceneData) {
    const featureTypes = new Set(['entrance', 'landmark', 'shop', 'danger', 'quest', 'other']);
    const entities = { npcs: [], objects: [], features: [], locations: [], currentLocation: sceneData.location || '' };

    if (sceneData.npcsPresent) {
        entities.npcs.push(...sceneData.npcsPresent.filter(n => n.discovered).map(n => n.name));
    }
    if (sceneData.objects) {
        for (const o of sceneData.objects) {
            if (!o.discovered) continue;
            if (featureTypes.has(o.type)) {
                entities.features.push(o.name);
            } else {
                entities.objects.push(o.name);
            }
        }
    }
    if (sceneData.exits) {
        entities.locations.push(...sceneData.exits.map(e => e.name));
    }
    return entities;
}

// ============ MAIN EXECUTE ============

/**
 * Execute a Tier 0 or Tier 1 action.
 * Async generator that yields the same event types as gameAgent.processInput().
 *
 * @param {string} input - Player input text
 * @param {string} plotId - Plot ID
 * @param {Object} classification - { tier, actionType, params }
 * @param {Object} options - { moveTarget, worldTickCallback }
 */
async function* execute(input, plotId, classification, options = {}) {
    const startTime = Date.now();
    const { actionType, params } = classification;

    try {
        const { plot, settlement, location } = await getSettlementAndLocation(plotId);
        const locationType = location?.type || 'default';

        // Dispatch to handler
        switch (actionType) {
            case 'grid_move':
            case 'grid_click':
            case 'grid_move_to':
                yield* handleMovement(input, plotId, plot, location, locationType, classification, options);
                break;

            case 'look_around':
                yield* handleLookAround(plotId, plot);
                break;

            case 'examine_entity':
                yield* handleExamineEntity(plotId, settlement, location, params);
                break;

            case 'rest':
                yield* handleRest(plotId, params);
                break;

            case 'wait':
                yield* handleWait(locationType);
                break;

            case 'check_exits':
                yield* handleCheckExits(location);
                break;

            case 'gesture':
                yield* handleGesture(input);
                break;

            // Tier 1 handlers
            case 'npc_greeting':
            case 'npc_simple_ask':
            case 'farewell':
                yield* handleNpcInteraction(input, plotId, settlement, location, actionType, params);
                break;

            case 'simple_interact':
            case 'eat_drink':
                yield* handleSimpleInteract(input, plotId, settlement, location, locationType, params);
                break;

            case 'flavor_action':
                yield* handleFlavorAction(input, plotId, location, locationType);
                break;

            case 'eavesdrop':
                yield* handleEavesdrop(plotId, settlement, location);
                break;

            default:
                yield { type: 'chunk', content: 'You consider your options.' };
                yield { type: 'done' };
                break;
        }

        // Save to game log (compressed format)
        try {
            const gameLogService = require('./gameLogService');
            await gameLogService.saveQuickAction(plotId, input, actionType);
        } catch (e) {
            console.error('[FastAction] Log save failed:', e.message);
        }

        // Fire world tick for actions that might provoke world reactions
        const SKIP_WORLD_TICK = new Set(['look_around', 'check_exits', 'examine_entity']);
        if (options.worldTickCallback && !SKIP_WORLD_TICK.has(actionType)) {
            options.worldTickCallback(input, actionType, '');
        }

        console.log(`[FastAction] ${actionType} complete (${Date.now() - startTime}ms)`);

    } catch (err) {
        console.error('[FastAction] Error:', err.message);
        yield { type: 'chunk', content: 'You pause for a moment.' };
        yield { type: 'done' };
    }
}

// ============ TIER 0 HANDLERS ============

async function* handleMovement(input, plotId, plot, location, locationType, classification, options) {
    const direction = getDirectionWord(input);
    const templates = getLocationTypeTemplates(locationType);
    const template = pickRandom(templates).replace('{direction}', direction);

    yield { type: 'chunk', content: template };

    // Get scene entities from cached scene data
    try {
        const sceneData = await executeGetScene(plotId);
        yield { type: 'scene_entities', entities: buildSceneEntities(sceneData) };
    } catch (e) {
        // Non-critical
    }

    yield { type: 'done' };

    // Grid position update
    await updateGridPositions(plotId, input, false, [], options.moveTarget || null);
    yield { type: 'grid_updated' };
}

async function* handleLookAround(plotId, plot) {
    try {
        const sceneData = await executeGetScene(plotId);
        const entities = buildSceneEntities(sceneData);

        // Format scene data as readable text
        const parts = [];
        if (sceneData.description) {
            parts.push(sceneData.description);
        }

        if (sceneData.npcsPresent?.length > 0) {
            const discovered = sceneData.npcsPresent.filter(n => n.discovered);
            if (discovered.length > 0) {
                const npcList = discovered.map(n => `**${n.name}**`).join(', ');
                parts.push(`You see ${npcList} nearby.`);
            }
        }

        if (sceneData.objects?.length > 0) {
            const discovered = sceneData.objects.filter(o => o.discovered);
            if (discovered.length > 0) {
                const objList = discovered.map(o => `**${o.name}**`).join(', ');
                parts.push(`Notable: ${objList}.`);
            }
        }

        if (sceneData.exits?.length > 0) {
            const exitList = sceneData.exits.map(e =>
                `${e.direction} → **${e.name}**${e.via ? ` (${e.via})` : ''}`
            ).join(', ');
            parts.push(`Exits: ${exitList}.`);
        }

        yield { type: 'chunk', content: parts.join('\n\n') || 'You look around but see nothing of note.' };
        yield { type: 'scene_entities', entities };
    } catch (e) {
        yield { type: 'chunk', content: 'You glance around the area.' };
    }

    yield { type: 'done' };
}

async function* handleExamineEntity(plotId, settlement, location, params) {
    try {
        const poi = await Poi.findOne({
            settlement: settlement._id,
            locationId: location._id,
            name: { $regex: new RegExp(params.targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        });

        if (poi) {
            const parts = [`**${poi.name}**`];
            if (poi.description) parts.push(poi.description);
            if (poi.type === 'npc' && poi.disposition) parts.push(`*${poi.disposition}*`);
            if (poi.interactionCount > 0) parts.push(`You've interacted with them ${poi.interactionCount} time${poi.interactionCount > 1 ? 's' : ''} before.`);

            yield { type: 'chunk', content: parts.join(' — ') };
        } else {
            yield { type: 'chunk', content: `You look more closely but don't see anything notable about that.` };
        }
    } catch (e) {
        yield { type: 'chunk', content: 'You take a closer look.' };
    }

    yield { type: 'done' };
}

async function* handleRest(plotId, params) {
    const activityUpdate = { 'current_state.current_activity': 'resting' };
    if (params.untilMorning) {
        activityUpdate['current_state.current_time'] = 'morning';
    }
    await Plot.findByIdAndUpdate(plotId, { $set: activityUpdate });

    yield { type: 'chunk', content: pickRandom(REST_TEMPLATES) };
    yield { type: 'done' };
}

async function* handleWait(locationType) {
    const ambiance = WAIT_AMBIANCE[locationType] || WAIT_AMBIANCE.default;
    yield { type: 'chunk', content: `You wait, watching ${ambiance}.` };
    yield { type: 'done' };
}

async function* handleCheckExits(location) {
    const connections = location?.connections || [];
    if (connections.length === 0) {
        yield { type: 'chunk', content: "You don't see any obvious exits from here." };
    } else {
        const exitLines = connections.map(c =>
            `**${c.direction}** → **${c.locationName}**${c.description ? ` (${c.description})` : ''}`
        );
        yield { type: 'chunk', content: `From here you can go:\n${exitLines.join('\n')}` };
    }
    yield { type: 'done' };
}

async function* handleGesture(input) {
    const inputLower = input.toLowerCase();
    let response = GESTURE_TEMPLATES.default;

    for (const [key, template] of Object.entries(GESTURE_TEMPLATES)) {
        if (key !== 'default' && inputLower.includes(key)) {
            response = template;
            break;
        }
    }

    yield { type: 'chunk', content: response };
    yield { type: 'done' };
}

// ============ TIER 1 HANDLERS ============

async function* handleNpcInteraction(input, plotId, settlement, location, actionType, params) {
    // Find the NPC
    let npc = null;
    if (params.npcName) {
        npc = await Poi.findOne({
            settlement: settlement._id,
            locationId: location._id,
            type: 'npc',
            name: { $regex: new RegExp(params.npcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        });
    }

    if (!npc) {
        // Find closest NPC at location
        npc = await Poi.findOne({
            settlement: settlement._id,
            locationId: location._id,
            type: 'npc',
            discovered: true
        });
    }

    if (!npc) {
        yield { type: 'chunk', content: "There's no one here to talk to." };
        yield { type: 'done' };
        return;
    }

    // Get reputation for this NPC
    const plot = await Plot.findById(plotId);
    const repNpc = (plot.reputation?.npcs || []).find(n =>
        n.name.toLowerCase().includes(npc.name.toLowerCase())
    );
    const disposition = repNpc?.disposition || 'neutral';

    // Build rich prompt using NPC context
    const { buildNpcPromptContext } = require('./npcContextService');
    const npcCtx = buildNpcPromptContext(npc, repNpc);

    const promptParts = [`You are ${npc.name}. Stay in character based on your profile:\n${npcCtx}`];
    promptParts.push(`\nRULES: Your goal and problem color HOW you respond. A worried NPC is distracted. A greedy NPC sizes up opportunities. Don't dump backstory — let it leak naturally.`);

    if (actionType === 'farewell') {
        promptParts.push('The player is saying goodbye. Respond in character with a brief farewell (1 sentence).');
    } else if (actionType === 'npc_simple_ask') {
        promptParts.push('Respond to the player\'s question in character. Be brief (1-2 sentences). If you don\'t know, say so in character.');
    } else {
        promptParts.push('The player is greeting you. Respond in character with a brief greeting (1-2 sentences).');
    }

    const messages = [
        { role: 'system', content: promptParts.join(' ') },
        { role: 'user', content: `The player says: "${input}"` }
    ];

    try {
        const response = await chatCompletion(UTILITY_MODEL, messages);
        const text = response.content || '';

        // Format with NPC speaker tag
        yield { type: 'chunk', content: `**${npc.name}**: "${text.replace(/^["']|["']$/g, '')}"` };

        // Update interaction count
        await Poi.findByIdAndUpdate(npc._id, { $inc: { interactionCount: 1 } });
    } catch (e) {
        console.error('[FastAction] NPC response failed:', e.message);
        yield { type: 'chunk', content: `**${npc.name}** glances at you but says nothing.` };
    }

    yield { type: 'done' };

    // Grid movement toward NPC
    await updateGridPositions(plotId, input, false, [npc.name]);
    yield { type: 'grid_updated' };
}

async function* handleSimpleInteract(input, plotId, settlement, location, locationType, params) {
    const messages = [
        {
            role: 'system',
            content: `You are narrating a brief moment in a ${locationType || 'generic'} location called ${location?.name || 'somewhere'}. Describe the result of the player's simple action in 1-2 sentences. Be direct. Use second person ("You...").`
        },
        { role: 'user', content: `The player: "${input}"` }
    ];

    try {
        const response = await chatCompletion(UTILITY_MODEL, messages);
        yield { type: 'chunk', content: response.content || 'You do so.' };
    } catch (e) {
        yield { type: 'chunk', content: 'You do so.' };
    }

    yield { type: 'done' };
}

async function* handleFlavorAction(input, plotId, location, locationType) {
    const messages = [
        {
            role: 'system',
            content: `You are narrating a brief atmospheric moment in a ${locationType || 'generic'} location called ${location?.name || 'somewhere'}. The player is doing something purely for flavor/roleplay. Describe it in 1 sentence. Be vivid but terse. Second person.`
        },
        { role: 'user', content: `The player: "${input}"` }
    ];

    try {
        const response = await chatCompletion(UTILITY_MODEL, messages);
        yield { type: 'chunk', content: response.content || 'You do so quietly.' };
    } catch (e) {
        yield { type: 'chunk', content: 'You do so quietly.' };
    }

    yield { type: 'done' };
}

async function* handleEavesdrop(plotId, settlement, location) {
    const npcs = await Poi.find({
        settlement: settlement._id,
        locationId: location._id,
        type: 'npc',
        discovered: true
    }).select('name description disposition personality goal problem profession').limit(3);

    if (npcs.length === 0) {
        yield { type: 'chunk', content: "There's no one nearby to overhear." };
        yield { type: 'done' };
        return;
    }

    const npcList = npcs.map(n => {
        const parts = [n.name];
        if (n.personality || n.disposition) parts.push(`personality: ${n.personality || n.disposition}`);
        if (n.goal) parts.push(`wants: ${n.goal}`);
        if (n.problem) parts.push(`problem: ${n.problem}`);
        return parts.join(', ');
    }).join('\n');
    const messages = [
        {
            role: 'system',
            content: `Generate 2-3 sentences of overheard conversation between these NPCs:\n${npcList}\n\nTheir dialogue should naturally reflect their goals, problems, or personality — not generic small talk. Second person perspective ("You overhear..."). Don't reveal major plot points.`
        },
        { role: 'user', content: 'The player is trying to listen in on nearby conversation.' }
    ];

    try {
        const response = await chatCompletion(UTILITY_MODEL, messages);
        yield { type: 'chunk', content: response.content || 'You strain to hear but catch only fragments.' };
    } catch (e) {
        yield { type: 'chunk', content: 'You strain to hear but catch only fragments.' };
    }

    yield { type: 'done' };
}

module.exports = { execute };
