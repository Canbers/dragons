<script>
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal, closeModal } from '../stores/modalStore.js';
  import { travelState } from '../stores/settlementStore.js';
  import { travelTo } from '../services/travelService.js';
  import * as api from '../services/api.js';

  let mapData = $state(null);
  let loading = $state(false);
  let selectedLocation = $state(null);

  // SVG layout
  let viewBox = $state('0 0 400 300');
  let locationNodes = $state([]);
  let connectionLines = $state([]);

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

  $effect(() => {
    if ($activeModal === 'settlementMap') loadMap();
  });

  async function loadMap() {
    loading = true;
    selectedLocation = null;
    try {
      mapData = await api.getLocation($plotId);
      if (mapData?.discoveredLocations?.length) {
        buildGraph(mapData.discoveredLocations);
      }
    } catch (e) {
      console.error('Error loading map:', e);
    } finally {
      loading = false;
    }
  }

  function buildGraph(locations) {
    if (!locations.length) return;

    // Use layout coordinates from backend
    const SCALE = 60;
    const PADDING = 50;
    const NODE_RADIUS = 18;

    // Compute positions — use coordinates if available, otherwise spread evenly
    const nodes = locations.map((loc, i) => {
      const cx = loc.coordinates?.x != null ? loc.coordinates.x * SCALE : (i % 5) * SCALE;
      const cy = loc.coordinates?.y != null ? loc.coordinates.y * SCALE : Math.floor(i / 5) * SCALE;
      return { ...loc, cx, cy, r: NODE_RADIUS };
    });

    // Compute viewBox from node bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.cx);
      minY = Math.min(minY, n.cy);
      maxX = Math.max(maxX, n.cx);
      maxY = Math.max(maxY, n.cy);
    }

    const vbX = minX - PADDING;
    const vbY = minY - PADDING;
    const vbW = Math.max(200, (maxX - minX) + PADDING * 2);
    const vbH = Math.max(150, (maxY - minY) + PADDING * 2);
    viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

    // Build connection lines (only between discovered locations)
    const lines = [];
    const nodeMap = new Map(nodes.map(n => [n.id?.toString(), n]));

    for (const node of nodes) {
      for (const conn of (node.connections || [])) {
        if (!conn.targetDiscovered || !conn.targetId) continue;
        const target = nodeMap.get(conn.targetId.toString());
        if (!target) continue;

        // Avoid duplicate lines (A→B and B→A)
        const lineKey = [node.id, target.id].sort().join('-');
        if (lines.some(l => l.key === lineKey)) continue;

        lines.push({
          key: lineKey,
          x1: node.cx, y1: node.cy,
          x2: target.cx, y2: target.cy,
          dashed: conn.distance === 'far'
        });
      }
    }

    locationNodes = nodes;
    connectionLines = lines;
  }

  function handleNodeClick(loc) {
    if (loc.isCurrent) return;
    selectedLocation = loc;
  }

  async function handleTravel() {
    if (!selectedLocation) return;
    closeModal();
    await travelTo(selectedLocation.id, selectedLocation.name);
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
    <div class="overview">
      <div class="current-header">
        <span>{TYPE_ICONS[mapData.location?.type] || '\uD83D\uDCCD'}</span>
        <h3>{mapData.location?.name || 'Unknown'}</h3>
        <p class="settlement-name">in {mapData.settlement?.name || 'Unknown'}</p>
      </div>

      <div class="svg-container">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <svg {viewBox} preserveAspectRatio="xMidYMid meet">
          <!-- Connection lines -->
          {#each connectionLines as line}
            <line
              x1={line.x1} y1={line.y1}
              x2={line.x2} y2={line.y2}
              class="connection-line"
              class:dashed={line.dashed}
            />
          {/each}

          <!-- Location nodes -->
          {#each locationNodes as loc}
            <g
              class="node"
              class:current={loc.isCurrent}
              class:selected={selectedLocation?.id === loc.id}
              onclick={() => handleNodeClick(loc)}
            >
              <circle
                cx={loc.cx} cy={loc.cy} r={loc.r}
                fill={TYPE_COLORS[loc.type] || TYPE_COLORS.other}
                class="node-circle"
              />
              {#if loc.isCurrent}
                <circle
                  cx={loc.cx} cy={loc.cy} r={loc.r + 4}
                  fill="none" stroke="#4CAF50" stroke-width="2"
                  class="current-ring"
                />
              {/if}
              {#if selectedLocation?.id === loc.id}
                <circle
                  cx={loc.cx} cy={loc.cy} r={loc.r + 4}
                  fill="none" stroke="var(--accent-indigo, #6366f1)" stroke-width="2"
                />
              {/if}
              <text
                x={loc.cx} y={loc.cy + loc.r + 12}
                class="node-label"
                text-anchor="middle"
              >{loc.name}</text>
              {#if loc.isCurrent}
                <text
                  x={loc.cx} y={loc.cy + 4}
                  class="you-label"
                  text-anchor="middle"
                >YOU</text>
              {:else}
                <text
                  x={loc.cx} y={loc.cy + 5}
                  class="icon-label"
                  text-anchor="middle"
                >{TYPE_ICONS[loc.type] || ''}</text>
              {/if}
            </g>
          {/each}
        </svg>
      </div>

      {#if selectedLocation}
        <div class="action-panel">
          <h4>{selectedLocation.name}</h4>
          {#if selectedLocation.shortDescription}
            <p class="loc-desc">{selectedLocation.shortDescription}</p>
          {/if}
          <button class="travel-btn" onclick={handleTravel} disabled={$travelState.traveling}>
            {$travelState.traveling ? 'Traveling...' : `Travel to ${selectedLocation.name}`}
          </button>
        </div>
      {/if}

      <div class="discovered-count">
        {mapData.discoveredLocations.length} location{mapData.discoveredLocations.length !== 1 ? 's' : ''} discovered
      </div>
    </div>
  {/if}
</Modal>

<style>
  .map-placeholder { text-align: center; color: #999; padding: 40px; }
  .map-placeholder .hint { font-size: 12px; margin-top: 10px; color: #666; }

  .overview { display: flex; flex-direction: column; gap: 12px; }
  .current-header { text-align: center; }
  .current-header h3 { color: var(--accent-gold); font-family: 'Crimson Text', serif; margin: 4px 0; }
  .settlement-name { color: #999; font-size: 0.85rem; }

  .svg-container {
    width: 100%;
    min-height: 200px;
    max-height: 350px;
    background: #0a0a0a;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .svg-container svg {
    width: 100%;
    height: 100%;
    min-height: 200px;
  }

  .connection-line {
    stroke: #444;
    stroke-width: 1.5;
  }
  .connection-line.dashed {
    stroke-dasharray: 4 3;
    stroke: #333;
  }

  .node { cursor: pointer; }
  .node.current { cursor: default; }

  .node-circle {
    stroke: #222;
    stroke-width: 1;
    opacity: 0.85;
    transition: opacity 0.2s;
  }
  .node:hover .node-circle { opacity: 1; }

  .current-ring {
    animation: pulse-ring 2s ease-in-out infinite;
  }

  .node-label {
    fill: #ccc;
    font-size: 8px;
    font-family: 'Crimson Text', serif;
    pointer-events: none;
  }

  .you-label {
    fill: #4CAF50;
    font-size: 7px;
    font-weight: bold;
    font-family: sans-serif;
    pointer-events: none;
  }

  .icon-label {
    font-size: 12px;
    pointer-events: none;
  }

  .action-panel {
    padding: 12px;
    background: var(--bg-input);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }
  .action-panel h4 { color: var(--accent-gold); margin: 0 0 6px; }
  .loc-desc { color: #999; font-size: 0.8rem; margin: 0 0 8px; }

  .travel-btn {
    width: 100%;
    padding: 10px 14px;
    background: var(--accent-indigo, #6366f1);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    transition: background 0.2s;
  }
  .travel-btn:hover:not(:disabled) { background: #7c3aed; }
  .travel-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .discovered-count { text-align: center; color: #666; font-size: 0.8rem; }

  @keyframes pulse-ring {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
