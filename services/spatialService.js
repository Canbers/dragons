/**
 * spatialService.js — Distance calculation, zone classification, AI spatial context
 */

function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function getZone(distance) {
    if (distance <= 1) return 'ADJACENT';
    if (distance <= 4) return 'CLOSE';
    if (distance <= 8) return 'NEAR';
    if (distance <= 15) return 'FAR';
    return 'DISTANT';
}

function getDirectionTo(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (dx === 0 && dy === 0) return 'here';

    // Use atan2 for accurate direction (note: y is inverted in grid coords)
    const angle = Math.atan2(-dy, dx) * (180 / Math.PI);

    if (angle >= -22.5 && angle < 22.5)   return 'east';
    if (angle >= 22.5 && angle < 67.5)    return 'northeast';
    if (angle >= 67.5 && angle < 112.5)   return 'north';
    if (angle >= 112.5 && angle < 157.5)  return 'northwest';
    if (angle >= 157.5 || angle < -157.5) return 'west';
    if (angle >= -157.5 && angle < -112.5) return 'southwest';
    if (angle >= -112.5 && angle < -67.5) return 'south';
    if (angle >= -67.5 && angle < -22.5)  return 'southeast';
    return 'nearby';
}

/**
 * Build a spatial context block for injection into the AI narrative prompt.
 * @param {{ x: number, y: number }} playerPos
 * @param {Array<{ name: string, type: string, gridPosition: { x: number, y: number } }>} entities
 * @param {{ width: number, height: number }} gridDimensions
 * @returns {string}
 */
function generateSpatialContext(playerPos, entities, gridDimensions) {
    if (!playerPos || playerPos.x == null || playerPos.y == null) return '';
    if (!entities || entities.length === 0) return '';

    const lines = [`SPATIAL LAYOUT (${gridDimensions.width}x${gridDimensions.height} grid):`];
    lines.push(`- Player position: (${playerPos.x}, ${playerPos.y})`);

    for (const entity of entities) {
        const gp = entity.gridPosition;
        if (!gp || gp.x == null || gp.y == null) continue;

        const dist = manhattanDistance(playerPos.x, playerPos.y, gp.x, gp.y);
        const zone = getZone(dist);
        const dir = getDirectionTo(playerPos.x, playerPos.y, gp.x, gp.y);
        const paceLabel = dist === 1 ? 'pace' : 'paces';

        lines.push(`- ${entity.name} (${entity.type}) is ${zone} (${dist} ${paceLabel} ${dir})`);
    }

    lines.push('Interaction rules: ADJACENT=melee/touch, CLOSE=conversation, NEAR=ranged/shout, FAR=observe only');

    return lines.join('\n');
}

module.exports = { manhattanDistance, getZone, getDirectionTo, generateSpatialContext };
