const Plot = require('../db/models/Plot');
const GameLog = require('../db/models/GameLog');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement');
const Poi = require('../db/models/Poi');
const regionFactory = require('../agents/world/factories/regionsFactory');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const { streamPrompt, GAME_MODEL } = require('../services/gptService');
const movementService = require('../services/movementService');
const discoveryService = require('../services/discoveryService');

/**
 * Get context about what time of day means for the world
 */
const getTimeContext = (timeOfDay) => {
    const contexts = {
        'dawn': 'The world is waking. Shops are closed but early workers stir. Good visibility but few people about.',
        'morning': 'The day begins. Markets open, people start their business. Good time for commerce and conversation.',
        'midday': 'Peak activity. Streets are busy, taverns serve lunch. Full visibility.',
        'afternoon': 'Activity continues. Some shops may close for rest. Shadows begin to lengthen.',
        'evening': 'Day winds down. Taverns fill up, shops close. Torches and lanterns being lit.',
        'night': 'Most honest folk are home. Taverns busy but streets quieter. Limited visibility without torchlight. Increased danger.',
        'midnight': 'Deep night. Only guards, criminals, and the desperate are out. Very limited visibility. High danger.',
        'day': 'Daylight hours. Normal activity levels.',
        'dusk': 'Light fading. People heading home. Shadows long and deep.'
    };

    const key = timeOfDay.toLowerCase();
    for (const [pattern, context] of Object.entries(contexts)) {
        if (key.includes(pattern)) {
            return context;
        }
    }
    return contexts['day'];
};

const getRecentMessages = async (plotId, limit = 20) => {
    if (!plotId) {
        throw new Error('plotId is undefined');
    }
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
};

/**
 * Build rich location context for AI prompts
 * This is the canonical way to tell the AI "where is the player"
 */
const buildLocationContext = async (plot) => {
    const settlement = plot.current_state?.current_location?.settlement;
    const region = plot.current_state?.current_location?.region;

    if (!settlement?.locations?.length) {
        // Wilderness or no settlement
        return `
CURRENT LOCATION: Wilderness
Region: ${region?.name || 'Unknown'}
${region?.description || 'Open terrain.'}
- You are traveling through unsettled lands.
`.trim();
    }

    // Find current location by locationId (preferred) or locationName (fallback)
    const locationId = plot.current_state.current_location.locationId;
    const locationName = plot.current_state.current_location.locationName;

    let currentLoc = null;
    if (locationId) {
        currentLoc = settlement.locations.find(l =>
            l._id.toString() === locationId.toString()
        );
    }
    if (!currentLoc && locationName) {
        currentLoc = settlement.locations.find(l =>
            l.name.toLowerCase() === locationName.toLowerCase()
        );
    }
    if (!currentLoc) {
        currentLoc = settlement.locations.find(l => l.isStartingLocation)
                  || settlement.locations[0];
    }

    if (!currentLoc) {
        return `
CURRENT LOCATION: ${settlement.name || 'Unknown Settlement'}
${settlement.description || 'A settlement.'}
`.trim();
    }

    // Build connections list with descriptions
    const connections = (currentLoc.connections || []).map(conn => {
        const targetLoc = settlement.locations.find(l =>
            l.name.toLowerCase() === conn.locationName?.toLowerCase()
        );
        const discovered = targetLoc?.discovered ? '' : ' (unexplored)';
        const via = conn.description ? ` — ${conn.description}` : '';
        return `  ${conn.direction || '•'}: ${conn.locationName}${via}${discovered}`;
    }).join('\n');

    // Build POIs list from standalone Poi collection (only discovered ones)
    const poiDocs = await Poi.find({
        settlement: settlement._id,
        locationId: currentLoc._id,
        discovered: true
    });
    const pois = poiDocs
        .map(p => {
            const typeLabel = {
                'npc': '👤 Person',
                'object': '📦 Object',
                'entrance': '🚪 Exit',
                'landmark': '🏛️ Feature',
                'danger': '⚠️ Danger',
                'quest': '❗ Important',
                'shop': '🛒 Shop',
                'other': '• Point of Interest'
            }[p.type] || '• Item';
            return `  ${typeLabel}: ${p.name}${p.description ? ` — ${p.description.substring(0, 50)}` : ''}`;
        }).join('\n');

    // Location type context
    const typeContext = {
        'tavern': 'A place for food, drink, and gossip.',
        'market': 'A busy trading area. Merchants and crowds.',
        'temple': 'A sacred space. Quiet and reverent.',
        'gate': 'An entry point. Guards may be present.',
        'plaza': 'An open public space.',
        'shop': 'A place of commerce.',
        'residence': 'Private dwellings.',
        'landmark': 'A notable location.',
        'dungeon': 'A dangerous underground area.',
        'docks': 'Near water. Ships and sailors.',
        'barracks': 'Military presence.',
        'palace': 'Seat of power. Formal and guarded.'
    }[currentLoc.type] || '';

    return `
CURRENT LOCATION: ${currentLoc.name} (${currentLoc.type || 'location'})
In: ${settlement.name}
${currentLoc.description || settlement.description || ''}
${typeContext ? `[${typeContext}]` : ''}

EXITS/CONNECTIONS:
${connections || '  (none discovered yet)'}

${pois ? `NOTABLE THINGS HERE:\n${pois}` : 'Nothing of note discovered here yet.'}

IMPORTANT: The player is AT "${currentLoc.name}". Any movement to a different location should describe leaving this place.
`.trim();
};

const ensureDescription = async (regionId, settlementId) => {
    const region = await Region.findById(regionId);
    if (!region.described) {
        await regionFactory.describe(regionId);
    }
    if (settlementId) {
        let settlement = await Settlement.findById(settlementId);
        if (!settlement.described) {
            await regionFactory.describeSettlements(regionId);
            // Reload settlement after description
            settlement = await Settlement.findById(settlementId);
        }
        // Ensure settlement has internal locations generated (after it has a proper name/description)
        if (settlement.described && !settlement.locationsGenerated) {
            console.log(`[Locations] Settlement described, now generating locations...`);
            await settlementsFactory.ensureLocations(settlementId);
        }
    }
};

/**
 * Ensure player has a location within the settlement
 * (locations should already be generated by ensureDescription)
 * Returns the current location name
 */
const ensurePlayerLocation = async (plot) => {
    const settlementId = plot.current_state?.current_location?.settlement?._id
                      || plot.current_state?.current_location?.settlement;

    if (!settlementId) return null;

    const settlement = await Settlement.findById(settlementId);
    if (!settlement || !settlement.locations?.length) {
        return null;
    }

    // If player doesn't have a locationName set, use the starting location
    if (!plot.current_state.current_location.locationName) {
        const startLoc = settlement.locations.find(l => l.isStartingLocation) || settlement.locations[0];
        if (startLoc) {
            plot.current_state.current_location.locationName = startLoc.name;
            await plot.save();
            return startLoc.name;
        }
    }

    return plot.current_state.current_location.locationName;
};

/**
 * Update the plot's current state based on action results
 * Uses simple heuristics instead of AI to avoid latency
 */
const updateCurrentState = async (plot, input, result) => {
    try {
        const lowerInput = input.toLowerCase();
        const lowerOutcome = (result.outcome || '').toLowerCase();

        // Detect activity changes from keywords
        let newActivity = null;
        if (lowerInput.includes('talk') || lowerInput.includes('speak') || lowerInput.includes('ask') || lowerInput.includes('say')) {
            newActivity = 'conversation';
        } else if (lowerInput.includes('rest') || lowerInput.includes('sleep') || lowerInput.includes('camp')) {
            newActivity = 'resting';
        } else if (lowerInput.includes('attack') || lowerInput.includes('fight') || lowerOutcome.includes('combat') || lowerOutcome.includes('battle')) {
            newActivity = 'in combat';
        } else if (lowerInput.includes('travel') || lowerInput.includes('journey') || lowerInput.includes('head to')) {
            newActivity = 'traveling';
        } else if (plot.current_state.current_activity === 'resting' || plot.current_state.current_activity === 'conversation') {
            // Return to exploring after resting or conversation ends
            newActivity = 'exploring';
        }

        if (newActivity && newActivity !== plot.current_state.current_activity) {
            plot.current_state.current_activity = newActivity;
        }

        // Handle time advancement for rest
        if (lowerInput.includes('sleep') || lowerInput.includes('rest until morning') || lowerInput.includes('sleep until')) {
            plot.current_state.current_time = 'morning';
        } else if (lowerInput.includes('wait') || lowerInput.includes('pass time')) {
            // Advance time one step
            const timeOrder = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night', 'midnight'];
            const currentIdx = timeOrder.indexOf(plot.current_state.current_time);
            if (currentIdx >= 0 && currentIdx < timeOrder.length - 1) {
                plot.current_state.current_time = timeOrder[currentIdx + 1];
            }
        }

        await plot.save();
    } catch (error) {
        console.error('Error updating current state:', error);
    }
};

/**
 * Streaming interpretation - yields text chunks as they come.
 * Used for askGM input type via the /api/input/stream endpoint.
 */
const interpretStream = async function* (input, inputType, plotId) {
    const startTime = Date.now();
    try {
        // Get recent messages for context
        let recentMessages = [];
        try {
            recentMessages = await getRecentMessages(plotId, 20);
        } catch (e) {
            console.log('No recent messages found, starting fresh');
        }
        console.log(`[TIMING] getRecentMessages: ${Date.now() - startTime}ms`);

        // Get plot with populated location data
        let plot = await Plot.findById(plotId)
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');
        console.log(`[TIMING] Plot.findById with populate: ${Date.now() - startTime}ms`);

        if (!plot) {
            yield "Error: Plot not found";
            return;
        }

        // Ensure region and settlement are described
        if (plot.current_state?.current_location?.region?._id) {
            const regionId = plot.current_state.current_location.region._id;
            const settlementId = plot.current_state.current_location.settlement?._id;

            // Check if description is needed BEFORE awaiting
            const region = await Region.findById(regionId);
            const needsRegionDesc = !region.described;
            let needsSettlementDesc = false;
            let needsLocations = false;

            if (settlementId) {
                const settlement = await Settlement.findById(settlementId);
                needsSettlementDesc = !settlement.described;
                needsLocations = !settlement.locationsGenerated;
            }

            if (needsRegionDesc || needsSettlementDesc || needsLocations) {
                yield "🗺️ Discovering new lands...";
            }

            await ensureDescription(regionId, settlementId);
            if (needsRegionDesc || needsSettlementDesc) {
                console.log(`[TIMING] ensureDescription (with GPT): ${Date.now() - startTime}ms`);
            }
        }

        // Ensure player has a location within the settlement
        await ensurePlayerLocation(plot);
        // Reload plot to get updated locationName
        plot = await Plot.findById(plotId)
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');

        // Build context
        const historyContext = recentMessages.length > 0
            ? recentMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n')
            : 'No previous history - this is the start of the adventure.';

        const currentState = plot.current_state || {};
        const locationName = currentState.current_location?.settlement?.name
            || currentState.current_location?.region?.name
            || 'Unknown location';
        const locationDesc = currentState.current_location?.description
            || currentState.current_location?.settlement?.description
            || 'No description available';

        const timeOfDay = currentState.current_time || 'day';
        const timeContext = getTimeContext(timeOfDay);

        // Build reputation context
        const reputation = plot.reputation || {};
        let reputationContext = '';
        if (reputation.npcs?.length > 0) {
            const relevantNpcs = reputation.npcs.slice(-5);
            reputationContext += '\nKNOWN NPCS:\n' + relevantNpcs.map(npc =>
                `- ${npc.name} (${npc.disposition}): ${npc.lastInteraction || 'No notable interaction'}`
            ).join('\n');
        }

        const stateContext = `
CURRENT STATE:
- Activity: ${currentState.current_activity || 'exploring'}
- Location: ${locationName}
- Location Details: ${locationDesc}
- Time: ${timeOfDay}
- Time Context: ${timeContext}
- Conditions: ${currentState.environment_conditions || 'Normal'}
- Mood: ${currentState.mood_tone || 'Neutral'}
${reputationContext}

RECENT HISTORY:
${historyContext}
`.trim();

        const tone = plot.settings?.tone || 'classic';
        const difficulty = plot.settings?.difficulty || 'casual';

        // Get rich location context
        const locationContext = await buildLocationContext(plot);

        // Check for movement intent in actions
        if (inputType === 'action') {
            const movementIntent = movementService.parseMovementIntent(input);
            if (movementIntent) {
                // Check if this is a valid move
                const canMove = await movementService.canMoveTo(plotId, movementIntent);
                if (canMove.valid) {
                    // Execute the move and yield narration
                    const moveResult = await movementService.moveToLocation(plotId, movementIntent);
                    if (moveResult.success) {
                        yield moveResult.narration;

                        // Update state after movement
                        const updatedPlot = await Plot.findById(plotId);
                        if (updatedPlot.current_state.current_activity === 'resting') {
                            updatedPlot.current_state.current_activity = 'exploring';
                            await updatedPlot.save();
                        }

                        return; // Movement handled, don't continue to AI
                    }
                }
                // If move failed or target not found, continue to AI for narrative exploration
            }
        }

        // Check for exploration intent (look around, examine surroundings, etc.)
        const explorationPatterns = [
            /^(?:i\s+)?(?:look|survey|examine|scout|search|explore)\s+(?:around|the area|this place|surroundings?|the room|here)/i,
            /^(?:i\s+)?(?:take|have)\s+(?:a\s+)?look\s+around/i,
            /^what(?:'s| is)\s+(?:around|here|in this (?:room|place|area))/i,
        ];
        const isExploring = inputType === 'action' && explorationPatterns.some(p => p.test(input));

        // If exploring, add hint about undiscovered connections
        let explorationHint = '';
        if (isExploring) {
            const settlement = plot.current_state.current_location.settlement;
            const currentLoc = settlement?.locations?.find(l =>
                l.name.toLowerCase() === plot.current_state.current_location.locationName?.toLowerCase()
            );

            if (currentLoc?.connections?.length > 0) {
                const undiscoveredConns = currentLoc.connections.filter(c => {
                    const targetLoc = settlement.locations?.find(l =>
                        l.name.toLowerCase() === c.locationName?.toLowerCase()
                    );
                    return !targetLoc?.discovered;
                });

                if (undiscoveredConns.length > 0) {
                    explorationHint = `\n\nHINT FOR AI: The player is exploring. Mention these unexplored exits naturally: ${undiscoveredConns.map(c => `${c.direction}: ${c.locationName}`).join(', ')}. Mark any new discovery clearly.`;
                }
            }
        }

        // Build the streaming prompt (pure narrative, no structured data needed)
        let streamMessage;
        if (inputType === 'action') {
            streamMessage = `
${stateContext}
${locationContext}

PLAYER ACTION: "${input}"

Describe what happens. Be CONCISE (2-3 sentences max). Focus on the immediate result of THIS action.

VARIETY RULES (MANDATORY):
- NEVER repeat descriptions from the recent history above
- If you mentioned smoke, shadows, lamp light, or any sensory detail before — DON'T mention it again
- Start your response differently than the previous AI responses
- Focus on what's NEW and what CHANGED
- Skip atmosphere that's already established — get to the action
${explorationHint}
`.trim();
        } else if (inputType === 'speak') {
            streamMessage = `
${stateContext}

PLAYER SAYS: "${input}"

Write the NPC's response. Be CONCISE (2-3 sentences max).

VARIETY RULES (MANDATORY):
- NEVER use the same mannerisms twice (no repeating "snorts", "grunts", "mutters")
- Check the recent history — if the NPC did something before, do something DIFFERENT now
- NPCs can just SPEAK without constant physical descriptions
- Skip environmental details already established
- Dialogue can be terse — real people don't explain everything
`.trim();
        } else {
            streamMessage = `
${stateContext}

PLAYER ASKS (out of character): "${input}"

Provide helpful GM info. Be CONCISE (2-3 sentences). Focus on what's useful to know.
`.trim();
        }

        // Stream the response (no buffering - instant streaming)
        const stream = streamPrompt(GAME_MODEL, streamMessage, { tone, difficulty });
        let fullResponse = '';

        for await (const chunk of stream) {
            fullResponse += chunk;
            yield chunk; // Stream everything immediately
        }

        // Update state after stream finishes
        if (inputType === 'action' || inputType === 'speak') {
            await updateCurrentState(plot, input, {
                outcome: fullResponse,
                stateChangeRequired: true,
                consequence_level: 'minor' // Default for streaming
            });

            // Async discovery parsing - extract NPCs, objects, locations from AI response
            // This runs in background, doesn't block the response
            if (discoveryService.likelyHasDiscoveries(fullResponse)) {
                discoveryService.parseDiscoveries(plotId, fullResponse, input)
                    .catch(err => console.error('[Discovery] Background parse failed:', err));
            }
        }

    } catch (error) {
        console.error('Error in interpretStream:', error);
        yield `Error: ${error.message}`;
    }
};

module.exports = { interpretStream };
