/**
 * gridConstants.js — Tile display and entity colors for rot.js grid
 * Mirrors backend tileConstants.js
 */

export const TILE_DISPLAY = {
  0:  { char: '.', fg: '#555555', bg: '#1a1a1a' }, // FLOOR
  1:  { char: '#', fg: '#888888', bg: '#333333' }, // WALL
  2:  { char: '+', fg: '#CD853F', bg: '#1a1a1a' }, // DOOR
  3:  { char: '~', fg: '#4682B4', bg: '#1a2a3a' }, // WATER
  4:  { char: 'T', fg: '#8B6914', bg: '#1a1a1a' }, // TABLE
  5:  { char: 'h', fg: '#8B6914', bg: '#1a1a1a' }, // CHAIR
  6:  { char: '=', fg: '#A0522D', bg: '#1a1a1a' }, // COUNTER
  7:  { char: '[', fg: '#8B7355', bg: '#1a1a1a' }, // SHELF
  8:  { char: 'b', fg: '#6B4226', bg: '#2a1a1a' }, // BED
  9:  { char: 'A', fg: '#FFD700', bg: '#1a1a2a' }, // ALTAR
  10: { char: 'O', fg: '#999999', bg: '#1a1a1a' }, // PILLAR
  11: { char: 'S', fg: '#DAA520', bg: '#1a1a1a' }, // STALL
  12: { char: 'o', fg: '#8B4513', bg: '#1a1a1a' }, // BARREL
  13: { char: 'x', fg: '#A0522D', bg: '#1a1a1a' }, // CRATE
  14: { char: '.', fg: '#8B0000', bg: '#2a1010' }, // CARPET
  15: { char: 'W', fg: '#FFD700', bg: '#1a1a2a' }, // THRONE
  16: { char: '%', fg: '#8B7355', bg: '#1a1a1a' }, // FENCE
  17: { char: '=', fg: '#8B7355', bg: '#1a2a3a' }, // PIER
  18: { char: ',', fg: '#666666', bg: '#1a1a1a' }, // RUBBLE
  19: { char: '>', fg: '#CCCCCC', bg: '#1a1a1a' }, // STAIRS
  20: { char: '!', fg: '#FF8C00', bg: '#1a1a1a' }, // TORCH
  21: { char: 'f', fg: '#FF4500', bg: '#2a1a0a' }, // FIREPLACE
  22: { char: '/', fg: '#AAAAAA', bg: '#1a1a1a' }, // WEAPON_RACK
  23: { char: '{', fg: '#87CEEB', bg: '#1a1a2a' }, // FOUNTAIN
  24: { char: '"', fg: '#228B22', bg: '#0a1a0a' }, // GRASS
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
