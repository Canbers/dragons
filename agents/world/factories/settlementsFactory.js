const Settlement = require('../../../db/models/Settlement');
const Poi = require('../../../db/models/Poi');
const { uuid } = require('uuidv4');
const gpt = require('../../../services/gptService');
const layoutService = require('../../../services/layoutService');

const buffer = 5;

const create = async (region, count = 1) => {
    const settlements = [];

    for (let i = 0; i < count; i++) {
        const size = getRandomSize();
        const baseCoordinates = generateUniqueCoordinates(settlements);
        const allCoordinates = generateAllCoordinates(baseCoordinates, size);

        settlements.push({
            name: uuid(),
            region: region._id,
            size: size,
            coordinates: allCoordinates,
        });
    }

    return await Settlement.insertMany(settlements);
};

const getRandomSize = () => {
    const sizes = ['small', 'medium', 'large'];
    const randomIndex = Math.floor(Math.random() * sizes.length);
    return sizes[randomIndex];
};

const generateUniqueCoordinates = (settlements) => {
    const gridSize = 25;
    let coordinates;

    do {
        const x = getRandomInt(buffer, gridSize - buffer - 1);
        const y = getRandomInt(buffer, gridSize - buffer - 1);
        coordinates = [x, y];
    } while (
        settlements.some(
            (s) =>
                s.coordinates.some(c =>
                    c[0] >= coordinates[0] - buffer &&
                    c[0] <= coordinates[0] + buffer &&
                    c[1] >= coordinates[1] - buffer &&
                    c[1] <= coordinates[1] + buffer
                )
        )
    );

    return coordinates;
};

const generateAllCoordinates = (baseCoordinates, size) => {
    const [x, y] = baseCoordinates;
    let coordinates = [];

    switch (size) {
        case 'medium':
            // 2x2 area
            coordinates = [
                [x, y],
                [x + 1, y],
                [x, y + 1],
                [x + 1, y + 1],
            ];
            break;
        case 'large':
            // 3x3 area
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    coordinates.push([x + i, y + j]);
                }
            }
            break;
        default:
            // 'small' or any other case, single tile
            coordinates = [[x, y]];
    }

    return coordinates;
};

const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getTerrainTypes = (region, coordinates) => {
    const { map } = region;
    let terrainTypes = [];

    const getTile = (x, y) => (map && map[y] && map[y][x] !== undefined) ? map[y][x] : null;

    coordinates.forEach(([x, y]) => {
        terrainTypes.push(getTile(x, y));
    });

    // Filter out null values and get unique terrain types
    const uniqueTerrainTypes = Array.from(new Set(terrainTypes.filter(Boolean)));

    return uniqueTerrainTypes.join(', ') || null;
};

const nameAndDescription = async (settlement_id) => {
    let settlement = await Settlement.findOne({ _id: settlement_id }).populate({ path: 'region', populate: { path: 'world' } }).exec();
    const terrainTypes = getTerrainTypes(settlement.region, settlement.coordinates);
    console.log("Prompting GPT for Settlement description...");

    return await gpt.prompt('gpt-5-mini', `Create a ${settlement.size} settlement for an "Indifferent World" RPG.

World: ${settlement.region.world.name} - ${settlement.region.world.description}
Region: ${settlement.region.name}
Terrain: ${terrainTypes || 'varied'}

Design a settlement that:
- Has its own problems and daily concerns (not waiting for a hero)
- Contains factions or individuals with competing interests
- Has both opportunities and dangers for visitors
- Feels lived-in with distinct character
- Has a name that fits the world (NOT "${settlement.region.name}")

Include:
- What the settlement is known for (trade, craft, problem, reputation)
- Who holds power and who resents it
- What visitors should know (customs, dangers, opportunities)
- A current tension or issue simmering beneath the surface

Format as JSON:
{
  "name": "<Distinctive settlement name>",
  "description": "<Two paragraphs: first about the place itself, second about the people and current tensions>",
  "short": "<Two sentences capturing what makes this place memorable>"
}`);
};

// Settlements MUST be an array. If you only want to describe
// a single settlement then just use an array of one.
const describe = async (settlements) => {
    if (!Array.isArray(settlements)) {
        throw new Error('Describe only takes arrays');
    }
    
    console.log(`[PARALLEL] Describing ${settlements.length} settlements in parallel...`);
    
    // OPTIMIZATION: Process all settlements in parallel instead of sequential
    const describePromises = settlements.map(async (settlementId) => {
        let retries = 10;
        while (retries > 0) {
            try {
                let details = await nameAndDescription(settlementId);
                console.log(`[PARALLEL] Parsing settlement ${settlementId} details...`);
                let p = JSON.parse(details.content);
                
                await Settlement.findByIdAndUpdate(settlementId, {
                    described: true,
                    ...p
                });
                
                console.log(`[PARALLEL] ✓ Settlement ${settlementId} described`);
                return; // Success, exit retry loop
            } catch (e) {
                retries--;
                if (retries === 0) {
                    console.error(`[PARALLEL] ✗ Failed to describe settlement ${settlementId} after 10 retries:`, e.message);
                }
            }
        }
    });
    
    // Wait for all settlements to complete (or fail)
    await Promise.all(describePromises);
    console.log(`[PARALLEL] All ${settlements.length} settlements processed`);
};

/**
 * Generate high-level internal locations for a settlement
 * Called when player first enters a settlement
 */
const generateLocations = async (settlementId) => {
    const settlement = await Settlement.findById(settlementId)
        .populate({ path: 'region', populate: { path: 'world' } });
    
    if (!settlement) {
        throw new Error(`Settlement ${settlementId} not found`);
    }
    
    // Already generated
    if (settlement.locationsGenerated && settlement.locations?.length > 0) {
        console.log(`[Locations] Settlement ${settlement.name} already has locations`);
        return settlement.locations;
    }
    
    console.log(`[Locations] Generating locations for ${settlement.name} (${settlement.size})...`);
    
    // Determine number of locations based on settlement size
    const locationCounts = {
        'small': { min: 3, max: 5 },
        'medium': { min: 5, max: 8 },
        'large': { min: 8, max: 12 }
    };
    const { min, max } = locationCounts[settlement.size] || locationCounts.small;
    
    const prompt = `Generate ${min}-${max} locations for the settlement "${settlement.name}".

Settlement info: ${settlement.short || settlement.description?.substring(0, 200) || 'A settlement'}

Requirements:
- Include one entry point (gate/docks/road) marked isStartingLocation: true
- Include one tavern or market
- Each location needs a name, type, and brief description
- Add connections between locations with VARIED compass directions
- Connections should form a natural settlement layout, NOT a straight line
- Use a mix of: north, south, east, west, northeast, northwest, southeast, southwest
- Most locations should connect to 2-3 others, creating a web not a chain
- Connections are bidirectional: if A connects east to B, B should connect west to A
- IMPORTANT: direction MUST be exactly one of these values (no variations, no hyphens, no extra words):
  north, south, east, west, northeast, northwest, southeast, southwest, up, down, inside, outside

Respond with a JSON object containing a "locations" array:

{
  "locations": [
    {
      "name": "The Cinder Gate",
      "type": "gate",
      "shortDescription": "Main entrance, heavy oak doors",
      "description": "The main gate into town, flanked by weathered stone towers.",
      "connections": [
        {"locationName": "Market Square", "direction": "northwest", "distance": "adjacent"},
        {"locationName": "Guard Barracks", "direction": "west", "distance": "adjacent"}
      ],
      "isStartingLocation": true
    },
    {
      "name": "Market Square",
      "type": "market",
      "shortDescription": "Bustling trading hub",
      "description": "A wide cobblestone plaza ringed with merchant stalls.",
      "connections": [
        {"locationName": "The Cinder Gate", "direction": "southeast", "distance": "adjacent"},
        {"locationName": "The Rusty Flagon", "direction": "north", "distance": "adjacent"},
        {"locationName": "Temple of the Dawn", "direction": "west", "distance": "close"}
      ]
    }
  ]
}

Types: gate, market, tavern, temple, plaza, shop, residence, landmark, dungeon, district, docks, barracks, palace, other
Distances: adjacent (nearby), close (short walk), far (across settlement)`;

    let retries = 5;
    while (retries > 0) {
        try {
            const systemPrompt = 'You are a world-building assistant. Generate location data as JSON.';
            const result = await gpt.simplePrompt('gpt-5-mini', systemPrompt, prompt);
            
            console.log(`[Locations] Raw AI response (first 300 chars): ${result.content?.substring(0, 300)}`);
            
            // Try to extract JSON from markdown code blocks if present
            let jsonContent = result.content;
            const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonContent = jsonMatch[1].trim();
            }
            
            // Parse JSON
            const parsed = JSON.parse(jsonContent);
            
            // Extract locations array from object or use directly if array
            let locations;
            if (Array.isArray(parsed)) {
                locations = parsed;
            } else if (parsed.locations && Array.isArray(parsed.locations)) {
                locations = parsed.locations;
            } else {
                // Look for any array property
                const arrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
                if (arrayKey) {
                    locations = parsed[arrayKey];
                } else {
                    throw new Error('No locations array found in response');
                }
            }
            
            if (!locations || locations.length === 0) {
                throw new Error('Empty locations array');
            }
            
            // Validate and enhance locations
            const processedLocations = locations.map((loc, index) => ({
                name: loc.name,
                type: loc.type || 'other',
                description: loc.description || '',
                shortDescription: loc.shortDescription || '',
                coordinates: {
                    x: index % 4,  // Simple grid layout
                    y: Math.floor(index / 4)
                },
                connections: (loc.connections || []).map(conn => ({
                    locationName: conn.locationName,
                    direction: layoutService.sanitizeDirection(conn.direction),
                    description: conn.description || '',
                    distance: conn.distance || 'adjacent'
                })),
                discovered: loc.isStartingLocation || false,
                generated: true,
                isStartingLocation: loc.isStartingLocation || false
            }));
            
            // Ensure at least one starting location
            const hasStart = processedLocations.some(l => l.isStartingLocation);
            if (!hasStart && processedLocations.length > 0) {
                const gateOrFirst = processedLocations.find(l => l.type === 'gate') || processedLocations[0];
                gateOrFirst.isStartingLocation = true;
                gateOrFirst.discovered = true;
            }

            // Compute spatial layout from connection graph
            const layoutPositions = layoutService.computeLayout(processedLocations);
            for (const loc of processedLocations) {
                const pos = layoutPositions.get(loc.name.toLowerCase());
                if (pos) {
                    loc.coordinates = { x: pos.x, y: pos.y };
                }
            }

            // Save to settlement
            settlement.locations = processedLocations;
            settlement.locationsGenerated = true;
            settlement.layoutComputed = true;
            await settlement.save();
            
            console.log(`[Locations] ✓ Generated ${processedLocations.length} locations for ${settlement.name}`);
            return processedLocations;
            
        } catch (e) {
            retries--;
            console.error(`[Locations] Retry ${5 - retries}/5 for ${settlement.name}:`, e.message);
            if (retries === 0) {
                console.error(`[Locations] ✗ Failed to generate locations for ${settlement.name}`);
                // Return minimal default locations
                const defaultLocations = [
                    {
                        name: 'Settlement Entrance',
                        type: 'gate',
                        description: 'The main way into the settlement.',
                        shortDescription: 'Main entrance',
                        coordinates: { x: 0, y: 0 },
                        connections: [],
                        discovered: true,
                        generated: false,
                        isStartingLocation: true
                    }
                ];
                settlement.locations = defaultLocations;
                settlement.locationsGenerated = true;
                await settlement.save();
                return defaultLocations;
            }
        }
    }
};

/**
 * Ensure a settlement has its locations generated
 * Returns the starting location name
 */
const ensureLocations = async (settlementId) => {
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
        return null;
    }
    
    if (!settlement.locationsGenerated || !settlement.locations?.length) {
        await generateLocations(settlementId);
        // Reload after generation
        const updated = await Settlement.findById(settlementId);
        const startLoc = updated.locations.find(l => l.isStartingLocation) || updated.locations[0];
        return startLoc?.name || null;
    }
    
    const startLoc = settlement.locations.find(l => l.isStartingLocation) || settlement.locations[0];
    return startLoc?.name || null;
};

/**
 * Mark a location as discovered when player visits it
 */
const discoverLocation = async (settlementId, locationName) => {
    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return false;
    
    const location = settlement.locations.find(l => 
        l.name.toLowerCase() === locationName.toLowerCase()
    );
    
    if (location && !location.discovered) {
        location.discovered = true;
        await settlement.save();
        console.log(`[Locations] Discovered: ${locationName} in ${settlement.name}`);
        return true;
    }
    return false;
};

/**
 * Add a new location to a settlement (discovered during play)
 */
const addLocation = async (settlementId, locationData) => {
    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return null;
    
    // Check if location already exists
    const existing = settlement.locations.find(l => 
        l.name.toLowerCase() === locationData.name.toLowerCase()
    );
    if (existing) {
        return existing;
    }
    
    // Compute position from connection graph instead of grid index
    const computedPos = layoutService.computeSingleNodePosition(settlement.locations, locationData);

    const newLocation = {
        name: locationData.name,
        type: locationData.type || 'other',
        description: locationData.description || '',
        shortDescription: locationData.shortDescription || '',
        coordinates: {
            x: computedPos.x,
            y: computedPos.y
        },
        connections: locationData.connections || [],
        discovered: true,  // If AI mentioned it, player knows about it
        generated: true,
        isStartingLocation: false
    };
    
    settlement.locations.push(newLocation);
    await settlement.save();
    
    console.log(`[Locations] Added new location: ${newLocation.name} to ${settlement.name}`);
    return newLocation;
};

/**
 * Add or update a POI at a location (standalone Poi collection)
 */
const addPoi = async (settlementId, locationName, poiData) => {
    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return null;

    const location = settlement.locations.find(l =>
        l.name.toLowerCase() === locationName.toLowerCase()
    );
    if (!location) return null;

    // Check for existing POI with same or partial name anywhere in this settlement
    // Handles: exact match, first-name match ("Tess" matches "Tess Farrow"),
    // and full-name match ("Tess Farrow" matches existing "Tess")
    const escapedName = poiData.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameParts = escapedName.split(/\s+/);
    const firstName = nameParts[0];
    const isMultiWord = nameParts.length > 1;

    // Build query: exact match OR first-name-of-existing starts with new name's first word
    const nameQueries = [
        // Exact match (case-insensitive)
        { name: { $regex: new RegExp(`^${escapedName}$`, 'i') } },
        // New name is a first name — match existing full names starting with it
        // e.g. new "Tess" matches existing "Tess Farrow"
        { name: { $regex: new RegExp(`^${firstName}\\s+`, 'i') } },
    ];
    // New name is a full name — match existing entries that are just the first name
    // e.g. new "Tess Farrow" matches existing "Tess"
    if (isMultiWord) {
        nameQueries.push({ name: { $regex: new RegExp(`^${firstName}$`, 'i') } });
    }

    const existing = await Poi.findOne({
        settlement: settlementId,
        $or: nameQueries
    });

    if (existing) {
        // Prefer the longer (more specific) name
        if (poiData.name.length > existing.name.length) {
            console.log(`[POI] Upgrading name: "${existing.name}" → "${poiData.name}"`);
            existing.name = poiData.name;
        }
        // Update existing POI
        if (poiData.description) existing.description = poiData.description;
        if (poiData.disposition && !existing.disposition) existing.disposition = poiData.disposition;
        if (poiData.icon) existing.icon = poiData.icon;
        if (poiData.type) existing.type = poiData.type;
        if (poiData.metadata) existing.metadata = { ...existing.metadata, ...poiData.metadata };
        existing.interactionCount = (existing.interactionCount || 0) + 1;
        existing.discovered = true;
        // If NPC has moved to a new location, update their location
        if (existing.locationId.toString() !== location._id.toString()) {
            console.log(`[POI] ${existing.name} moved from ${existing.locationName} to ${locationName}`);
            existing.locationId = location._id;
            existing.locationName = location.name;
        }
        await existing.save();
        console.log(`[POI] Updated: ${existing.name} at ${locationName}`);
        existing._isNew = false;
        return existing;
    }

    // Create new POI
    const poi = await Poi.create({
        name: poiData.name,
        type: poiData.type || 'other',
        description: poiData.description || '',
        disposition: poiData.disposition || '',
        icon: poiData.icon || '',
        persistent: poiData.persistent !== false,
        discovered: true,
        interactionCount: 1,
        metadata: poiData.metadata || {},
        settlement: settlementId,
        locationId: location._id,
        locationName: location.name,
        autoGenerated: poiData.autoGenerated || false
    });

    console.log(`[POI] Added: ${poiData.name} at ${locationName}`);
    poi._isNew = true;
    return poi;
};

/**
 * Move a POI to a different location within the same settlement
 */
const movePoi = async (poiId, settlementId, newLocationName) => {
    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return null;

    const newLocation = settlement.locations.find(l =>
        l.name.toLowerCase() === newLocationName.toLowerCase()
    );
    if (!newLocation) return null;

    const poi = await Poi.findOneAndUpdate(
        { _id: poiId, settlement: settlementId },
        { locationId: newLocation._id, locationName: newLocation.name },
        { new: true }
    );

    if (poi) {
        console.log(`[POI] Moved: ${poi.name} → ${newLocationName}`);
    }
    return poi;
};

/**
 * Get all POIs at a specific location
 */
const getPoisAtLocation = async (settlementId, locationId, onlyDiscovered = false) => {
    const query = { settlement: settlementId, locationId };
    if (onlyDiscovered) {
        query.discovered = true;
    }
    return await Poi.find(query);
};

module.exports = {
    create,
    describe,
    generateLocations,
    ensureLocations,
    addPoi,
    movePoi,
    getPoisAtLocation
};