import { writable } from 'svelte/store';

export const sceneContext = writable(null);
// sceneContext shape: { summary, tension, npcsPresent[], activeEvents[], playerGoal, recentOutcomes[], turnCount }

export const sceneEntities = writable(null);
// sceneEntities shape: { npcs[], objects[], features[], locations[], exits[], currentLocation }
