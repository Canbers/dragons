import { writable } from 'svelte/store';

/**
 * Settlement data for the overview map.
 * Shape matches the response from api.getLocation(plotId).
 */
export const settlementData = writable(null);

/**
 * Travel state — tracks in-progress travel between locations.
 */
export const travelState = writable({
  traveling: false,
  targetName: null
});
