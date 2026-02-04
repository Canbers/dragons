const Settlement = require('../../../db/models/Settlement');
const { uuid } = require('uuidv4');
const gpt = require('../../../services/gptService');

const buffer = 5;

const create = (region, count = 1) => {
    return new Promise(async (resolve, reject) => {
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

        let commitedSettlments = await Settlement.insertMany(settlements);
        resolve(commitedSettlments);
    });
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

    const getTile = (x, y) => (map && map[y] && map[x]) ? map[y][x] : null;

    coordinates.forEach(([x, y]) => {
        terrainTypes.push(getTile(x, y));
    });

    // Filter out null values and get unique terrain types
    const uniqueTerrainTypes = Array.from(new Set(terrainTypes.filter(Boolean)));

    return uniqueTerrainTypes.join(', ') || null;
};

const nameAndDescription = (settlement_id) => {
    return new Promise(async (resolve, reject) => {
        let settlement = await Settlement.findOne({ _id: settlement_id }).populate({ path: 'region', populate: { path: 'world' } }).exec();
        const terrainTypes = getTerrainTypes(settlement.region, settlement.coordinates);
        console.log("Prompting GPT for Settlement description...");

        let promptResult = await gpt.prompt('gpt-5-mini', `Create a ${settlement.size} settlement for an "Indifferent World" RPG.

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
        
        resolve(promptResult);
    });
};

// Settlments MUST be an array. If you only want to describe
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
    
    const prompt = `Generate internal locations for "${settlement.name}", a ${settlement.size} settlement.

SETTLEMENT: ${settlement.description || 'A settlement in ' + settlement.region?.name}

Generate ${min}-${max} KEY LOCATIONS that define this settlement. These are the major areas a visitor would know about.

REQUIRED LOCATIONS:
- At least one ENTRY POINT (gate, docks, road entrance)
- At least one PUBLIC GATHERING place (market, plaza, tavern)
- At least one NOTABLE landmark or building

Each location should:
- Have a distinctive, memorable name (not generic like "The Market")
- Feel connected to the settlement's character and tensions
- Suggest what activities happen there

Return JSON array:
[
  {
    "name": "The Soot Gate",
    "type": "gate",
    "shortDescription": "Main entrance, always guarded, travelers searched",
    "description": "The eastern gate of the settlement, where guards inspect all incoming travelers. Soot from nearby forges permanently stains the stone archway.",
    "connections": [
      { "locationName": "Marketway", "direction": "west", "description": "through the gate into town" }
    ],
    "isStartingLocation": true
  },
  ...more locations
]

LOCATION TYPES: gate, market, tavern, temple, plaza, shop, residence, landmark, dungeon, district, docks, barracks, palace, other

Make connections logical - gates connect to main streets, taverns near markets, temples in prominent positions.`;

    let retries = 5;
    while (retries > 0) {
        try {
            const result = await gpt.prompt('gpt-5-mini', prompt);
            const locations = JSON.parse(result.content);
            
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
                    direction: conn.direction || 'nearby',
                    description: conn.description || '',
                    distance: conn.distance || 'adjacent'
                })),
                pois: [],
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
            
            // Save to settlement
            settlement.locations = processedLocations;
            settlement.locationsGenerated = true;
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
                        pois: [],
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
    
    const newLocation = {
        name: locationData.name,
        type: locationData.type || 'other',
        description: locationData.description || '',
        shortDescription: locationData.shortDescription || '',
        coordinates: {
            x: settlement.locations.length % 4,
            y: Math.floor(settlement.locations.length / 4)
        },
        connections: locationData.connections || [],
        pois: [],
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
 * Add or update a POI at a location
 */
const addPoi = async (settlementId, locationName, poiData) => {
    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return null;
    
    const location = settlement.locations.find(l => 
        l.name.toLowerCase() === locationName.toLowerCase()
    );
    if (!location) return null;
    
    // Check if POI already exists
    const existingPoi = location.pois.find(p => 
        p.name.toLowerCase() === poiData.name.toLowerCase()
    );
    
    if (existingPoi) {
        // Update existing POI
        Object.assign(existingPoi, {
            ...poiData,
            interactionCount: (existingPoi.interactionCount || 0) + 1,
            discovered: true
        });
    } else {
        // Add new POI
        location.pois.push({
            name: poiData.name,
            type: poiData.type || 'other',
            description: poiData.description || '',
            icon: poiData.icon || '',
            persistent: poiData.persistent !== false,  // Default true
            discovered: true,
            interactionCount: 1,
            metadata: poiData.metadata || {}
        });
    }
    
    await settlement.save();
    console.log(`[POI] Added/updated: ${poiData.name} at ${locationName}`);
    return location.pois.find(p => p.name.toLowerCase() === poiData.name.toLowerCase());
};

module.exports = { 
    create, 
    describe, 
    generateLocations, 
    ensureLocations,
    discoverLocation,
    addLocation,
    addPoi
};