import { writable } from 'svelte/store';

export const entityMenu = writable({
  visible: false,
  x: 0,
  y: 0,
  name: '',
  type: '' // 'npc' | 'object' | 'location'
});

export function showEntityMenu(x, y, name, type) {
  entityMenu.set({ visible: true, x, y, name, type });
}

export function hideEntityMenu() {
  entityMenu.update(m => ({ ...m, visible: false }));
}
