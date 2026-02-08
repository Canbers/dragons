/**
 * tileConstants.js — Tile type enum, display chars/colors, walkability
 * Shared between backend grid generators and frontend renderer.
 */

// Tile type enum (stored as integers in the grid)
const TILE = {
    FLOOR: 0,
    WALL: 1,
    DOOR: 2,
    WATER: 3,
    TABLE: 4,
    CHAIR: 5,
    COUNTER: 6,
    SHELF: 7,
    BED: 8,
    ALTAR: 9,
    PILLAR: 10,
    STALL: 11,
    BARREL: 12,
    CRATE: 13,
    CARPET: 14,
    THRONE: 15,
    FENCE: 16,
    PIER: 17,
    RUBBLE: 18,
    STAIRS: 19,
    TORCH: 20,
    FIREPLACE: 21,
    WEAPON_RACK: 22,
    FOUNTAIN: 23,
    GRASS: 24,
};

// Display data for each tile type: { char, fg, bg }
const TILE_DISPLAY = {
    [TILE.FLOOR]:        { char: '.', fg: '#555555', bg: '#1a1a1a' },
    [TILE.WALL]:         { char: '#', fg: '#888888', bg: '#333333' },
    [TILE.DOOR]:         { char: '+', fg: '#CD853F', bg: '#1a1a1a' },
    [TILE.WATER]:        { char: '~', fg: '#4682B4', bg: '#1a2a3a' },
    [TILE.TABLE]:        { char: 'T', fg: '#8B6914', bg: '#1a1a1a' },
    [TILE.CHAIR]:        { char: 'h', fg: '#8B6914', bg: '#1a1a1a' },
    [TILE.COUNTER]:      { char: '=', fg: '#A0522D', bg: '#1a1a1a' },
    [TILE.SHELF]:        { char: '[', fg: '#8B7355', bg: '#1a1a1a' },
    [TILE.BED]:          { char: 'b', fg: '#6B4226', bg: '#2a1a1a' },
    [TILE.ALTAR]:        { char: 'A', fg: '#FFD700', bg: '#1a1a2a' },
    [TILE.PILLAR]:       { char: 'O', fg: '#999999', bg: '#1a1a1a' },
    [TILE.STALL]:        { char: 'S', fg: '#DAA520', bg: '#1a1a1a' },
    [TILE.BARREL]:       { char: 'o', fg: '#8B4513', bg: '#1a1a1a' },
    [TILE.CRATE]:        { char: 'x', fg: '#A0522D', bg: '#1a1a1a' },
    [TILE.CARPET]:       { char: '.', fg: '#8B0000', bg: '#2a1010' },
    [TILE.THRONE]:       { char: 'W', fg: '#FFD700', bg: '#1a1a2a' },
    [TILE.FENCE]:        { char: '%', fg: '#8B7355', bg: '#1a1a1a' },
    [TILE.PIER]:         { char: '=', fg: '#8B7355', bg: '#1a2a3a' },
    [TILE.RUBBLE]:       { char: ',', fg: '#666666', bg: '#1a1a1a' },
    [TILE.STAIRS]:       { char: '>', fg: '#CCCCCC', bg: '#1a1a1a' },
    [TILE.TORCH]:        { char: '!', fg: '#FF8C00', bg: '#1a1a1a' },
    [TILE.FIREPLACE]:    { char: 'f', fg: '#FF4500', bg: '#2a1a0a' },
    [TILE.WEAPON_RACK]:  { char: '/', fg: '#AAAAAA', bg: '#1a1a1a' },
    [TILE.FOUNTAIN]:     { char: '{', fg: '#87CEEB', bg: '#1a1a2a' },
    [TILE.GRASS]:        { char: '"', fg: '#228B22', bg: '#0a1a0a' },
};

// Tiles the player and NPCs can walk on
const WALKABLE_TILES = new Set([
    TILE.FLOOR, TILE.DOOR, TILE.CARPET, TILE.GRASS,
    TILE.STAIRS, TILE.RUBBLE, TILE.PIER,
]);

// Entity display overrides (rendered on top of tiles)
const ENTITY_DISPLAY = {
    player:    { char: '@', fg: '#00FFFF' },
    npc:       { fg: '#FFD700' },       // char = first letter of name
    object:    { char: '!', fg: '#9370DB' },
    danger:    { char: '!', fg: '#FF0000' },
    shop:      { char: '$', fg: '#00FF00' },
    quest:     { fg: '#FF00FF' },       // char = first letter of name
    entrance:  { char: '>', fg: '#20B2AA' },
    landmark:  { char: '*', fg: '#FFD700' },
    other:     { char: '?', fg: '#AAAAAA' },
};

module.exports = { TILE, TILE_DISPLAY, WALKABLE_TILES, ENTITY_DISPLAY };
