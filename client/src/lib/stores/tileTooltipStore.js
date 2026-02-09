import { writable } from 'svelte/store';

export const tileTooltip = writable({
  visible: false,
  screenX: 0,
  screenY: 0,
  tileX: 0,
  tileY: 0,
  tileType: 0,
  tileName: '',
  walkable: false,
  entity: null,    // { id, name, type, description, disposition, icon } or null
  exit: null,      // { name, direction } or null
  ambientNpc: false,
  isPlayer: false
});

export function showTileTooltip(data) {
  tileTooltip.set({ visible: true, ...data });
}

export function hideTileTooltip() {
  tileTooltip.update(t => ({ ...t, visible: false }));
}
