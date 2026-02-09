/**
 * inputClassifier.js - Deterministic action classification (no GPT calls).
 *
 * Classifies player input into tiers:
 *   Tier 0 (0-1s): Code-only, template responses
 *   Tier 1 (2-5s): UTILITY_MODEL, 1-2 sentence response
 *   Tier 2 (8-15s): GAME_MODEL with compressed context
 *   Tier 3 (20-35s): Full pipeline (unchanged)
 *
 * Promotion rules:
 *   - If tension >= 'tense', promote Tier 0 → Tier 2, Tier 1 → Tier 2
 *   - If current_activity === 'in combat', everything → Tier 2+
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');
const { getSettlementAndLocation } = require('./locationResolver');

// ============ PATTERNS ============

const MOVE_VERBS = /\b(walk|move|head|go|step|stroll|run|jog|wander|stride|cross|pace|trek|march|saunter|amble)\b/;
const DIRECTIONS = /\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/;
const LOOK_PATTERNS = /\b(look around|survey|check surroundings|glance around|scan the|take in the|observe the room|observe the area|what do i see|what's around)\b/;
const EXAMINE_PATTERNS = /\b(examine|look at|inspect|study|check out|peer at|scrutinize|observe)\b/;
const EXIT_PATTERNS = /\b(where can i go|what are the exits|any exits|any doors|which way|ways out|check exits|check the exits|check the doors)\b/;
const REST_PATTERNS = /\b(rest|sleep|catch my breath|take a break|lie down|nap|recuperate|camp|set up camp)\b/;
const WAIT_PATTERNS = /\b(wait|bide my time|i wait|wait here|stand here|stay here|remain here|hold position|hold my position)\b/;
const GESTURE_PATTERNS = /\b(wave|nod|sit down|stand up|bow|kneel|shrug|cross my arms|lean|stretch|yawn|sigh|scratch|crack my knuckles|fold my arms|shake my head|tilt my head)\b/;

const GREETING_PATTERNS = /\b(hello|hi|hey|greetings|good (morning|day|evening|afternoon)|hail|howdy|yo)\b/;
const FAREWELL_PATTERNS = /\b(goodbye|bye|farewell|see you|take care|i'll be going|i leave|i depart|later|so long)\b/;
const SIMPLE_ASK_PATTERNS = /\b(ask about|tell me about|what do you (know|sell|have|offer)|where is|where can i find|how much|what's your|do you know|heard any)\b/;
const EAT_DRINK_PATTERNS = /\b(eat|drink|sip|gulp|chew|bite|munch|devour|taste|order (a |an |the )?(ale|beer|wine|mead|food|drink|meal|stew|bread|water|rum|grog))\b/;
const FLAVOR_PATTERNS = /\b(lean against|stare out|gaze at|tap (my |the )|drum my|hum|whistle|fidget|pace back|pick at|trace my finger|rest my (hand|head|elbow)|play with)\b/;
const EAVESDROP_PATTERNS = /\b(listen in|overhear|eavesdrop|listen to (their|the) conversation|what are they saying|strain to hear)\b/;
const SIMPLE_INTERACT = /\b(pick up|grab|take|put down|set down|sit at|sit on|sit in|open the|close the|light the|blow out|push the|pull the|flip|turn the|ring the|knock)\b/;

const SKILL_CHECK_TRIGGERS = /\b(sneak|stealth|climb|persuade|convince|intimidate|threaten|pick the lock|lockpick|steal|pickpocket|craft|hide|deceive|lie to|bluff|disguise|forge|ambush|attack|fight|parry|dodge|block|disarm|tackle|grapple|swim|jump|leap|vault|scale|haggle|barter|negotiate|charm|seduce|manipulate|sabotage|poison|trap|bribe|coerce|enchant|cast|conjure|summon|invoke|channel)\b/;
const DEEP_DIALOGUE = /\b(argue|debate|negotiate|confront|accuse|confess|plead|demand|insist|challenge|interrogate|question closely|explain|reveal|confide)\b/;

/**
 * Classify player input into a tier and action type.
 *
 * @param {string} input - Raw player input text
 * @param {string} plotId - Plot ID for context lookup
 * @param {Object} options - { moveTarget }
 * @returns {{ tier: 0|1|2|3, actionType: string, params: Object }}
 */
async function classify(input, plotId, options = {}) {
    const inputLower = input.toLowerCase().trim();
    const startTime = Date.now();

    // Load minimal context for classification
    let sceneContext = null;
    let currentActivity = 'exploring';
    let poiNames = [];
    let connections = [];
    let npcsPresent = [];

    try {
        const { plot, settlement, location } = await getSettlementAndLocation(plotId);
        sceneContext = plot.current_state?.sceneContext || {};
        currentActivity = plot.current_state?.current_activity || 'exploring';

        if (settlement && location) {
            const pois = await Poi.find({
                settlement: settlement._id,
                locationId: location._id,
                discovered: true
            }).select('name type').lean();
            poiNames = pois.map(p => ({ name: p.name.toLowerCase(), type: p.type }));
            connections = (location.connections || []).map(c => ({
                direction: c.direction,
                name: c.locationName
            }));
        }

        npcsPresent = (sceneContext.npcsPresent || []).map(n => n.name?.toLowerCase()).filter(Boolean);
    } catch (e) {
        console.error('[Classifier] Context load failed, defaulting to Tier 3:', e.message);
        return { tier: 3, actionType: 'default', params: {} };
    }

    const tension = sceneContext.tension || 'calm';
    const isHighTension = tension === 'tense' || tension === 'hostile' || tension === 'critical';
    const inCombat = currentActivity === 'in combat';

    // Helper: promote tier based on tension/combat
    function applyPromotion(baseTier) {
        if (inCombat) return Math.max(baseTier, 2);
        if (isHighTension && baseTier < 2) return 2;
        return baseTier;
    }

    // Helper: find matching POI name in input
    function findPoiInInput(typeFilter = null) {
        let best = null;
        let bestLen = 0;
        for (const poi of poiNames) {
            if (typeFilter && poi.type !== typeFilter) continue;
            if (inputLower.includes(poi.name) && poi.name.length > bestLen) {
                best = poi;
                bestLen = poi.name.length;
            }
            // Also check first name
            const firstName = poi.name.split(/\s+/)[0];
            if (firstName.length > 2 && inputLower.includes(firstName) && firstName.length > bestLen) {
                best = poi;
                bestLen = firstName.length;
            }
        }
        return best;
    }

    // Helper: check if NPC is nearby (in scene)
    function npcNearby() {
        return npcsPresent.length > 0 || poiNames.some(p => p.type === 'npc');
    }

    let result;

    // ---- PRIORITY 1: Click-to-move (moveTarget provided) ----
    if (options.moveTarget && options.moveTarget.x != null && options.moveTarget.y != null) {
        result = { tier: applyPromotion(0), actionType: 'grid_click', params: { moveTarget: options.moveTarget } };
    }

    // ---- PRIORITY 2: Movement verb + direction ----
    else if (MOVE_VERBS.test(inputLower) && DIRECTIONS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'grid_move', params: {} };
    }

    // ---- PRIORITY 3: Movement verb + known entity name ----
    else if (MOVE_VERBS.test(inputLower)) {
        const targetPoi = findPoiInInput();
        if (targetPoi) {
            result = { tier: applyPromotion(0), actionType: 'grid_move_to', params: { targetName: targetPoi.name } };
        }
        // Also check for approach/move to patterns with connection names
        else {
            const connMatch = connections.find(c =>
                inputLower.includes(c.name.toLowerCase()) ||
                inputLower.includes(c.direction.toLowerCase())
            );
            if (connMatch) {
                // Moving to a different location = Tier 3 (uses move_player tool)
                result = { tier: 3, actionType: 'default', params: {} };
            }
        }
    }

    // ---- PRIORITY 4: Look around ----
    if (!result && LOOK_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'look_around', params: {} };
    }

    // ---- PRIORITY 5: Examine + known POI name ----
    if (!result && EXAMINE_PATTERNS.test(inputLower)) {
        const targetPoi = findPoiInInput();
        if (targetPoi) {
            result = { tier: applyPromotion(0), actionType: 'examine_entity', params: { targetName: targetPoi.name, targetType: targetPoi.type } };
        }
    }

    // ---- PRIORITY 6: Check exits ----
    if (!result && EXIT_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'check_exits', params: {} };
    }

    // ---- PRIORITY 7: Rest ----
    if (!result && REST_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'rest', params: { untilMorning: inputLower.includes('until morning') || inputLower.includes('sleep') } };
    }

    // ---- PRIORITY 8: Wait ----
    if (!result && WAIT_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'wait', params: {} };
    }

    // ---- PRIORITY 9: Gesture/posture ----
    if (!result && GESTURE_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(0), actionType: 'gesture', params: {} };
    }

    // ---- PRIORITY 10: Greeting + NPC nearby ----
    if (!result && GREETING_PATTERNS.test(inputLower) && npcNearby()) {
        const npcPoi = findPoiInInput('npc');
        result = { tier: applyPromotion(1), actionType: 'npc_greeting', params: { npcName: npcPoi?.name || null } };
    }

    // ---- PRIORITY 11: Simple NPC question ----
    if (!result && SIMPLE_ASK_PATTERNS.test(inputLower) && npcNearby()) {
        const npcPoi = findPoiInInput('npc');
        result = { tier: applyPromotion(1), actionType: 'npc_simple_ask', params: { npcName: npcPoi?.name || null } };
    }

    // ---- PRIORITY 12: Farewell ----
    if (!result && FAREWELL_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(1), actionType: 'farewell', params: {} };
    }

    // ---- PRIORITY 13: Eat/drink ----
    if (!result && EAT_DRINK_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(1), actionType: 'eat_drink', params: {} };
    }

    // ---- PRIORITY 14: Simple interact ----
    if (!result && SIMPLE_INTERACT.test(inputLower)) {
        const targetPoi = findPoiInInput();
        if (targetPoi) {
            result = { tier: applyPromotion(1), actionType: 'simple_interact', params: { targetName: targetPoi.name } };
        }
    }

    // ---- PRIORITY 15: Eavesdrop ----
    if (!result && EAVESDROP_PATTERNS.test(inputLower) && npcNearby()) {
        result = { tier: applyPromotion(1), actionType: 'eavesdrop', params: {} };
    }

    // ---- PRIORITY 16: Flavor action ----
    if (!result && FLAVOR_PATTERNS.test(inputLower)) {
        result = { tier: applyPromotion(1), actionType: 'flavor_action', params: {} };
    }

    // ---- PRIORITY 17: Skill-check triggers → Tier 2 ----
    if (!result && SKILL_CHECK_TRIGGERS.test(inputLower)) {
        result = { tier: 2, actionType: 'skill_action', params: {} };
    }

    // ---- PRIORITY 18: Deep NPC dialogue → Tier 2 ----
    if (!result && DEEP_DIALOGUE.test(inputLower) && npcNearby()) {
        result = { tier: 2, actionType: 'deep_dialogue', params: {} };
    }

    // ---- DEFAULT: Tier 3 ----
    if (!result) {
        result = { tier: 3, actionType: 'default', params: {} };
    }

    const ms = Date.now() - startTime;
    console.log(`[Classifier] "${input.substring(0, 50)}" → Tier ${result.tier} (${result.actionType}) [${ms}ms]`);

    return result;
}

module.exports = { classify };
