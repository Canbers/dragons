const fetch = require('node-fetch');
const http = require('http');
const Plot = require('../db/models/Plot');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement');
const regionFactory = require('../agents/world/factories/regionsFactory');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const { prompt, simplePrompt, streamPrompt, GAME_MODEL } = require('../services/gptService');

// Load environment variables
require('dotenv').config();

// Use HTTP for local development
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

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

const getRecentMessages = async (plotId, limit = 20, cookies) => {
    if (!plotId) {
        throw new Error('plotId is undefined');
    }
    const url = `${API_BASE_URL}/api/game-logs/recent/${plotId}?limit=${limit}`;
    try {
        const response = await fetch(url, { 
            method: 'GET', 
            headers: { 
                'Content-Type': 'application/json',
                'Cookie': cookies 
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.messages;
    } catch (error) {
        console.error(`Error fetching recent messages: ${error.message}`);
        throw error;
    }
};

const ensureDescription = async (regionId, settlementId) => {
    const region = await Region.findById(regionId);
    if (!region.described) {
        await regionFactory.describe(regionId);
    }
    if (settlementId) {
        const settlement = await Settlement.findById(settlementId);
        if (!settlement.described) {
            await regionFactory.describeSettlements(regionId);
        }
        // Ensure settlement has internal locations generated
        if (!settlement.locationsGenerated) {
            await settlementsFactory.ensureLocations(settlementId);
        }
    }
};

/**
 * Ensure settlement locations are generated and player has a starting location
 * Returns the starting location name if plot doesn't have one set
 */
const ensurePlayerLocation = async (plot) => {
    const settlementId = plot.current_state?.current_location?.settlement?._id 
                      || plot.current_state?.current_location?.settlement;
    
    if (!settlementId) return null;
    
    // Ensure locations exist
    const startingLocation = await settlementsFactory.ensureLocations(settlementId);
    
    // If player doesn't have a locationName set, use the starting location
    if (!plot.current_state.current_location.locationName && startingLocation) {
        plot.current_state.current_location.locationName = startingLocation;
        await plot.save();
        return startingLocation;
    }
    
    return plot.current_state.current_location.locationName;
};

/**
 * Main interpretation function - The Indifferent World
 */
const interpret = async (input, inputType, plotId, cookies) => {
    try {
        // Get recent messages for context
        let recentMessages = [];
        try {
            recentMessages = await getRecentMessages(plotId, 20, cookies);
        } catch (e) {
            console.log('No recent messages found, starting fresh');
        }
        
        // Get plot with populated location data
        let plot = await Plot.findById(plotId)
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');

        if (!plot) {
            throw new Error('Plot not found');
        }

        // Ensure region and settlement are described
        if (plot.current_state?.current_location?.region?._id) {
            await ensureDescription(
                plot.current_state.current_location.region._id, 
                plot.current_state.current_location.settlement?._id
            );
        }

        // Build context from recent messages
        const historyContext = recentMessages.length > 0 
            ? recentMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n')
            : 'No previous history - this is the start of the adventure.';

        // Build current state context
        const currentState = plot.current_state || {};
        const locationName = currentState.current_location?.settlement?.name 
            || currentState.current_location?.region?.name 
            || 'Unknown location';
        const locationDesc = currentState.current_location?.description 
            || currentState.current_location?.settlement?.description 
            || 'No description available';

        // Build reputation context
        const reputation = plot.reputation || {};
        let reputationContext = '';
        
        // Add NPC relationships if any
        if (reputation.npcs?.length > 0) {
            const relevantNpcs = reputation.npcs.slice(-5); // Last 5 NPCs
            reputationContext += '\nKNOWN NPCS:\n' + relevantNpcs.map(npc => 
                `- ${npc.name} (${npc.disposition}): ${npc.lastInteraction || 'No notable interaction'}`
            ).join('\n');
        }
        
        // Add faction standings if any
        if (reputation.factions?.length > 0) {
            reputationContext += '\nFACTION STANDINGS:\n' + reputation.factions.map(f => 
                `- ${f.name}: ${f.standing > 50 ? 'Friendly' : f.standing < -50 ? 'Hostile' : 'Neutral'} (${f.reason || 'No specific reason'})`
            ).join('\n');
        }
        
        // Add location reputation if relevant
        const locationRep = reputation.locations?.find(l => l.name === locationName);
        if (locationRep) {
            reputationContext += `\nYOUR REPUTATION HERE: ${locationRep.reputation} - ${locationRep.knownFor || 'Nothing notable'}`;
        }

        // Time-of-day awareness
        const timeOfDay = currentState.current_time || 'day';
        const timeContext = getTimeContext(timeOfDay);

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

        // Get player settings (defaults for now, will be configurable)
        const tone = plot.settings?.tone || 'classic';
        const difficulty = plot.settings?.difficulty || 'casual';

        let response;
        switch (inputType) {
            case 'action':
                response = await handleAction(input, stateContext, { tone, difficulty });
                break;
            case 'speak':
                response = await handleSpeak(input, stateContext, { tone, difficulty }, plotId);
                break;
            case 'askGM':
                response = await handleAskGM(input, stateContext);
                break;
            default:
                response = { outcome: "I don't understand that type of input.", stateChangeRequired: false };
        }
        
        // Random event chance (10% chance after each action)
        if (Math.random() < 0.10 && inputType === 'action') {
            const randomEvent = await generateRandomEvent(stateContext, { tone, difficulty });
            if (randomEvent) {
                response.outcome += `\n\n${randomEvent.event}`;
                response.stateChangeRequired = response.stateChangeRequired || randomEvent.stateChangeRequired;
            }
        }

        // Update state if needed
        if (response.stateChangeRequired) {
            await updateCurrentState(plot, input, response);
        }

        return { message: response };
    } catch (error) {
        console.error('Error handling input:', error);
        return { message: { outcome: "The world shifts strangely... something went wrong.", error: error.message } };
    }
};

/**
 * Handle action input - The player DOES something
 */
const handleAction = async (input, context, options = {}) => {
    const message = `
${context}

PLAYER ACTION: "${input}"

Simulate what happens when the player attempts this action. Remember:
- React to what they ACTUALLY said, not what they probably meant
- The world responds logically, not helpfully
- NPCs have their own motivations
- Consequences are real - success is not guaranteed
- Include sensory details that ground the scene

If the action is:
- REASONABLE: Show it happening with realistic results (which may include complications)
- RISKY: Show the attempt and its consequences
- STUPID: Show the natural consequences (the world doesn't protect fools)
- IMPOSSIBLE: The attempt fails in a logical way

Respond in JSON:
{
    "success": boolean,
    "outcome": "Vivid description of what happens (2-4 sentences). Focus on what the player experiences.",
    "stateChangeRequired": boolean (true if location, activity, time, or conditions changed significantly),
    "consequence_level": "none|minor|significant|major|catastrophic",
    "world_state": "Brief note on any changes to the environment or NPC attitudes"
}
`.trim();

    try {
        const response = await prompt(GAME_MODEL, message, options);
        return JSON.parse(response.content);
    } catch (error) {
        console.error('Error in handleAction:', error);
        return { 
            success: false, 
            outcome: "Your action falters as reality seems to blur for a moment.", 
            stateChangeRequired: false,
            consequence_level: "none"
        };
    }
};

/**
 * Handle speak input - The player SAYS something
 */
const handleSpeak = async (input, context, options = {}, plotId = null) => {
    const message = `
${context}

PLAYER SAYS: "${input}"

An NPC (or NPCs) present respond to what the player said. Remember:
- NPCs have their own personalities, goals, and moods
- They do NOT exist to help the player
- They respond based on what was ACTUALLY said
- They can be helpful, indifferent, suspicious, hostile, or confused
- They don't automatically trust strangers or believe obvious lies

Consider:
- Who is present and what are their motivations?
- How would they realistically react to this statement?
- What is their body language and tone?

Respond in JSON:
{
    "response": "The NPC's dialogue and reaction (2-4 sentences). Include their tone and any notable body language.",
    "npc_name": "Name of the primary NPC responding (create a name if needed)",
    "npc_attitude_change": "none|warmer|colder|suspicious|hostile|amused",
    "new_disposition": "hostile|unfriendly|neutral|friendly|allied (only if changed)",
    "stateChangeRequired": boolean,
    "world_state": "Any changes to the social situation"
}
`.trim();

    try {
        const response = await prompt(GAME_MODEL, message, options);
        const parsed = JSON.parse(response.content);
        
        // Update NPC reputation if we have a plot and the attitude changed
        if (plotId && parsed.npc_name && parsed.npc_attitude_change !== 'none') {
            await updateNpcReputation(plotId, parsed.npc_name, parsed.new_disposition, input);
        }
        
        return {
            success: true,
            outcome: parsed.response,
            stateChangeRequired: parsed.stateChangeRequired || false,
            consequence_level: "none",
            npc_name: parsed.npc_name
        };
    } catch (error) {
        console.error('Error in handleSpeak:', error);
        return { 
            success: true, 
            outcome: "There's an awkward silence. No one seems to respond.", 
            stateChangeRequired: false 
        };
    }
};

/**
 * Update NPC reputation in the plot
 */
const updateNpcReputation = async (plotId, npcName, newDisposition, interaction) => {
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) return;
        
        // Initialize reputation if it doesn't exist
        if (!plot.reputation) {
            plot.reputation = { npcs: [], factions: [], locations: [] };
        }
        if (!plot.reputation.npcs) {
            plot.reputation.npcs = [];
        }
        
        // Find existing NPC or create new entry
        const existingNpc = plot.reputation.npcs.find(n => n.name.toLowerCase() === npcName.toLowerCase());
        
        if (existingNpc) {
            if (newDisposition) {
                existingNpc.disposition = newDisposition;
            }
            existingNpc.lastInteraction = interaction.substring(0, 100); // Keep it brief
        } else {
            plot.reputation.npcs.push({
                name: npcName,
                disposition: newDisposition || 'neutral',
                lastInteraction: interaction.substring(0, 100),
                location: plot.current_state?.current_location?.settlement?.name || 'Unknown'
            });
        }
        
        await plot.save();
        console.log(`Updated reputation for NPC: ${npcName}`);
    } catch (error) {
        console.error('Error updating NPC reputation:', error);
    }
};

/**
 * Handle askGM input - Out of character question
 */
const handleAskGM = async (input, context) => {
    const systemContent = `You are a helpful game master answering an out-of-character question. 
Provide information the player character would reasonably know or observe.
Don't spoil hidden information or tell them what to do.
Be helpful but maintain the mystery of the world.`;

    const message = `
${context}

PLAYER ASKS (out of character): "${input}"

Provide helpful information about:
- What they can see/hear/smell
- General knowledge their character would have
- Options available (without recommending one)
- Consequences they could reasonably anticipate

Respond in JSON:
{
    "response": "Your helpful GM answer (2-4 sentences)",
    "stateChangeRequired": false
}
`.trim();

    try {
        const response = await simplePrompt(GAME_MODEL, systemContent, message);
        const parsed = JSON.parse(response.content);
        return {
            success: true,
            outcome: parsed.response,
            stateChangeRequired: false,
            consequence_level: "none"
        };
    } catch (error) {
        console.error('Error in handleAskGM:', error);
        return { 
            success: true, 
            outcome: "The mysteries of this world remain unclear...", 
            stateChangeRequired: false 
        };
    }
};

/**
 * Generate a random event - the world happening around the player
 */
const generateRandomEvent = async (context, options = {}) => {
    const eventTypes = [
        'environmental', // Weather changes, natural events
        'social', // Someone approaches, commotion nearby
        'discovery', // Notice something interesting
        'rumor', // Overhear conversation
        'danger', // Threat appears
        'opportunity' // Chance for profit or adventure
    ];
    
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    const message = `
${context}

Generate a brief ${eventType} random event that happens in the world around the player.

This is NOT a response to player action - it's the world being alive and dynamic.

Guidelines:
- Keep it brief (1-2 sentences)
- It should be something the player can choose to engage with or ignore
- It should fit the current location and time
- It should feel natural, not forced
- 50% should be minor (atmosphere), 50% should be actionable

Respond in JSON:
{
    "event": "Brief description of what happens or what the player notices",
    "eventType": "${eventType}",
    "actionable": boolean (true if player might want to respond),
    "stateChangeRequired": boolean (true if environment changed)
}
`.trim();

    try {
        const response = await prompt(GAME_MODEL, message, options);
        return JSON.parse(response.content);
    } catch (error) {
        console.error('Error generating random event:', error);
        return null;
    }
};

/**
 * Update the plot's current state based on action results
 */
const updateCurrentState = async (plot, input, result) => {
    try {
        const stateUpdateMessage = `
Based on this action and result, determine any state changes:

Previous State:
- Activity: ${plot.current_state?.current_activity || 'exploring'}
- Time: ${plot.current_state?.current_time || 'Unknown'}
- Conditions: ${plot.current_state?.environment_conditions || 'Normal'}
- Mood: ${plot.current_state?.mood_tone || 'Neutral'}

Action: "${input}"
Result: ${result.outcome}
Consequence Level: ${result.consequence_level || 'minor'}

Respond in JSON:
{
    "activity": "new activity (conversation|exploring|in combat|resting|traveling)",
    "time": "new time of day if changed (dawn|morning|midday|afternoon|evening|night|midnight)",
    "conditions": "new environmental conditions if changed",
    "mood": "new mood/tone if changed",
    "location_description": "updated location description if changed"
}

IMPORTANT:
- If the player is resting or sleeping "until morning" (or similar), advance time to 'morning'.
- If they are resting for a short while, advance time to the next logical step (e.g., evening -> night).
- Only change values that would logically change based on the action.
`.trim();

        const response = await simplePrompt(GAME_MODEL, 
            "You determine game state changes based on player actions and their consequences.", 
            stateUpdateMessage
        );
        
        const stateChanges = JSON.parse(response.content);
        
        // Validate and apply changes
        const allowedActivities = ['conversation', 'exploring', 'in combat', 'resting', 'traveling'];
        
        if (stateChanges.activity && allowedActivities.includes(stateChanges.activity)) {
            plot.current_state.current_activity = stateChanges.activity;
        }
        if (stateChanges.time) {
            plot.current_state.current_time = stateChanges.time;
        }
        if (stateChanges.conditions) {
            plot.current_state.environment_conditions = stateChanges.conditions;
        }
        if (stateChanges.mood) {
            plot.current_state.mood_tone = stateChanges.mood;
        }
        if (stateChanges.location_description && plot.current_state.current_location) {
            plot.current_state.current_location.description = stateChanges.location_description;
        }

        await plot.save();
        console.log("Updated current state:", plot.current_state);
    } catch (error) {
        console.error('Error updating current state:', error);
    }
};

// NOTE: processMapUpdate removed - map data now comes from Settlement.locations
// Discovery parsing will be implemented as async background job

/**
 * Streaming version of interpret - yields text chunks as they come
 */
const interpretStream = async function* (input, inputType, plotId, cookies) {
    const startTime = Date.now();
    try {
        // Get recent messages for context
        let recentMessages = [];
        try {
            recentMessages = await getRecentMessages(plotId, 20, cookies);
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

        // Get current location context from settlement
        const settlement = plot.current_state.current_location.settlement;
        const currentLocationName = plot.current_state.current_location.locationName;
        let locationContext = '';
        
        if (settlement?.locations?.length > 0) {
            const currentLoc = settlement.locations.find(l => 
                l.name.toLowerCase() === currentLocationName?.toLowerCase()
            );
            if (currentLoc) {
                const connections = (currentLoc.connections || [])
                    .map(c => `${c.direction}: ${c.locationName}`)
                    .join(', ');
                const pois = (currentLoc.pois || [])
                    .filter(p => p.discovered)
                    .map(p => p.name)
                    .join(', ');
                locationContext = `
CURRENT LOCATION: ${currentLoc.name}
${currentLoc.description || ''}
- Nearby: ${connections || 'explore to discover'}
- Here: ${pois || 'no notable features yet'}
`.trim();
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
            
            // TODO: Async discovery parsing will go here
            // parseDiscoveries(plotId, fullResponse) - runs in background
        }

    } catch (error) {
        console.error('Error in interpretStream:', error);
        yield `Error: ${error.message}`;
    }
};

module.exports = { 
    interpret, 
    interpretStream,
    handleAction, 
    handleSpeak, 
    handleAskGM,
    updateNpcReputation
};
