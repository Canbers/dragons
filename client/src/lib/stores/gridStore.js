import { writable } from 'svelte/store';

export const gridData = writable(null);
// gridData shape: { grid[][], width, height, playerPosition, entities[], ambientNpcs[], exits[] }
