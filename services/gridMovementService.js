/**
 * gridMovementService.js - Player + NPC movement on the tile grid after each action.
 * Extracted from gameAgent.js (updateGridPositions).
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');
const sceneGridService = require('./sceneGridService');
const spatialService = require('./spatialService');

/**
 * Update grid positions for player and NPCs after an action.
 * - Player moves toward the entity they interacted with (fuzzy name match on input)
 * - Interacted NPC moves toward the player (1-2 steps)
 * - On location change (didMove), player position is reset by executeGetScene
 *
 * @returns {{ playerMoved: boolean, npcsMoved: string[] }}
 */
async function updateGridPositions(plotId, input, didMove, lookedUpNpcNames = [], moveTarget = null) {
    console.log(`[GridMovement] Called: input="${input?.substring(0, 40)}", didMove=${didMove}, lookedUpNpcs=${lookedUpNpcNames.join(',')}${moveTarget ? `, moveTarget=(${moveTarget.x},${moveTarget.y})` : ''}`);
    if (didMove) return { playerMoved: false, npcsMoved: [] };

    try {
        const plot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');

        const settlement = plot?.current_state?.current_location?.settlement;
        const locationId = plot?.current_state?.current_location?.locationId;
        let playerPos = plot?.current_state?.gridPosition;

        console.log(`[GridMovement] Data: settlement=${!!settlement}, locationId=${!!locationId}, playerPos=${JSON.stringify(playerPos)}`);

        if (!settlement || !locationId) {
            return { playerMoved: false, npcsMoved: [] };
        }

        const currentLoc = settlement.locations?.find(
            l => l._id.toString() === locationId.toString()
        );

        if (!currentLoc?.gridGenerated || !currentLoc.interiorGrid) {
            return { playerMoved: false, npcsMoved: [] };
        }

        // Backfill player position if missing
        if (!playerPos || playerPos.x == null) {
            playerPos = sceneGridService.findPlayerStart(currentLoc.interiorGrid);
            plot.current_state.gridPosition = playerPos;
            plot.markModified('current_state.gridPosition');
            await plot.save();
            console.log(`[GridMovement] Backfilled player position: (${playerPos.x},${playerPos.y})`);
        }

        const grid = currentLoc.interiorGrid;
        const pois = await Poi.find({
            settlement: settlement._id,
            locationId: currentLoc._id,
            'gridPosition.x': { $ne: null }
        });

        // Build occupied set (all entity positions + player)
        const occupied = new Set();
        for (const p of pois) occupied.add(`${p.gridPosition.x},${p.gridPosition.y}`);
        occupied.add(`${playerPos.x},${playerPos.y}`);

        const inputLower = input.toLowerCase();
        const inputWords = inputLower.split(/\s+/).filter(w => w.length > 2);
        const result = { playerMoved: false, npcsMoved: [] };

        // --- Find which entity the player is interacting with ---
        let targetPoi = null;
        let bestMatchLen = 0;

        for (const poi of pois) {
            const nameLower = poi.name.toLowerCase();
            if (inputLower.includes(nameLower) && nameLower.length > bestMatchLen) {
                targetPoi = poi;
                bestMatchLen = nameLower.length;
            }
            if (!targetPoi || nameLower.length > bestMatchLen) {
                const firstName = nameLower.split(/\s+/)[0];
                if (firstName.length > 2 && inputWords.includes(firstName) && firstName.length > bestMatchLen) {
                    targetPoi = poi;
                    bestMatchLen = firstName.length;
                }
            }
        }

        // Fallback: if no name match from input, check if AI looked up an NPC via tool call
        if (!targetPoi && lookedUpNpcNames.length > 0) {
            for (const npcName of lookedUpNpcNames) {
                const npcLower = npcName.toLowerCase();
                const match = pois.find(p => p.name.toLowerCase() === npcLower ||
                    p.name.toLowerCase().includes(npcLower) ||
                    npcLower.includes(p.name.toLowerCase()));
                if (match) {
                    targetPoi = match;
                    console.log(`[GridMovement] Matched via lookup_npc tool: ${match.name}`);
                    break;
                }
            }
        }

        // Check for exit/door keywords
        const exitKeywords = ['door', 'exit', 'leave', 'outside', 'entrance'];
        const wantsExit = exitKeywords.some(kw => inputLower.includes(kw));

        // Check for directional movement (e.g., "I walk a few paces to the northeast")
        const directionDelta = parseDirectionFromInput(inputLower);

        if (moveTarget && moveTarget.x != null && moveTarget.y != null) {
            // Exact click-to-move: pathfind to the specific tile the player clicked
            const { WALKABLE_TILES } = require('./tileConstants');
            const h = grid.length;
            const w = grid[0]?.length || 0;
            const tx = moveTarget.x, ty = moveTarget.y;

            if (tx >= 0 && tx < w && ty >= 0 && ty < h &&
                WALKABLE_TILES.has(grid[ty][tx]) &&
                !occupied.has(`${tx},${ty}`)) {

                occupied.delete(`${playerPos.x},${playerPos.y}`);
                let pos = { ...playerPos };
                const maxSteps = Math.max(Math.abs(tx - pos.x), Math.abs(ty - pos.y)) + 2;

                for (let i = 0; i < Math.min(maxSteps, 20); i++) {
                    if (pos.x === tx && pos.y === ty) break;
                    const step = sceneGridService.stepToward(grid, pos, moveTarget, occupied);
                    if (!step) break;
                    occupied.delete(`${pos.x},${pos.y}`);
                    pos = step;
                    occupied.add(`${pos.x},${pos.y}`);
                }

                if (pos.x !== playerPos.x || pos.y !== playerPos.y) {
                    plot.current_state.gridPosition = { x: pos.x, y: pos.y };
                    result.playerMoved = true;
                    console.log(`[GridMovement] Click-to-move: (${playerPos.x},${playerPos.y})→(${pos.x},${pos.y}) target=(${tx},${ty})`);
                } else {
                    console.log(`[GridMovement] Click-to-move blocked — no path to (${tx},${ty})`);
                }
            } else {
                console.log(`[GridMovement] Click-to-move target (${tx},${ty}) not walkable or occupied`);
            }
        } else if (targetPoi) {
            const targetPos = targetPoi.gridPosition;
            const dist = spatialService.manhattanDistance(playerPos.x, playerPos.y, targetPos.x, targetPos.y);

            if (dist > 1) {
                occupied.delete(`${playerPos.x},${playerPos.y}`);

                const candidates = sceneGridService.findAdjacentWalkable(grid, targetPos, playerPos, occupied);
                if (candidates.length > 0) {
                    const newPos = candidates[0];
                    plot.current_state.gridPosition = { x: newPos.x, y: newPos.y };
                    occupied.add(`${newPos.x},${newPos.y}`);
                    result.playerMoved = true;
                } else {
                    occupied.delete(`${playerPos.x},${playerPos.y}`);
                    let pos = { ...playerPos };
                    for (let i = 0; i < Math.min(dist - 1, 3); i++) {
                        const step = sceneGridService.stepToward(grid, pos, targetPos, occupied);
                        if (!step) break;
                        occupied.delete(`${pos.x},${pos.y}`);
                        pos = step;
                        occupied.add(`${pos.x},${pos.y}`);
                    }
                    if (pos.x !== playerPos.x || pos.y !== playerPos.y) {
                        plot.current_state.gridPosition = { x: pos.x, y: pos.y };
                        result.playerMoved = true;
                    }
                }

                // If target is an NPC, move them toward the player too (conversation proximity)
                if (targetPoi.type === 'npc' && dist > 2) {
                    const newPlayerPos = plot.current_state.gridPosition;
                    occupied.delete(`${targetPoi.gridPosition.x},${targetPoi.gridPosition.y}`);
                    let npcPos = { ...targetPoi.gridPosition };
                    for (let i = 0; i < 2; i++) {
                        const step = sceneGridService.stepToward(grid, npcPos, newPlayerPos, occupied);
                        if (!step) break;
                        occupied.delete(`${npcPos.x},${npcPos.y}`);
                        npcPos = step;
                        occupied.add(`${npcPos.x},${npcPos.y}`);
                    }
                    if (npcPos.x !== targetPoi.gridPosition.x || npcPos.y !== targetPoi.gridPosition.y) {
                        targetPoi.gridPosition = { x: npcPos.x, y: npcPos.y };
                        await targetPoi.save();
                        result.npcsMoved.push(targetPoi.name);
                    }
                }
            }
        } else if (wantsExit) {
            const doors = sceneGridService.findDoors(grid);
            if (doors.length > 0) {
                doors.sort((a, b) => {
                    const da = spatialService.manhattanDistance(playerPos.x, playerPos.y, a.x, a.y);
                    const db = spatialService.manhattanDistance(playerPos.x, playerPos.y, b.x, b.y);
                    return da - db;
                });
                const door = doors[0];
                const dist = spatialService.manhattanDistance(playerPos.x, playerPos.y, door.x, door.y);
                if (dist > 1) {
                    occupied.delete(`${playerPos.x},${playerPos.y}`);
                    const candidates = sceneGridService.findAdjacentWalkable(grid, door, playerPos, occupied);
                    if (candidates.length > 0) {
                        plot.current_state.gridPosition = { x: candidates[0].x, y: candidates[0].y };
                        result.playerMoved = true;
                    }
                }
            }
        } else if (directionDelta) {
            // Directional movement: "I walk north", "I walk a few paces to the northeast", etc.
            const { dx, dy, steps } = directionDelta;
            console.log(`[GridMovement] Directional: dx=${dx}, dy=${dy}, steps=${steps} from (${playerPos.x},${playerPos.y})`);
            occupied.delete(`${playerPos.x},${playerPos.y}`);

            let pos = { ...playerPos };
            for (let i = 0; i < steps; i++) {
                const next = stepInDirection(grid, pos, dx, dy, occupied);
                if (!next) {
                    console.log(`[GridMovement] Directional step ${i+1} blocked at (${pos.x},${pos.y})`);
                    break;
                }
                occupied.delete(`${pos.x},${pos.y}`);
                pos = next;
                occupied.add(`${pos.x},${pos.y}`);
            }

            if (pos.x !== playerPos.x || pos.y !== playerPos.y) {
                plot.current_state.gridPosition = { x: pos.x, y: pos.y };
                result.playerMoved = true;
                console.log(`[GridMovement] Directional move: (${playerPos.x},${playerPos.y})→(${pos.x},${pos.y})`);
            } else {
                console.log(`[GridMovement] Directional move failed — all steps blocked`);
            }
        }

        if (result.playerMoved || result.npcsMoved.length > 0) {
            plot.markModified('current_state.gridPosition');
            await plot.save();
            const pp = plot.current_state.gridPosition;
            console.log(`[GridMovement] Player→(${pp.x},${pp.y})${result.npcsMoved.length ? ', NPCs moved: ' + result.npcsMoved.join(', ') : ''}`);
        }

        return result;
    } catch (err) {
        console.error('[GridMovement] Error:', err.message);
        return { playerMoved: false, npcsMoved: [] };
    }
}

/**
 * Step one tile in a direction, with perpendicular fallbacks.
 * Unlike stepToward (which aims at a target), this prioritizes the requested
 * direction and tries nearby alternatives if blocked.
 *
 * Priority order for cardinal (e.g., east dx=1,dy=0):
 *   1. Direct: (x+1, y)
 *   2. Diagonal variants: (x+1, y-1), (x+1, y+1)
 *   3. Perpendicular: (x, y-1), (x, y+1)
 *
 * For diagonal (e.g., northeast dx=1,dy=-1):
 *   1. Direct: (x+1, y-1)
 *   2. Cardinal components: (x+1, y), (x, y-1)
 *   3. (skip perpendicular — already covered)
 */
function stepInDirection(grid, from, dx, dy, occupied) {
    const { WALKABLE_TILES } = require('./tileConstants');
    const h = grid.length;
    const w = grid[0]?.length || 0;

    const candidates = [];

    if (dx !== 0 && dy !== 0) {
        // Diagonal: try direct, then both cardinal components
        candidates.push({ x: from.x + dx, y: from.y + dy });
        candidates.push({ x: from.x + dx, y: from.y });
        candidates.push({ x: from.x, y: from.y + dy });
    } else if (dx !== 0) {
        // Horizontal: try direct, then diagonal, then perpendicular
        candidates.push({ x: from.x + dx, y: from.y });
        candidates.push({ x: from.x + dx, y: from.y - 1 });
        candidates.push({ x: from.x + dx, y: from.y + 1 });
        candidates.push({ x: from.x, y: from.y - 1 });
        candidates.push({ x: from.x, y: from.y + 1 });
    } else {
        // Vertical: try direct, then diagonal, then perpendicular
        candidates.push({ x: from.x, y: from.y + dy });
        candidates.push({ x: from.x - 1, y: from.y + dy });
        candidates.push({ x: from.x + 1, y: from.y + dy });
        candidates.push({ x: from.x - 1, y: from.y });
        candidates.push({ x: from.x + 1, y: from.y });
    }

    for (const c of candidates) {
        if (c.x >= 0 && c.x < w && c.y >= 0 && c.y < h &&
            WALKABLE_TILES.has(grid[c.y][c.x]) &&
            !occupied.has(`${c.x},${c.y}`)) {
            return c;
        }
    }
    return null;
}

/**
 * Parse directional movement from player input.
 * Matches patterns like "I walk north", "I move to the northeast",
 * "I walk a few paces to the southeast", etc.
 * @returns {{ dx: number, dy: number, steps: number } | null}
 */
function parseDirectionFromInput(inputLower) {
    // Direction keywords → grid deltas (grid y increases downward, so north = -y)
    const DIRECTIONS = {
        north:     { dx:  0, dy: -1 },
        south:     { dx:  0, dy:  1 },
        east:      { dx:  1, dy:  0 },
        west:      { dx: -1, dy:  0 },
        northeast: { dx:  1, dy: -1 },
        northwest: { dx: -1, dy: -1 },
        southeast: { dx:  1, dy:  1 },
        southwest: { dx: -1, dy:  1 },
    };

    // Must contain a movement verb
    const moveVerbs = ['walk', 'move', 'head', 'go', 'step', 'stroll', 'run', 'jog', 'wander', 'stride'];
    if (!moveVerbs.some(v => inputLower.includes(v))) return null;

    // Find direction (check compound directions first)
    let dir = null;
    for (const key of ['northeast', 'northwest', 'southeast', 'southwest', 'north', 'south', 'east', 'west']) {
        if (inputLower.includes(key)) {
            dir = DIRECTIONS[key];
            break;
        }
    }
    if (!dir) return null;

    // Determine step count from distance words
    let steps = 3; // default
    if (inputLower.includes('couple') || inputLower.includes('a step') || inputLower.includes('slightly')) steps = 2;
    else if (inputLower.includes('few paces') || inputLower.includes('few steps')) steps = 3;
    else if (inputLower.includes('several') || inputLower.includes('far') || inputLower.includes('across')) steps = 5;

    return { dx: dir.dx, dy: dir.dy, steps };
}

module.exports = { updateGridPositions };
