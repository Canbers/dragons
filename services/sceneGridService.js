/**
 * sceneGridService.js — Grid generation for location interiors
 *
 * 6 generator categories covering all 14 location types.
 * Generates a 2D tile grid, places furniture/features, then entities.
 */

const ROT = require('rot-js');
const { TILE, WALKABLE_TILES } = require('./tileConstants');

// ============ SIZE TABLES ============

// [minW, maxW, minH, maxH] per settlement size
const SIZE_TABLE = {
    residence:  { small: [12,16,12,16], medium: [15,22,14,20], large: [18,26,16,24] },
    shop:       { small: [14,20,12,18], medium: [18,26,14,22], large: [22,30,18,26] },
    tavern:     { small: [18,26,14,22], medium: [22,32,16,26], large: [26,38,20,32] },
    temple:     { small: [18,28,16,24], medium: [22,34,18,28], large: [28,42,22,34] },
    market:     { small: [22,32,20,28], medium: [28,40,24,34], large: [34,50,28,42] },
    plaza:      { small: [22,32,20,28], medium: [28,40,24,34], large: [34,50,28,42] },
    gate:       { small: [16,24,20,30], medium: [20,30,24,36], large: [24,36,26,42] },
    barracks:   { small: [18,26,14,22], medium: [22,32,18,26], large: [26,38,20,32] },
    palace:     { small: [24,36,20,30], medium: [30,44,24,36], large: [36,52,28,42] },
    docks:      { small: [24,34,16,24], medium: [30,42,18,28], large: [36,50,22,34] },
    dungeon:    { small: [16,24,16,24], medium: [20,32,20,30], large: [26,40,24,36] },
    district:   { small: [26,38,22,32], medium: [32,46,26,40], large: [38,56,30,48] },
    landmark:   { small: [16,26,16,24], medium: [20,32,18,28], large: [26,40,22,34] },
    other:      { small: [14,20,14,20], medium: [18,26,16,24], large: [22,32,20,28] },
};

// Location type → generator category
const CATEGORY_MAP = {
    residence: 'building_interior',
    shop:      'building_interior',
    tavern:    'building_interior',
    palace:    'building_interior',
    market:    'open_space',
    plaza:     'open_space',
    district:  'open_space',
    landmark:  'open_space',
    gate:      'fortification',
    barracks:  'fortification',
    dungeon:   'underground',
    docks:     'waterfront',
    temple:    'religious',
    other:     'building_interior',
};

// ============ HELPERS ============

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getGridSize(locationType, settlementSize, gridParams) {
    // If AI provided valid dimensions, use them (clamped to table bounds)
    const table = SIZE_TABLE[locationType] || SIZE_TABLE.other;
    const sizeKey = settlementSize || 'medium';
    const [minW, maxW, minH, maxH] = table[sizeKey] || table.medium;

    let w, h;
    if (gridParams?.width && gridParams?.height) {
        w = Math.max(minW, Math.min(maxW, gridParams.width));
        h = Math.max(minH, Math.min(maxH, gridParams.height));
    } else {
        w = randInt(minW, maxW);
        h = randInt(minH, maxH);
    }
    return { w, h };
}

function createGrid(w, h, fill = TILE.FLOOR) {
    const grid = [];
    for (let y = 0; y < h; y++) {
        grid.push(new Array(w).fill(fill));
    }
    return grid;
}

function addWalls(grid, w, h) {
    for (let x = 0; x < w; x++) {
        grid[0][x] = TILE.WALL;
        grid[h - 1][x] = TILE.WALL;
    }
    for (let y = 0; y < h; y++) {
        grid[y][0] = TILE.WALL;
        grid[y][w - 1] = TILE.WALL;
    }
}

function placeDoors(grid, w, h, connections) {
    const doors = [];
    const dirToDoorPos = {
        south:     () => ({ x: randInt(2, w - 3), y: h - 1 }),
        north:     () => ({ x: randInt(2, w - 3), y: 0 }),
        east:      () => ({ x: w - 1, y: randInt(2, h - 3) }),
        west:      () => ({ x: 0, y: randInt(2, h - 3) }),
        southeast: () => ({ x: w - 1, y: h - 1 }),
        southwest: () => ({ x: 0, y: h - 1 }),
        northeast: () => ({ x: w - 1, y: 0 }),
        northwest: () => ({ x: 0, y: 0 }),
        inside:    () => ({ x: randInt(2, w - 3), y: h - 1 }),
        outside:   () => ({ x: randInt(2, w - 3), y: 0 }),
        up:        () => ({ x: randInt(2, w - 3), y: randInt(2, h - 3) }),
        down:      () => ({ x: randInt(2, w - 3), y: randInt(2, h - 3) }),
    };

    if (!connections || connections.length === 0) {
        // Default: one door on south wall
        const pos = dirToDoorPos.south();
        grid[pos.y][pos.x] = TILE.DOOR;
        doors.push({ ...pos, direction: 'south', name: 'Exit' });
        return doors;
    }

    const usedPositions = new Set();
    for (const conn of connections) {
        const dir = conn.direction || 'south';
        const posFn = dirToDoorPos[dir] || dirToDoorPos.south;
        let pos = posFn();

        // Avoid duplicate positions
        let attempts = 0;
        while (usedPositions.has(`${pos.x},${pos.y}`) && attempts < 10) {
            pos = posFn();
            attempts++;
        }
        usedPositions.add(`${pos.x},${pos.y}`);

        // For up/down, use stairs instead of doors
        if (dir === 'up' || dir === 'down') {
            grid[pos.y][pos.x] = TILE.STAIRS;
        } else {
            grid[pos.y][pos.x] = TILE.DOOR;
        }
        // Ensure walkable tile adjacent to door (inside the room)
        if (pos.y === 0 && h > 2) grid[1][pos.x] = TILE.FLOOR;
        if (pos.y === h - 1 && h > 2) grid[h - 2][pos.x] = TILE.FLOOR;
        if (pos.x === 0 && w > 2) grid[pos.y][1] = TILE.FLOOR;
        if (pos.x === w - 1 && w > 2) grid[pos.y][w - 2] = TILE.FLOOR;

        doors.push({ ...pos, direction: dir, name: conn.locationName || 'Exit' });
    }
    return doors;
}

function scatterTiles(grid, w, h, tileType, count, avoidSet) {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 10) {
        const x = randInt(2, w - 3);
        const y = randInt(2, h - 3);
        if (grid[y][x] === TILE.FLOOR && !avoidSet?.has(`${x},${y}`)) {
            grid[y][x] = tileType;
            placed++;
        }
        attempts++;
    }
}

// ============ GENERATORS ============

function generateBuildingInterior(w, h, params, locationType) {
    const grid = createGrid(w, h);
    addWalls(grid, w, h);

    const condition = params?.condition || 'well-kept';
    const wealth = params?.wealth || 'modest';
    const clutter = params?.clutter || 'moderate';

    // Furniture depends on location type
    switch (locationType) {
        case 'tavern': {
            // Counter along one wall
            const counterY = 2;
            for (let x = 2; x < Math.min(w - 2, 2 + Math.floor(w * 0.4)); x++) {
                grid[counterY][x] = TILE.COUNTER;
            }
            // Tables scattered
            const tableCount = Math.floor((w * h) / 40);
            for (let i = 0; i < tableCount; i++) {
                const tx = randInt(2, w - 3);
                const ty = randInt(4, h - 3);
                if (grid[ty][tx] === TILE.FLOOR) {
                    grid[ty][tx] = TILE.TABLE;
                    // Chairs around tables
                    if (tx > 1 && grid[ty][tx - 1] === TILE.FLOOR) grid[ty][tx - 1] = TILE.CHAIR;
                    if (tx < w - 2 && grid[ty][tx + 1] === TILE.FLOOR) grid[ty][tx + 1] = TILE.CHAIR;
                }
            }
            // Fireplace
            if (w > 10) {
                grid[1][w - 3] = TILE.FIREPLACE;
            }
            // Barrels along back wall
            for (let x = Math.floor(w * 0.6); x < w - 2; x += 2) {
                if (grid[1][x] === TILE.FLOOR) grid[1][x] = TILE.BARREL;
            }
            break;
        }
        case 'shop': {
            // Shelves along walls
            for (let y = 2; y < h - 2; y += 2) {
                if (grid[y][1] === TILE.WALL || y % 3 === 0) continue;
                grid[y][2] = TILE.SHELF;
                if (w > 8) grid[y][w - 3] = TILE.SHELF;
            }
            // Counter near center
            const counterY = Math.floor(h * 0.6);
            for (let x = 3; x < Math.min(w - 3, 3 + Math.floor(w * 0.3)); x++) {
                grid[counterY][x] = TILE.COUNTER;
            }
            // Crates in back
            scatterTiles(grid, w, h, TILE.CRATE, 3);
            break;
        }
        case 'residence': {
            // Bed in corner
            grid[2][2] = TILE.BED;
            if (w > 6) grid[2][3] = TILE.BED;
            // Table and chairs
            const tx = Math.floor(w / 2);
            const ty = Math.floor(h / 2);
            grid[ty][tx] = TILE.TABLE;
            if (tx > 1) grid[ty][tx - 1] = TILE.CHAIR;
            if (tx < w - 2) grid[ty][tx + 1] = TILE.CHAIR;
            // Shelf
            if (h > 6) grid[h - 3][2] = TILE.SHELF;
            // Fireplace
            if (w > 8) grid[1][Math.floor(w / 2)] = TILE.FIREPLACE;
            break;
        }
        case 'palace': {
            // Carpet path down center
            const midX = Math.floor(w / 2);
            for (let y = 2; y < h - 2; y++) {
                grid[y][midX] = TILE.CARPET;
                if (midX > 0) grid[y][midX - 1] = TILE.CARPET;
                if (midX < w - 1) grid[y][midX + 1] = TILE.CARPET;
            }
            // Throne at far end
            grid[2][midX] = TILE.THRONE;
            // Pillars
            for (let y = 3; y < h - 3; y += 3) {
                grid[y][3] = TILE.PILLAR;
                grid[y][w - 4] = TILE.PILLAR;
            }
            // Torches
            for (let y = 2; y < h - 2; y += 4) {
                grid[y][1] = TILE.TORCH;
                grid[y][w - 2] = TILE.TORCH;
            }
            break;
        }
        default: {
            // Generic interior
            const tableCount = Math.floor((w * h) / 60);
            scatterTiles(grid, w, h, TILE.TABLE, tableCount);
            scatterTiles(grid, w, h, TILE.CHAIR, tableCount);
            break;
        }
    }

    // Condition-based decoration
    if (condition === 'ruined' || condition === 'dilapidated') {
        scatterTiles(grid, w, h, TILE.RUBBLE, Math.floor((w * h) / 30));
    }
    if (clutter === 'cluttered' || clutter === 'packed') {
        scatterTiles(grid, w, h, TILE.CRATE, Math.floor((w * h) / 50));
        scatterTiles(grid, w, h, TILE.BARREL, Math.floor((w * h) / 50));
    }

    return grid;
}

function generateOpenSpace(w, h, params) {
    const grid = createGrid(w, h, TILE.GRASS);

    // Partial walls / fences around perimeter (not full enclosure)
    for (let x = 0; x < w; x++) {
        if (Math.random() < 0.4) grid[0][x] = TILE.FENCE;
        if (Math.random() < 0.4) grid[h - 1][x] = TILE.FENCE;
    }
    for (let y = 0; y < h; y++) {
        if (Math.random() < 0.4) grid[y][0] = TILE.FENCE;
        if (Math.random() < 0.4) grid[y][w - 1] = TILE.FENCE;
    }

    // Central area is paved floor
    const insetX = Math.floor(w * 0.15);
    const insetY = Math.floor(h * 0.15);
    for (let y = insetY; y < h - insetY; y++) {
        for (let x = insetX; x < w - insetX; x++) {
            grid[y][x] = TILE.FLOOR;
        }
    }

    // Centerpiece (fountain or landmark)
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    grid[cy][cx] = TILE.FOUNTAIN;

    // Stalls scattered for market
    const stallCount = Math.floor((w * h) / 80);
    scatterTiles(grid, w, h, TILE.STALL, stallCount);

    // Wide entrances on each side
    for (const side of ['north', 'south', 'east', 'west']) {
        const gapSize = Math.max(3, Math.floor(Math.min(w, h) * 0.2));
        if (side === 'north' || side === 'south') {
            const row = side === 'north' ? 0 : h - 1;
            const start = Math.floor(w / 2) - Math.floor(gapSize / 2);
            for (let x = start; x < start + gapSize && x < w; x++) {
                grid[row][x] = TILE.FLOOR;
            }
        } else {
            const col = side === 'west' ? 0 : w - 1;
            const start = Math.floor(h / 2) - Math.floor(gapSize / 2);
            for (let y = start; y < start + gapSize && y < h; y++) {
                grid[y][col] = TILE.FLOOR;
            }
        }
    }

    return grid;
}

function generateFortification(w, h, params) {
    const grid = createGrid(w, h);

    // Thick walls (2 tiles)
    for (let x = 0; x < w; x++) {
        grid[0][x] = TILE.WALL;
        grid[1][x] = TILE.WALL;
        grid[h - 1][x] = TILE.WALL;
        grid[h - 2][x] = TILE.WALL;
    }
    for (let y = 0; y < h; y++) {
        grid[y][0] = TILE.WALL;
        grid[y][1] = TILE.WALL;
        grid[y][w - 1] = TILE.WALL;
        grid[y][w - 2] = TILE.WALL;
    }

    // Clear inner passage
    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            grid[y][x] = TILE.FLOOR;
        }
    }

    // Pillars / towers at corners (inside)
    const towerPositions = [
        [3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4]
    ];
    for (const [px, py] of towerPositions) {
        if (px >= 2 && px < w - 2 && py >= 2 && py < h - 2) {
            grid[py][px] = TILE.PILLAR;
        }
    }

    // Weapon racks
    scatterTiles(grid, w, h, TILE.WEAPON_RACK, 4);

    // Torches along walls
    for (let y = 3; y < h - 3; y += 3) {
        if (grid[y][2] === TILE.FLOOR) grid[y][2] = TILE.TORCH;
        if (grid[y][w - 3] === TILE.FLOOR) grid[y][w - 3] = TILE.TORCH;
    }

    return grid;
}

function generateUnderground(w, h, params) {
    // Use rot.js Cellular automaton for organic cave shapes
    const grid = createGrid(w, h, TILE.WALL);

    const cellular = new ROT.Map.Cellular(w, h, { born: [5, 6, 7, 8], survive: [4, 5, 6, 7, 8] });
    cellular.randomize(0.48);

    // Run a few generations
    for (let i = 0; i < 4; i++) {
        cellular.create();
    }

    // Copy result to our grid
    cellular.create((x, y, value) => {
        if (value === 1) {
            grid[y][x] = TILE.FLOOR;
        }
    });

    // Ensure border is wall
    for (let x = 0; x < w; x++) {
        grid[0][x] = TILE.WALL;
        grid[h - 1][x] = TILE.WALL;
    }
    for (let y = 0; y < h; y++) {
        grid[y][0] = TILE.WALL;
        grid[y][w - 1] = TILE.WALL;
    }

    // Scatter rubble and crates
    scatterTiles(grid, w, h, TILE.RUBBLE, Math.floor((w * h) / 40));
    scatterTiles(grid, w, h, TILE.CRATE, 2);

    return grid;
}

function generateWaterfront(w, h, params) {
    const grid = createGrid(w, h);

    // Water on south edge (bottom rows)
    const waterRows = Math.max(3, Math.floor(h * 0.25));
    for (let y = h - waterRows; y < h; y++) {
        for (let x = 0; x < w; x++) {
            grid[y][x] = TILE.WATER;
        }
    }

    // Piers extending into water
    const pierCount = Math.max(2, Math.floor(w / 10));
    for (let i = 0; i < pierCount; i++) {
        const px = Math.floor(w * (i + 1) / (pierCount + 1));
        for (let y = h - waterRows - 1; y < h - 1; y++) {
            grid[y][px] = TILE.PIER;
        }
    }

    // Buildings along shore (top portion)
    addWalls(grid, w, h - waterRows);
    // Fix: only wall the land portion
    for (let x = 0; x < w; x++) {
        grid[0][x] = TILE.WALL;
        grid[h - waterRows - 1][x] = TILE.WALL;
    }
    for (let y = 0; y < h - waterRows; y++) {
        grid[y][0] = TILE.WALL;
        grid[y][w - 1] = TILE.WALL;
    }

    // Interior floor
    for (let y = 1; y < h - waterRows - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (grid[y][x] === TILE.FLOOR) grid[y][x] = TILE.FLOOR;
        }
    }

    // Barrels and crates near shore
    for (let x = 2; x < w - 2; x += 4) {
        const y = h - waterRows - 2;
        if (y > 0 && grid[y][x] === TILE.FLOOR) {
            grid[y][x] = Math.random() < 0.5 ? TILE.BARREL : TILE.CRATE;
        }
    }

    return grid;
}

function generateReligious(w, h, params) {
    const grid = createGrid(w, h);
    addWalls(grid, w, h);

    const midX = Math.floor(w / 2);

    // Carpet path down center
    for (let y = 2; y < h - 2; y++) {
        grid[y][midX] = TILE.CARPET;
        if (midX > 1) grid[y][midX - 1] = TILE.CARPET;
        if (midX < w - 1) grid[y][midX + 1] = TILE.CARPET;
    }

    // Altar at north end
    grid[2][midX] = TILE.ALTAR;
    if (midX > 1) grid[2][midX - 1] = TILE.ALTAR;
    if (midX < w - 2) grid[2][midX + 1] = TILE.ALTAR;

    // Symmetrical pillars
    for (let y = 3; y < h - 3; y += 3) {
        const offset = Math.floor(w * 0.25);
        if (offset > 1 && offset < w - 2) {
            grid[y][offset] = TILE.PILLAR;
            grid[y][w - 1 - offset] = TILE.PILLAR;
        }
    }

    // Torches
    for (let y = 2; y < h - 2; y += 4) {
        grid[y][1] = TILE.TORCH;
        grid[y][w - 2] = TILE.TORCH;
    }

    return grid;
}

// ============ MAIN API ============

/**
 * Generate a scene grid for a location.
 * @returns {{ grid: number[][], width: number, height: number, doors: Array }}
 */
function generateSceneGrid(settlement, location, gridParams) {
    const locationType = location.type || 'other';
    const settlementSize = settlement.size || 'medium';
    const category = CATEGORY_MAP[locationType] || 'building_interior';
    const { w, h } = getGridSize(locationType, settlementSize, gridParams);

    let grid;
    switch (category) {
        case 'building_interior':
            grid = generateBuildingInterior(w, h, gridParams, locationType);
            break;
        case 'open_space':
            grid = generateOpenSpace(w, h, gridParams);
            break;
        case 'fortification':
            grid = generateFortification(w, h, gridParams);
            break;
        case 'underground':
            grid = generateUnderground(w, h, gridParams);
            break;
        case 'waterfront':
            grid = generateWaterfront(w, h, gridParams);
            break;
        case 'religious':
            grid = generateReligious(w, h, gridParams);
            break;
        default:
            grid = generateBuildingInterior(w, h, gridParams, locationType);
    }

    // Place doors based on connections
    const connections = location.connections || [];
    const doors = (category === 'open_space')
        ? placeOpenSpaceDoors(grid, w, h, connections)
        : placeDoors(grid, w, h, connections);

    return { grid, width: w, height: h, doors };
}

/**
 * For open spaces, place door markers at edges where connections exist.
 */
function placeOpenSpaceDoors(grid, w, h, connections) {
    const doors = [];
    const dirToEdge = {
        south: () => ({ x: Math.floor(w / 2), y: h - 1 }),
        north: () => ({ x: Math.floor(w / 2), y: 0 }),
        east:  () => ({ x: w - 1, y: Math.floor(h / 2) }),
        west:  () => ({ x: 0, y: Math.floor(h / 2) }),
    };

    for (const conn of connections) {
        const dir = conn.direction || 'south';
        const posFn = dirToEdge[dir] || dirToEdge.south;
        const pos = posFn();
        grid[pos.y][pos.x] = TILE.DOOR;
        doors.push({ ...pos, direction: dir, name: conn.locationName || 'Exit' });
    }

    if (doors.length === 0) {
        const pos = dirToEdge.south();
        grid[pos.y][pos.x] = TILE.DOOR;
        doors.push({ ...pos, direction: 'south', name: 'Exit' });
    }

    return doors;
}

/**
 * Place entities (POIs) on the grid with semantic awareness.
 * @returns {{ poiPositions: Map<string, {x,y}>, playerStart: {x,y} }}
 */
function placeEntitiesOnGrid(grid, pois, doors, locationType) {
    const h = grid.length;
    const w = grid[0].length;
    const poiPositions = new Map(); // poiId → {x, y}
    const occupied = new Set();

    // Mark door positions as occupied
    for (const d of doors) {
        occupied.add(`${d.x},${d.y}`);
    }

    // Find walkable tiles
    const walkable = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (WALKABLE_TILES.has(grid[y][x])) {
                walkable.push({ x, y });
            }
        }
    }

    // Find tiles near specific furniture types
    function findNear(tileType, maxDist = 2) {
        const results = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== tileType) continue;
                // Find walkable tiles within maxDist
                for (const wt of walkable) {
                    const dist = Math.abs(wt.x - x) + Math.abs(wt.y - y);
                    if (dist <= maxDist && dist > 0 && !occupied.has(`${wt.x},${wt.y}`)) {
                        results.push(wt);
                    }
                }
            }
        }
        return results;
    }

    // Semantic placement rules
    const semanticTargets = {
        tavern: { npc: TILE.COUNTER },
        shop: { npc: TILE.COUNTER },
        temple: { npc: TILE.ALTAR },
        gate: { npc: TILE.DOOR },
        barracks: { npc: TILE.WEAPON_RACK },
    };

    const targetTile = semanticTargets[locationType]?.npc;

    for (const poi of pois) {
        let pos = null;

        // Try semantic placement for NPCs
        if (poi.type === 'npc' && targetTile) {
            const nearFurniture = findNear(targetTile, 3);
            if (nearFurniture.length > 0) {
                pos = nearFurniture[Math.floor(Math.random() * nearFurniture.length)];
            }
        }

        // Fallback: random walkable tile not occupied
        if (!pos) {
            const available = walkable.filter(wt => !occupied.has(`${wt.x},${wt.y}`));
            if (available.length > 0) {
                pos = available[Math.floor(Math.random() * available.length)];
            }
        }

        if (pos) {
            poiPositions.set(poi._id.toString(), { x: pos.x, y: pos.y });
            occupied.add(`${pos.x},${pos.y}`);
        }
    }

    // Player start: south door preferred, then first door, then any walkable edge tile
    let playerStart = null;
    const southDoor = doors.find(d => d.direction === 'south');
    const primaryDoor = southDoor || doors[0];

    if (primaryDoor) {
        // Place player adjacent to door, inside the room
        const candidates = [
            { x: primaryDoor.x, y: primaryDoor.y - 1 },
            { x: primaryDoor.x, y: primaryDoor.y + 1 },
            { x: primaryDoor.x - 1, y: primaryDoor.y },
            { x: primaryDoor.x + 1, y: primaryDoor.y },
        ].filter(c =>
            c.x >= 0 && c.x < w && c.y >= 0 && c.y < h &&
            WALKABLE_TILES.has(grid[c.y][c.x]) &&
            !occupied.has(`${c.x},${c.y}`)
        );

        if (candidates.length > 0) {
            playerStart = candidates[0];
        }
    }

    // Fallback: any walkable tile on the edge
    if (!playerStart) {
        for (const wt of walkable) {
            if ((wt.y === 1 || wt.y === h - 2 || wt.x === 1 || wt.x === w - 2) && !occupied.has(`${wt.x},${wt.y}`)) {
                playerStart = wt;
                break;
            }
        }
    }

    // Last resort: center of grid
    if (!playerStart) {
        playerStart = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    }

    return { poiPositions, playerStart };
}

/**
 * Find a player start position on an existing grid (fallback when gridPosition is null).
 */
function findPlayerStart(grid) {
    const h = grid.length;
    const w = grid[0]?.length || 0;

    // Try door tile first
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (grid[y][x] === TILE.DOOR) {
                const adj = [
                    { x, y: y - 1 }, { x, y: y + 1 },
                    { x: x - 1, y }, { x: x + 1, y },
                ].filter(c =>
                    c.x >= 0 && c.x < w && c.y >= 0 && c.y < h &&
                    WALKABLE_TILES.has(grid[c.y][c.x])
                );
                if (adj.length > 0) return adj[0];
            }
        }
    }

    // Fallback: first walkable tile
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (WALKABLE_TILES.has(grid[y][x])) return { x, y };
        }
    }

    return { x: Math.floor(w / 2), y: Math.floor(h / 2) };
}

const POPULATION_COUNTS = {
    crowded:   [8, 12],
    populated: [4, 6],
    sparse:    [1, 2],
    isolated:  [0, 0],
};

/**
 * Generate ambient (unnamed) NPC positions on a grid.
 * These represent background population — patrons, passersby, etc.
 * @param {number[][]} grid
 * @param {string} populationLevel - crowded/populated/sparse/isolated
 * @param {Set<string>} occupied - "x,y" strings already taken by POIs/player
 * @returns {{ x: number, y: number }[]}
 */
function generateAmbientNpcs(grid, populationLevel, occupied) {
    const [min, max] = POPULATION_COUNTS[populationLevel] || POPULATION_COUNTS.populated;
    const count = min + Math.floor(Math.random() * (max - min + 1));
    if (count === 0) return [];

    const h = grid.length;
    const w = grid[0]?.length || 0;

    // Collect walkable, unoccupied floor tiles (prefer FLOOR over other walkable)
    const candidates = [];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (WALKABLE_TILES.has(grid[y][x]) && !occupied.has(`${x},${y}`)) {
                candidates.push({ x, y });
            }
        }
    }

    // Shuffle and pick
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const placed = [];
    const usedSet = new Set();
    for (const c of candidates) {
        if (placed.length >= count) break;
        // Keep some spacing — don't stack adjacent ambient NPCs
        const key = `${c.x},${c.y}`;
        const tooClose = placed.some(p => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 2);
        if (tooClose) continue;
        placed.push(c);
        usedSet.add(key);
    }

    return placed;
}

/**
 * Find walkable tiles adjacent to a target position (for moving an entity near a target).
 * Returns candidates sorted by distance to `fromPos` (closest first).
 * @param {number[][]} grid
 * @param {{ x: number, y: number }} targetPos - Position to move adjacent to
 * @param {{ x: number, y: number }} fromPos - Current position (used for sorting)
 * @param {Set<string>} occupied - "x,y" strings already taken
 * @returns {{ x: number, y: number }[]}
 */
function findAdjacentWalkable(grid, targetPos, fromPos, occupied) {
    const h = grid.length;
    const w = grid[0]?.length || 0;
    const { x: tx, y: ty } = targetPos;

    const candidates = [
        { x: tx, y: ty - 1 }, { x: tx, y: ty + 1 },
        { x: tx - 1, y: ty }, { x: tx + 1, y: ty },
        { x: tx - 1, y: ty - 1 }, { x: tx + 1, y: ty - 1 },
        { x: tx - 1, y: ty + 1 }, { x: tx + 1, y: ty + 1 },
    ].filter(c =>
        c.x >= 0 && c.x < w && c.y >= 0 && c.y < h &&
        WALKABLE_TILES.has(grid[c.y][c.x]) &&
        !occupied.has(`${c.x},${c.y}`)
    );

    // Sort by distance to fromPos (prefer closer to where we're coming from)
    if (fromPos) {
        candidates.sort((a, b) => {
            const da = Math.abs(a.x - fromPos.x) + Math.abs(a.y - fromPos.y);
            const db = Math.abs(b.x - fromPos.x) + Math.abs(b.y - fromPos.y);
            return da - db;
        });
    }

    return candidates;
}

/**
 * Move one step from `from` toward `target` on the grid.
 * Used for NPC reactive movement — they take 1-2 steps toward the player.
 * @returns {{ x: number, y: number } | null} New position, or null if can't move
 */
function stepToward(grid, from, target, occupied) {
    const h = grid.length;
    const w = grid[0]?.length || 0;
    const dx = Math.sign(target.x - from.x);
    const dy = Math.sign(target.y - from.y);

    // Try diagonal, then cardinal moves toward target
    const moves = [];
    if (dx !== 0 && dy !== 0) moves.push({ x: from.x + dx, y: from.y + dy });
    if (dx !== 0) moves.push({ x: from.x + dx, y: from.y });
    if (dy !== 0) moves.push({ x: from.x, y: from.y + dy });

    for (const m of moves) {
        if (m.x >= 0 && m.x < w && m.y >= 0 && m.y < h &&
            WALKABLE_TILES.has(grid[m.y][m.x]) &&
            !occupied.has(`${m.x},${m.y}`)) {
            return m;
        }
    }
    return null;
}

/**
 * Find all door positions on the grid.
 * @param {number[][]} grid
 * @returns {{ x: number, y: number }[]}
 */
function findDoors(grid) {
    const doors = [];
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < (grid[0]?.length || 0); x++) {
            if (grid[y][x] === TILE.DOOR) {
                doors.push({ x, y });
            }
        }
    }
    return doors;
}

module.exports = {
    generateSceneGrid, placeEntitiesOnGrid, findPlayerStart,
    generateAmbientNpcs, findAdjacentWalkable, stepToward, findDoors
};
