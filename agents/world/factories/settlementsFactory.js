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

module.exports = { create, describe };