/**
 * discoveryService.js - Parses AI responses for discoveries
 * 
 * When AI mentions new NPCs, objects, or locations, this service
 * extracts them and persists them to the database.
 * 
 * This runs asynchronously after AI responses complete.
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const { simplePrompt } = require('./gptService');
const { sanitizeDirection } = require('./layoutService');

/**
 * Parse an AI response for discoveries (NPCs, objects, locations)
 * This should be called asynchronously after AI response completes
 * 
 * @param {string} plotId - The plot ID
 * @param {string} aiResponse - The AI's narrative response
 * @param {string} playerAction - What the player did (for context)
 */
async function parseDiscoveries(plotId, aiResponse, playerAction = '') {
    try {
        const plot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');
        
        if (!plot) {
            console.log('[Discovery] Plot not found');
            return null;
        }
        
        const settlement = plot.current_state.current_location.settlement;
        if (!settlement) {
            console.log('[Discovery] Not in a settlement, skipping');
            return null;
        }
        
        const currentLocationName = plot.current_state.current_location.locationName;
        if (!currentLocationName) {
            console.log('[Discovery] No current location, skipping');
            return null;
        }
        
        // Use a lightweight AI call to extract structured discoveries
        const extractPrompt = `Analyze this game narrative and extract any NEW elements introduced.

PLAYER ACTION: "${playerAction}"
AI RESPONSE: "${aiResponse}"

Extract ONLY things that are NEWLY INTRODUCED in the AI response (not things already mentioned by the player).

Look for:
1. NAMED NPCs (characters with actual names, not generic "a guard")
2. NOTABLE OBJECTS (specific items that seem important)
3. NEW LOCATIONS mentioned (exits, doors leading somewhere new)

Return JSON (empty arrays if nothing new):
{
    "npcs": [
        { "name": "Grimjaw", "description": "grizzled barkeep with a scar" }
    ],
    "objects": [
        { "name": "Notice Board", "description": "covered in faded papers" }
    ],
    "locations": [
        { "name": "The Cellar", "direction": "down", "description": "stairs behind the bar" }
    ]
}

IMPORTANT: Only include things with PROPER NAMES. Skip generic descriptions like "a man" or "some chairs".`;

        const systemPrompt = 'You extract structured game data from narrative text. Return valid JSON only.';
        
        const result = await simplePrompt('gpt-5-mini', systemPrompt, extractPrompt);
        let discoveries;
        
        try {
            discoveries = JSON.parse(result.content);
        } catch (e) {
            console.log('[Discovery] Failed to parse extraction result');
            return null;
        }
        
        const applied = {
            npcs: [],
            objects: [],
            locations: []
        };
        
        // Apply NPC discoveries as POIs
        if (discoveries.npcs?.length > 0) {
            for (const npc of discoveries.npcs) {
                if (!npc.name) continue;
                
                const poi = await settlementsFactory.addPoi(
                    settlement._id,
                    currentLocationName,
                    {
                        name: npc.name,
                        type: 'npc',
                        description: npc.description || '',
                        persistent: true
                    }
                );
                
                if (poi) {
                    applied.npcs.push(npc.name);
                    console.log(`[Discovery] Added NPC: ${npc.name}`);
                }
            }
        }
        
        // Apply object discoveries as POIs
        if (discoveries.objects?.length > 0) {
            for (const obj of discoveries.objects) {
                if (!obj.name) continue;
                
                const poi = await settlementsFactory.addPoi(
                    settlement._id,
                    currentLocationName,
                    {
                        name: obj.name,
                        type: 'object',
                        description: obj.description || '',
                        persistent: true
                    }
                );
                
                if (poi) {
                    applied.objects.push(obj.name);
                    console.log(`[Discovery] Added object: ${obj.name}`);
                }
            }
        }
        
        // Apply location discoveries as new connections
        if (discoveries.locations?.length > 0) {
            const location = settlement.locations?.find(l => 
                l.name.toLowerCase() === currentLocationName.toLowerCase()
            );
            
            if (location) {
                for (const newLoc of discoveries.locations) {
                    if (!newLoc.name) continue;
                    
                    // Check if connection already exists
                    const existingConn = location.connections?.find(c =>
                        c.locationName?.toLowerCase() === newLoc.name.toLowerCase()
                    );
                    
                    if (!existingConn) {
                        location.connections = location.connections || [];
                        location.connections.push({
                            locationName: newLoc.name,
                            direction: sanitizeDirection(newLoc.direction),
                            description: newLoc.description || ''
                        });
                        
                        applied.locations.push(newLoc.name);
                        console.log(`[Discovery] Added connection: ${newLoc.name}`);
                    }
                }
                
                if (applied.locations.length > 0) {
                    await settlement.save();
                }
            }
        }
        
        const totalDiscoveries = applied.npcs.length + applied.objects.length + applied.locations.length;
        if (totalDiscoveries > 0) {
            console.log(`[Discovery] Total: ${totalDiscoveries} new elements added`);
        }
        
        return applied;
        
    } catch (error) {
        console.error('[Discovery] Error parsing discoveries:', error);
        return null;
    }
}

/**
 * Quick check if response likely contains discoveries
 * (Avoid expensive AI call if response is too short or generic)
 */
function likelyHasDiscoveries(aiResponse) {
    if (!aiResponse || aiResponse.length < 50) {
        return false;
    }
    
    // Look for patterns that suggest named entities
    const patterns = [
        /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b(?:\s+(?:the|a|an)\s+\w+)?/g, // Capitalized names
        /introduces?\s+(?:you\s+to\s+)?/i, // "introduces you to"
        /(?:named?|called)\s+/i, // "named X" or "called X"
        /notice(?:s)?\s+a?\s*/i, // "you notice"
        /spot(?:s)?\s+a?\s*/i, // "you spot"
        /see(?:s)?\s+a?\s*/i, // "you see"
        /door|entrance|exit|stairs|passage/i, // Location indicators
    ];
    
    return patterns.some(p => p.test(aiResponse));
}

module.exports = {
    parseDiscoveries,
    likelyHasDiscoveries
};
