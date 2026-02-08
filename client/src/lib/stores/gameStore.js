import { writable, derived } from 'svelte/store';

export const plotId = writable(null);
export const characterId = writable(null);
export const token = writable(localStorage.getItem('authToken'));
export const character = writable(null);
export const plot = writable(null);

// Derived from plot
export const location = derived(plot, ($plot) => {
  const cs = $plot?.current_state;
  if (!cs?.current_location) return { name: 'Unknown', description: '' };
  if (cs.current_location.settlement) {
    return {
      name: cs.current_location.locationName || 'Unknown',
      description: cs.current_location.locationDescription || '',
      settlement: cs.current_location.settlement
    };
  }
  const regionName = cs.current_location.region?.name || 'Unknown Region';
  return {
    name: `Wilderness of ${regionName}`,
    description: cs.current_location.description || ''
  };
});

export const currentActivity = derived(plot, ($plot) =>
  $plot?.current_state?.current_activity || 'Unknown'
);

export const currentTime = derived(plot, ($plot) =>
  $plot?.current_state?.current_time || 'Unknown'
);

export const conditions = derived(plot, ($plot) =>
  $plot?.current_state?.environment_conditions || 'Unknown'
);

export const actions = writable({
  categorized: null,
  suggested: []
});
