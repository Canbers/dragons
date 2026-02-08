<script>
  import { onMount, tick } from 'svelte';
  import { Display } from 'rot-js';
  import { gridData } from '../stores/gridStore.js';
  import { showEntityMenu } from '../stores/entityMenuStore.js';
  import { TILE_DISPLAY, ENTITY_COLORS, AMBIENT_NPC_COLOR, getEntityChar } from '../gridConstants.js';

  let { onDoorClick } = $props();

  let containerEl = $state(null);
  let display = null;
  let entityMap = new Map();

  // Re-render when gridData changes
  $effect(() => {
    const data = $gridData;
    if (data?.grid && containerEl) {
      tick().then(() => render(data));
    }
  });

  // ResizeObserver for container resize
  onMount(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver(() => {
      if ($gridData?.grid) render($gridData);
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  function render(data) {
    if (!data?.grid || !containerEl) return;

    const { grid, width, height, playerPosition, entities, ambientNpcs, exits } = data;

    // Calculate font size to fit container
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const maxFontW = Math.floor(rect.width / width);
    const maxFontH = Math.floor(rect.height / height);
    const fontSize = Math.max(8, Math.min(22, Math.min(maxFontW, maxFontH)));

    // Clear previous
    containerEl.innerHTML = '';

    display = new Display({
      width,
      height,
      fontSize,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      bg: '#111',
    });

    const canvas = display.getContainer();
    if (canvas) containerEl.appendChild(canvas);

    // Build entity position map
    entityMap.clear();
    for (const entity of (entities || [])) {
      if (entity.gridPosition?.x != null) {
        entityMap.set(`${entity.gridPosition.x},${entity.gridPosition.y}`, entity);
      }
    }

    // Draw tiles
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileType = grid[y]?.[x] ?? 0;
        const td = TILE_DISPLAY[tileType] || TILE_DISPLAY[0];
        display.draw(x, y, td.char, td.fg, td.bg);
      }
    }

    // Ambient NPCs
    for (const amb of (ambientNpcs || [])) {
      const td = TILE_DISPLAY[grid[amb.y]?.[amb.x] ?? 0] || TILE_DISPLAY[0];
      display.draw(amb.x, amb.y, 'o', AMBIENT_NPC_COLOR, td.bg);
    }

    // Named entities
    for (const entity of (entities || [])) {
      if (entity.gridPosition?.x == null) continue;
      const { x, y } = entity.gridPosition;
      const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.other;
      const char = getEntityChar(entity);
      const td = TILE_DISPLAY[grid[y]?.[x] ?? 0] || TILE_DISPLAY[0];
      display.draw(x, y, char, color, td.bg);
    }

    // Player
    if (playerPosition?.x != null) {
      const td = TILE_DISPLAY[grid[playerPosition.y]?.[playerPosition.x] ?? 0] || TILE_DISPLAY[0];
      display.draw(playerPosition.x, playerPosition.y, '@', '#00FFFF', td.bg);
    }

    // Click handler
    if (canvas) {
      canvas.onclick = (e) => handleClick(e, data);
    }
  }

  function handleClick(e, data) {
    if (!display) return;
    const pos = display.eventToPosition(e);
    if (pos[0] < 0 || pos[1] < 0) return;

    const key = `${pos[0]},${pos[1]}`;
    const entity = entityMap.get(key);

    if (entity) {
      const entityType = entity.type === 'npc' ? 'npc' : 'object';
      showEntityMenu(e.clientX, e.clientY + 4, entity.name, entityType);
      return;
    }

    // Check door tile
    const tileType = data.grid[pos[1]]?.[pos[0]];
    if (tileType === 2 && onDoorClick) {
      const exit = findNearestExit(pos[0], pos[1], data);
      if (exit) onDoorClick(exit);
    }
  }

  function findNearestExit(x, y, data) {
    if (!data?.exits) return null;
    const { width, height } = data;

    let direction = null;
    if (y === 0) direction = 'north';
    else if (y === height - 1) direction = 'south';
    else if (x === 0) direction = 'west';
    else if (x === width - 1) direction = 'east';

    if (direction) {
      const match = data.exits.find(e => e.direction === direction);
      if (match) return match;
    }

    return data.exits[0] || null;
  }
</script>

<div class="grid-container" bind:this={containerEl}>
  {#if !$gridData?.grid}
    <p class="grid-placeholder">Grid will generate when you enter a location.</p>
  {/if}
</div>

<style>
  .grid-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;
    overflow: hidden;
    min-height: 0;
  }

  .grid-container :global(canvas) {
    image-rendering: pixelated;
  }

  .grid-placeholder {
    color: #666;
    font-style: italic;
    padding: 20px;
    text-align: center;
  }
</style>
