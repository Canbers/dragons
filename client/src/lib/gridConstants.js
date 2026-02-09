/**
 * gridConstants.js — Tile display and entity colors for rot.js grid
 * Mirrors backend tileConstants.js
 */

export const TILE_DISPLAY = {
  0:  { char: '.', fg: '#555555', bg: '#1a1a1a', name: 'Stone Floor' },    // FLOOR
  1:  { char: '#', fg: '#888888', bg: '#333333', name: 'Stone Wall' },     // WALL
  2:  { char: '+', fg: '#CD853F', bg: '#1a1a1a', name: 'Wooden Door' },   // DOOR
  3:  { char: '~', fg: '#4682B4', bg: '#1a2a3a', name: 'Water' },         // WATER
  4:  { char: 'T', fg: '#8B6914', bg: '#1a1a1a', name: 'Table' },         // TABLE
  5:  { char: 'h', fg: '#8B6914', bg: '#1a1a1a', name: 'Chair' },         // CHAIR
  6:  { char: '=', fg: '#A0522D', bg: '#1a1a1a', name: 'Counter' },       // COUNTER
  7:  { char: '[', fg: '#8B7355', bg: '#1a1a1a', name: 'Shelf' },         // SHELF
  8:  { char: 'b', fg: '#6B4226', bg: '#2a1a1a', name: 'Bed' },           // BED
  9:  { char: 'A', fg: '#FFD700', bg: '#1a1a2a', name: 'Altar' },         // ALTAR
  10: { char: 'O', fg: '#999999', bg: '#1a1a1a', name: 'Stone Pillar' },  // PILLAR
  11: { char: 'S', fg: '#DAA520', bg: '#1a1a1a', name: 'Market Stall' },  // STALL
  12: { char: 'o', fg: '#8B4513', bg: '#1a1a1a', name: 'Barrel' },        // BARREL
  13: { char: 'x', fg: '#A0522D', bg: '#1a1a1a', name: 'Crate' },         // CRATE
  14: { char: '.', fg: '#8B0000', bg: '#2a1010', name: 'Carpet' },         // CARPET
  15: { char: 'W', fg: '#FFD700', bg: '#1a1a2a', name: 'Throne' },        // THRONE
  16: { char: '%', fg: '#8B7355', bg: '#1a1a1a', name: 'Fence' },         // FENCE
  17: { char: '=', fg: '#8B7355', bg: '#1a2a3a', name: 'Pier' },          // PIER
  18: { char: ',', fg: '#666666', bg: '#1a1a1a', name: 'Rubble' },        // RUBBLE
  19: { char: '>', fg: '#CCCCCC', bg: '#1a1a1a', name: 'Stairs' },        // STAIRS
  20: { char: '!', fg: '#FF8C00', bg: '#1a1a1a', name: 'Wall Torch' },    // TORCH
  21: { char: 'f', fg: '#FF4500', bg: '#2a1a0a', name: 'Fireplace' },     // FIREPLACE
  22: { char: '/', fg: '#AAAAAA', bg: '#1a1a1a', name: 'Weapon Rack' },   // WEAPON_RACK
  23: { char: '{', fg: '#87CEEB', bg: '#1a1a2a', name: 'Fountain' },      // FOUNTAIN
  24: { char: '"', fg: '#228B22', bg: '#0a1a0a', name: 'Grass' },         // GRASS
};

export const ENTITY_COLORS = {
  npc:       '#FFD700',
  object:    '#9370DB',
  danger:    '#FF0000',
  shop:      '#00FF00',
  quest:     '#FF00FF',
  entrance:  '#20B2AA',
  landmark:  '#FFD700',
  other:     '#AAAAAA',
};

export const AMBIENT_NPC_COLOR = '#555566';

// Tiles the player can walk on (used by tooltip to decide "Move here" vs info-only)
export const WALKABLE_TILES = new Set([0, 2, 14, 24, 19, 18, 17]);

// Animation frame colors for animated tile types
export const ANIMATED_TILES = {
  20: { frames: ['#FF8C00', '#FFB347', '#FF6600', '#FFCC00'] },  // TORCH
  21: { frames: ['#FF4500', '#FF6347', '#FF2200', '#FF8C00'] },  // FIREPLACE
  3:  { frames: ['#4682B4', '#5B9BD5', '#3A75A8', '#6CA6CD'] },  // WATER
  23: { frames: ['#87CEEB', '#ADD8E6', '#7EC8E3', '#B0E0E6'] },  // FOUNTAIN
};

export const PLAYER_PULSE = ['#00FFFF', '#00E5E5', '#00CCCC', '#00E5E5'];

export function getEntityChar(entity) {
  if (entity.type === 'npc' || entity.type === 'quest') {
    return entity.name ? entity.name.charAt(0).toUpperCase() : '?';
  }
  if (entity.type === 'object') return '!';
  if (entity.type === 'danger') return '!';
  if (entity.type === 'shop') return '$';
  if (entity.type === 'entrance') return '>';
  if (entity.type === 'landmark') return '*';
  return '?';
}

/**
 * Get a natural-language direction phrase from one grid position to another.
 * Used by click-to-move to generate AI-understandable movement text.
 * e.g., "a few paces to the northeast"
 */
export function getDirectionPhrase(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));

  let distWord;
  if (dist <= 2) distWord = 'a couple of paces';
  else if (dist <= 5) distWord = 'a few paces';
  else distWord = 'several paces';

  let dir = '';
  if (dy < 0) dir += 'north';
  else if (dy > 0) dir += 'south';
  if (dx < 0) dir += 'west';
  else if (dx > 0) dir += 'east';

  if (!dir) return 'in place';
  return `${distWord} to the ${dir}`;
}
