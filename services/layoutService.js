/**
 * layoutService.js - Computes spatial layout positions for settlement locations
 *
 * Uses BFS from the starting location to assign (x, y) coordinates based on
 * compass directions and distances from the connection graph.
 * Pure computation — no DB side effects.
 */

const DIRECTION_VECTORS = {
    north:     { x: 0,    y: -1 },
    south:     { x: 0,    y: 1 },
    east:      { x: 1,    y: 0 },
    west:      { x: -1,   y: 0 },
    northeast: { x: 0.7,  y: -0.7 },
    northwest: { x: -0.7, y: -0.7 },
    southeast: { x: 0.7,  y: 0.7 },
    southwest: { x: -0.7, y: 0.7 },
    up:        { x: 0.3,  y: -0.5 },
    down:      { x: -0.3, y: 0.5 },
    inside:    { x: 0.3,  y: 0 },
    outside:   { x: -0.3, y: 0 }
};

const DISTANCE_SCALE = {
    adjacent: 1,
    close: 1.5,
    far: 2
};

/**
 * Check if a position collides with any existing placed position
 */
function hasCollision(x, y, placedPositions, threshold = 0.5) {
    for (const pos of placedPositions.values()) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < threshold) {
            return true;
        }
    }
    return false;
}

/**
 * Nudge a position outward to avoid collision (spiral search, up to 8 directions)
 */
function nudgePosition(x, y, placedPositions) {
    const nudgeAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    const nudgeDistance = 0.6;

    for (let ring = 1; ring <= 3; ring++) {
        for (const angle of nudgeAngles) {
            const rad = (angle * Math.PI) / 180;
            const nx = x + Math.cos(rad) * nudgeDistance * ring;
            const ny = y + Math.sin(rad) * nudgeDistance * ring;
            if (!hasCollision(nx, ny, placedPositions)) {
                return { x: nx, y: ny };
            }
        }
    }

    // Fallback: just offset significantly
    return { x: x + 1.5, y: y + 0.5 };
}

/**
 * Detect and fix degenerate linear layouts.
 * If all points are roughly collinear (spread in one axis but flat in the other),
 * redistribute them into a more natural cluster using a golden-angle spiral.
 */
function fixLinearLayout(positions) {
    if (positions.size < 3) return;

    const pts = Array.from(positions.values());
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const ratio = Math.min(rangeX, rangeY) / (Math.max(rangeX, rangeY) || 1);

    // If the smaller axis is less than 15% of the larger, it's too linear
    if (ratio >= 0.15) return;

    // Redistribute using golden-angle spiral around centroid
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
    const spacing = 1.0;
    let i = 0;

    for (const [key, pos] of positions) {
        if (i === 0) {
            // First node (start) stays at center
            pos.x = cx;
            pos.y = cy;
        } else {
            const r = spacing * Math.sqrt(i);
            const theta = i * goldenAngle;
            pos.x = cx + r * Math.cos(theta);
            pos.y = cy + r * Math.sin(theta);
        }
        i++;
    }
}

/**
 * Compute layout positions for all locations in a settlement using BFS.
 *
 * @param {Array} locations - Array of location objects (with name, connections, isStartingLocation)
 * @returns {Map<string, {x: number, y: number}>} Map of lowercase name → position
 */
function computeLayout(locations) {
    if (!locations || locations.length === 0) {
        return new Map();
    }

    const positions = new Map(); // key: name.toLowerCase() → {x, y}

    // Build lookup by lowercase name
    const byName = new Map();
    for (const loc of locations) {
        byName.set(loc.name.toLowerCase(), loc);
    }

    // Find starting node: isStartingLocation → first gate → first location
    let startLoc = locations.find(l => l.isStartingLocation)
        || locations.find(l => l.type === 'gate')
        || locations[0];

    const startKey = startLoc.name.toLowerCase();
    positions.set(startKey, { x: 0, y: 0 });

    // BFS
    const queue = [startKey];
    const visited = new Set([startKey]);

    while (queue.length > 0) {
        const currentKey = queue.shift();
        const currentLoc = byName.get(currentKey);
        if (!currentLoc) continue;

        const currentPos = positions.get(currentKey);
        const connections = currentLoc.connections || [];

        for (const conn of connections) {
            if (!conn.locationName) continue;
            const targetKey = conn.locationName.toLowerCase();

            if (visited.has(targetKey)) continue;
            visited.add(targetKey);

            // Compute position from direction + distance
            const dir = DIRECTION_VECTORS[conn.direction] || { x: 0.5, y: 0.5 };
            const scale = DISTANCE_SCALE[conn.distance] || 1;

            let newX = currentPos.x + dir.x * scale;
            let newY = currentPos.y + dir.y * scale;

            // Collision check and nudge
            if (hasCollision(newX, newY, positions)) {
                const nudged = nudgePosition(newX, newY, positions);
                newX = nudged.x;
                newY = nudged.y;
            }

            positions.set(targetKey, { x: newX, y: newY });

            // Only enqueue if this location exists in our location list
            if (byName.has(targetKey)) {
                queue.push(targetKey);
            }
        }
    }

    // Detect and fix degenerate linear layouts
    if (positions.size >= 3) {
        fixLinearLayout(positions);
    }

    // Handle disconnected/unplaced locations: row below main cluster
    let maxY = 0;
    for (const pos of positions.values()) {
        if (pos.y > maxY) maxY = pos.y;
    }

    let orphanX = 0;
    for (const loc of locations) {
        const key = loc.name.toLowerCase();
        if (!positions.has(key)) {
            positions.set(key, { x: orphanX, y: maxY + 2 });
            orphanX += 1.2;
        }
    }

    return positions;
}

/**
 * Compute position for a single new location being added to an existing settlement.
 *
 * @param {Array} existingLocations - Already-placed locations (with coordinates)
 * @param {Object} newLocation - The new location object (with connections)
 * @returns {{x: number, y: number}} Computed position
 */
function computeSingleNodePosition(existingLocations, newLocation) {
    if (!existingLocations || existingLocations.length === 0) {
        return { x: 0, y: 0 };
    }

    // Build map of existing positions
    const placedPositions = new Map();
    for (const loc of existingLocations) {
        if (loc.coordinates) {
            placedPositions.set(loc.name.toLowerCase(), {
                x: loc.coordinates.x || 0,
                y: loc.coordinates.y || 0
            });
        }
    }

    // Try to position based on connections to existing locations
    const connections = newLocation.connections || [];
    for (const conn of connections) {
        if (!conn.locationName) continue;
        const sourceKey = conn.locationName.toLowerCase();
        const sourcePos = placedPositions.get(sourceKey);
        if (!sourcePos) continue;

        // Reverse the direction (if new connects to existing via "north",
        // new is south of existing, but the connection says the existing is "north" of new,
        // so new should be placed south of existing)
        // Actually: the connection says "from newLocation, go <direction> to reach conn.locationName"
        // So the new location is the OPPOSITE direction from the existing.
        // We want to place newLocation, and the connection says "to get from newLocation to source, go <dir>"
        // So newLocation is at source - dirVector
        const dir = DIRECTION_VECTORS[conn.direction] || { x: 0.5, y: 0.5 };
        const scale = DISTANCE_SCALE[conn.distance] || 1;

        let newX = sourcePos.x - dir.x * scale;
        let newY = sourcePos.y - dir.y * scale;

        if (hasCollision(newX, newY, placedPositions)) {
            const nudged = nudgePosition(newX, newY, placedPositions);
            newX = nudged.x;
            newY = nudged.y;
        }

        return { x: newX, y: newY };
    }

    // Also check if any existing location connects TO this new location
    for (const loc of existingLocations) {
        const locConns = loc.connections || [];
        for (const conn of locConns) {
            if (conn.locationName?.toLowerCase() === newLocation.name.toLowerCase()) {
                const sourcePos = placedPositions.get(loc.name.toLowerCase());
                if (!sourcePos) continue;

                const dir = DIRECTION_VECTORS[conn.direction] || { x: 0.5, y: 0.5 };
                const scale = DISTANCE_SCALE[conn.distance] || 1;

                let newX = sourcePos.x + dir.x * scale;
                let newY = sourcePos.y + dir.y * scale;

                if (hasCollision(newX, newY, placedPositions)) {
                    const nudged = nudgePosition(newX, newY, placedPositions);
                    newX = nudged.x;
                    newY = nudged.y;
                }

                return { x: newX, y: newY };
            }
        }
    }

    // Fallback: place below the cluster
    let maxY = 0;
    for (const pos of placedPositions.values()) {
        if (pos.y > maxY) maxY = pos.y;
    }
    return { x: 0, y: maxY + 2 };
}

const VALID_DIRECTIONS = new Set(Object.keys(DIRECTION_VECTORS));

/**
 * Normalize an AI-generated direction string to a valid schema enum value.
 * Handles common AI mistakes: hyphens ("north-east"), extra words ("southeast (ice-bridge)"),
 * descriptive phrases ("up the cliff"), and near-matches ("nearby").
 *
 * @param {string} raw - The raw direction string from the AI
 * @returns {string|null} A valid direction enum value, or null if unrecognizable
 */
function normalizeDirection(raw) {
    if (!raw) return null;

    // Strip to lowercase, trim whitespace
    let d = raw.toLowerCase().trim();

    // Exact match
    if (VALID_DIRECTIONS.has(d)) return d;

    // Remove parenthetical descriptions: "southeast (ice-bridge)" → "southeast"
    d = d.replace(/\s*\(.*\)/, '').trim();
    if (VALID_DIRECTIONS.has(d)) return d;

    // Remove "via ...", "the ...", "to ..." suffixes: "northeast via the rope-bridge" → "northeast"
    d = d.replace(/\s+(via|the|to|from|through|along|across|over)\b.*$/, '').trim();
    if (VALID_DIRECTIONS.has(d)) return d;

    // Remove hyphens: "north-east" → "northeast", "south-west" → "southwest"
    const dehyphenated = d.replace(/-/g, '');
    if (VALID_DIRECTIONS.has(dehyphenated)) return dehyphenated;

    // Extract leading direction word from descriptive phrases:
    // "up the cliff-face" → "up", "down the glaciar-steps" → "down"
    const leadingMatch = d.match(/^(north|south|east|west|northeast|northwest|southeast|southwest|up|down|inside|outside)\b/);
    if (leadingMatch) return leadingMatch[1];

    // Compound with space: "north east" → "northeast"
    const compoundMatch = d.match(/^(north|south)\s*(east|west)$/);
    if (compoundMatch) return compoundMatch[1] + compoundMatch[2];

    // "nearby" or other unrecognizable → pick a random valid direction
    return null;
}

/**
 * Sanitize a direction, returning a valid enum value.
 * Falls back to a random cardinal direction if normalization fails.
 */
function sanitizeDirection(raw) {
    const normalized = normalizeDirection(raw);
    if (normalized) return normalized;

    // Fallback: pick a random cardinal direction
    const fallbacks = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

module.exports = {
    computeLayout,
    computeSingleNodePosition,
    normalizeDirection,
    sanitizeDirection,
    DIRECTION_VECTORS,
    DISTANCE_SCALE
};
