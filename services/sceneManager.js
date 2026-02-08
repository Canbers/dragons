/**
 * sceneManager.js - Scene data fetching, first-impression generation, grid creation.
 * Extracted from gameAgent.js (executeGetScene, generateFirstImpression, getTypeSpecificParamsPrompt).
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');
const Poi = require('../db/models/Poi');
const { simplePrompt, UTILITY_MODEL } = require('./gptService');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const sceneGridService = require('./sceneGridService');
const { getCurrentLocation } = require('./locationResolver');

/**
 * Helper: prompt additions for type-specific gridParams
 */
function getTypeSpecificParamsPrompt(locationType) {
    return `gridParams fields: "condition" (pristine|well-kept|worn|dilapidated|ruined), "wealth" (poor|modest|comfortable|wealthy|opulent), "clutter" (minimal|moderate|cluttered|packed), "lighting" (bright|well-lit|dim|dark)`;
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

        return { gridParams: parsed.gridParams || null };

    } catch (e) {
        console.error(`[FirstImpression] Failed for ${location.name}:`, e.message);
        return { gridParams: null };
    }
}

/**
 * Get full scene data for the player's current location.
 * Handles first-impression generation and grid creation for new locations.
 */
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

    const { location: currentLoc } = getCurrentLocation(plot, settlement);

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

            const occupied = new Set();
            for (const [, pos] of poiPositions) occupied.add(`${pos.x},${pos.y}`);
            occupied.add(`${playerStart.x},${playerStart.y}`);

            const popLevel = currentLoc.populationLevel || 'populated';
            const ambientNpcs = sceneGridService.generateAmbientNpcs(grid, popLevel, occupied);

            currentLoc.interiorGrid = grid;
            currentLoc.gridParams = gridParams;
            currentLoc.gridGenerated = true;
            currentLoc.ambientNpcs = ambientNpcs;
            await settlement.save();

            for (const [poiId, pos] of poiPositions) {
                await Poi.findByIdAndUpdate(poiId, { gridPosition: pos });
            }

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

module.exports = { executeGetScene, generateFirstImpression };
