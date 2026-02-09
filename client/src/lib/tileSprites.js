/**
 * tileSprites.js — Spritesheet coordinate mapping for Kenney Roguelike/RPG Pack
 *
 * Spritesheet: 968x526px, 16x16 tiles with 1px margin → 57 cols × 31 rows
 * Position formula: x = col * 17, y = row * 17
 *
 * Each TILE index (0-24) maps to { sx, sy } crop coordinates in the spritesheet.
 */

export const SPRITE_SIZE = 16;
export const SPRITE_MARGIN = 1;
export const SPRITE_STEP = 17; // 16 + 1 margin
export const SPRITESHEET = '/tiles/Spritesheet/roguelikeSheet_transparent.png';

// Helper: convert column,row to pixel coordinates
function pos(col, row) {
  return { sx: col * SPRITE_STEP, sy: row * SPRITE_STEP };
}

/**
 * Maps each TILE index to spritesheet crop coordinates.
 * Indices match TILE_DISPLAY in gridConstants.js and TILE in tileConstants.js.
 */
export const TILE_SPRITES = {
  0:  pos(0, 0),    // FLOOR — light stone floor tile (top-left area)
  1:  pos(17, 6),   // WALL — gray stone wall
  2:  pos(33, 4),   // DOOR — wooden door
  3:  pos(0, 2),    // WATER — water tile (blue area, top-left)
  4:  pos(42, 1),   // TABLE — wooden table
  5:  pos(43, 1),   // CHAIR — wooden chair
  6:  pos(41, 1),   // COUNTER — counter/bar surface
  7:  pos(44, 1),   // SHELF — bookshelf/shelf
  8:  pos(45, 1),   // BED — bed
  9:  pos(46, 3),   // ALTAR — altar/pedestal
  10: pos(19, 7),   // PILLAR — stone column
  11: pos(40, 1),   // STALL — market stall
  12: pos(48, 1),   // BARREL — barrel
  13: pos(49, 1),   // CRATE — crate/box
  14: pos(1, 0),    // CARPET — red/decorated floor
  15: pos(46, 4),   // THRONE — throne/chair
  16: pos(51, 4),   // FENCE — wooden fence
  17: pos(3, 2),    // PIER — wooden pier/bridge
  18: pos(18, 8),   // RUBBLE — broken stone
  19: pos(50, 3),   // STAIRS — staircase
  20: pos(47, 2),   // TORCH — wall torch
  21: pos(47, 3),   // FIREPLACE — fireplace/hearth
  22: pos(50, 1),   // WEAPON_RACK — weapon display
  23: pos(46, 2),   // FOUNTAIN — fountain
  24: pos(6, 4),    // GRASS — grass tile
};

/**
 * Tiles that are "furniture" — drawn on top of a floor tile.
 * The terrain layer draws floor underneath these, then furniture layer draws on top.
 */
export const FURNITURE_TILES = new Set([
  4,  // TABLE
  5,  // CHAIR
  6,  // COUNTER
  7,  // SHELF
  8,  // BED
  9,  // ALTAR
  10, // PILLAR
  11, // STALL
  12, // BARREL
  13, // CRATE
  15, // THRONE
  20, // TORCH
  21, // FIREPLACE
  22, // WEAPON_RACK
  23, // FOUNTAIN
]);
