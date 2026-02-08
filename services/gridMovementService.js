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
async function updateGridPositions(plotId, input, didMove, lookedUpNpcNames = []) {
    console.log(`[GridMovement] Called: input="${input?.substring(0, 40)}", didMove=${didMove}, lookedUpNpcs=${lookedUpNpcNames.join(',')}`);
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

        if (pois.length === 0) return { playerMoved: false, npcsMoved: [] };

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

        // Also check for exit/door keywords
        const exitKeywords = ['door', 'exit', 'leave', 'outside', 'entrance'];
        const wantsExit = exitKeywords.some(kw => inputLower.includes(kw));

        if (targetPoi) {
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

module.exports = { updateGridPositions };
