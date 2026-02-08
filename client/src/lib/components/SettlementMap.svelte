<script>
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal } from '../stores/modalStore.js';
  import { closeModal } from '../stores/modalStore.js';
  import { showToast } from '../stores/toastStore.js';
  import * as api from '../services/api.js';

  let { onAction } = $props();

  let mapData = $state(null);
  let loading = $state(false);
  let selectedLocation = $state(null);

  $effect(() => {
    if ($activeModal === 'settlementMap') loadMap();
  });

  async function loadMap() {
    loading = true;
    selectedLocation = null;
    try {
      mapData = await api.getLocation($plotId);
    } catch (e) {
      console.error('Error loading map:', e);
    } finally {
      loading = false;
    }
  }

  const DIRECTION_VECTORS = {
    north: { x: 0, y: -1 }, south: { x: 0, y: 1 },
    east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
    northeast: { x: 0.7, y: -0.7 }, northwest: { x: -0.7, y: -0.7 },
    southeast: { x: 0.7, y: 0.7 }, southwest: { x: -0.7, y: 0.7 },
  };

  const TYPE_COLORS = {
    gate: '#8B4513', market: '#DAA520', tavern: '#CD853F', temple: '#9370DB',
    plaza: '#4682B4', shop: '#B8860B', residence: '#708090', landmark: '#CD5C5C',
    dungeon: '#483D8B', district: '#6B8E23', docks: '#4169E1', barracks: '#A0522D',
    palace: '#9932CC', other: '#808080'
  };

  const TYPE_ICONS = {
    gate: '\uD83D\uDEAA', market: '\uD83C\uDFEA', tavern: '\uD83C\uDF7A', temple: '\u26EA',
    plaza: '\uD83C\uDFDB\uFE0F', shop: '\uD83D\uDED2', residence: '\uD83C\uDFE0', landmark: '\uD83D\uDDFF',
    dungeon: '\uD83D\uDD73\uFE0F', district: '\uD83C\uDFD8\uFE0F', docks: '\u2693', barracks: '\u2694\uFE0F',
    palace: '\uD83C\uDFF0', other: '\uD83D\uDCCD'
  };

  function handleLocationClick(loc) {
    if (loc.isCurrent) return;
    selectedLocation = loc;
  }

  async function handleMove(targetName) {
    closeModal();
    if (onAction) onAction(`I head to ${targetName}`);
  }

  function handleLook(targetName) {
    closeModal();
    if (onAction) onAction(`I look toward ${targetName}`);
  }
</script>

<Modal name="settlementMap" title={mapData?.settlement?.name || 'Settlement Map'}>
  {#if loading}
    <em>Loading map...</em>
  {:else if !mapData?.discoveredLocations?.length}
    <div class="map-placeholder">
      <p>No nearby locations discovered yet.</p>
      <p class="hint">Explore the settlement to reveal connections!</p>
    </div>
  {:else}
    <div class="local-view">
      <div class="current-header">
        <span>{TYPE_ICONS[mapData.location?.type] || '\uD83D\uDCCD'}</span>
        <h3>{mapData.location?.name || 'Unknown'}</h3>
        <p class="settlement-name">in {mapData.settlement?.name || 'Unknown'}</p>
      </div>

      <div class="locations-list">
        {#each mapData.discoveredLocations as loc}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="loc-card"
            class:current={loc.isCurrent}
            class:selected={selectedLocation?.name === loc.name}
            onclick={() => handleLocationClick(loc)}
          >
            <span class="loc-icon" style="color: {TYPE_COLORS[loc.type] || TYPE_COLORS.other}">
              {TYPE_ICONS[loc.type] || '\uD83D\uDCCD'}
            </span>
            <div class="loc-info">
              <span class="loc-name">{loc.name}</span>
              <span class="loc-type">{loc.type || 'other'}</span>
            </div>
            {#if loc.isCurrent}
              <span class="loc-badge current-badge">You are here</span>
            {/if}
          </div>
        {/each}
      </div>

      {#if selectedLocation}
        <div class="action-panel">
          <h4>{selectedLocation.name}</h4>
          <button class="action-btn primary" onclick={() => handleMove(selectedLocation.name)}>Go to {selectedLocation.name}</button>
          <button class="action-btn" onclick={() => handleLook(selectedLocation.name)}>Look toward {selectedLocation.name}</button>
        </div>
      {/if}

      <div class="discovered-count">{mapData.discoveredLocations.length} location{mapData.discoveredLocations.length !== 1 ? 's' : ''} discovered</div>
    </div>
  {/if}
</Modal>

<style>
  .map-placeholder { text-align: center; color: #999; padding: 40px; }
  .map-placeholder .hint { font-size: 12px; margin-top: 10px; color: #666; }

  .local-view { display: flex; flex-direction: column; gap: 16px; }
  .current-header { text-align: center; }
  .current-header h3 { color: var(--accent-gold); font-family: 'Crimson Text', serif; margin: 4px 0; }
  .settlement-name { color: #999; font-size: 0.85rem; }

  .locations-list { display: flex; flex-direction: column; gap: 6px; }
  .loc-card {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; background: var(--bg-input);
    border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
    cursor: pointer; transition: all 0.2s;
  }
  .loc-card:hover:not(.current) { border-color: var(--accent-gold); background: rgba(212, 175, 55, 0.08); }
  .loc-card.current { border-color: #4CAF50; cursor: default; }
  .loc-card.selected { border-color: var(--accent-indigo); background: rgba(99, 102, 241, 0.1); }
  .loc-icon { font-size: 1.2rem; }
  .loc-info { display: flex; flex-direction: column; }
  .loc-name { font-weight: 600; font-size: 0.9rem; color: var(--text-primary); }
  .loc-type { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; }
  .loc-badge { font-size: 0.7rem; margin-left: auto; padding: 2px 8px; border-radius: 8px; }
  .current-badge { background: rgba(76, 175, 80, 0.2); color: #4CAF50; }

  .action-panel { padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm); }
  .action-panel h4 { color: var(--accent-gold); margin: 0 0 8px; }
  .action-btn {
    display: block; width: 100%; padding: 10px 14px;
    background: var(--bg-input); color: #fff; border: 1px solid var(--border-subtle);
    border-radius: 6px; cursor: pointer; font-size: 0.9rem;
    text-align: left; transition: all 0.2s; margin-bottom: 6px;
  }
  .action-btn:hover { background: var(--accent-indigo); color: white; border-color: var(--accent-indigo); }
  .action-btn.primary { background: var(--accent-indigo); border-color: var(--accent-indigo); font-weight: 600; }
  .action-btn.primary:hover { background: #7c3aed; }

  .discovered-count { text-align: center; color: #666; font-size: 0.8rem; }
</style>
