<script>
  import { onMount, tick } from 'svelte';
  import Konva from 'konva';
  import { gridData } from '../stores/gridStore.js';
  import { showTileTooltip } from '../stores/tileTooltipStore.js';
  import {
    TILE_DISPLAY, ENTITY_COLORS, AMBIENT_NPC_COLOR, getEntityChar,
    WALKABLE_TILES, ANIMATED_TILES, PLAYER_PULSE
  } from '../gridConstants.js';
  import { TILE_SPRITES, FURNITURE_TILES, SPRITE_SIZE, SPRITESHEET } from '../tileSprites.js';

  let containerEl = $state(null);
  let stage = null;
  let terrainLayer = null;
  let furnitureLayer = null;
  let entityLayer = null;
  let uiLayer = null;
  let animationInterval = null;
  let animFrame = 0;
  let animatedNodes = [];  // { node, tileType } for tile animations
  let playerNode = null;
  let lastRenderData = null;
  let spriteImage = null;
  let spriteLoaded = false;

  // Lookup maps rebuilt each render
  let entityMap = new Map();
  let ambientNpcSet = new Set();
  let doorExitMap = new Map();

  // Load spritesheet
  function loadSpritesheet() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        spriteImage = img;
        spriteLoaded = true;
        resolve(true);
      };
      img.onerror = () => {
        console.warn('[SceneGrid] Spritesheet failed to load, using colored rectangles');
        resolve(false);
      };
      img.src = SPRITESHEET;
    });
  }

  // Re-render when gridData changes
  $effect(() => {
    const data = $gridData;
    if (data?.grid && containerEl) {
      tick().then(() => render(data));
    }
  });

  onMount(() => {
    if (!containerEl) return;

    // Load spritesheet in background
    loadSpritesheet().then(() => {
      if ($gridData?.grid) render($gridData);
    });

    const observer = new ResizeObserver(() => {
      if ($gridData?.grid) render($gridData);
    });
    observer.observe(containerEl);

    return () => {
      observer.disconnect();
      if (animationInterval) clearInterval(animationInterval);
      if (stage) { stage.destroy(); stage = null; }
    };
  });

  function render(data) {
    if (!data?.grid || !containerEl) return;
    lastRenderData = data;

    const { grid, width, height, playerPosition, entities, ambientNpcs, exits } = data;
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Calculate tile size to fit container
    const tileSize = Math.max(8, Math.min(48, Math.floor(Math.min(rect.width / width, rect.height / height))));
    const stageW = width * tileSize;
    const stageH = height * tileSize;

    // Clean up previous stage
    if (animationInterval) { clearInterval(animationInterval); animationInterval = null; }
    if (stage) { stage.destroy(); stage = null; }

    stage = new Konva.Stage({
      container: containerEl,
      width: stageW,
      height: stageH,
    });

    terrainLayer = new Konva.Layer({ listening: false });
    furnitureLayer = new Konva.Layer({ listening: false });
    entityLayer = new Konva.Layer();
    uiLayer = new Konva.Layer({ listening: false });

    stage.add(terrainLayer);
    stage.add(furnitureLayer);
    stage.add(entityLayer);
    stage.add(uiLayer);

    // Build lookup maps
    entityMap.clear();
    for (const entity of (entities || [])) {
      if (entity.gridPosition?.x != null) {
        entityMap.set(`${entity.gridPosition.x},${entity.gridPosition.y}`, entity);
      }
    }

    ambientNpcSet.clear();
    for (const amb of (ambientNpcs || [])) {
      ambientNpcSet.add(`${amb.x},${amb.y}`);
    }

    doorExitMap.clear();
    if (exits?.length) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (grid[y]?.[x] === 2) {
            const exit = findNearestExit(x, y, data);
            if (exit) doorExitMap.set(`${x},${y}`, exit);
          }
        }
      }
    }

    // Collect animated tiles
    animatedNodes = [];
    playerNode = null;

    // Draw terrain + furniture
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileType = grid[y]?.[x] ?? 0;
        const td = TILE_DISPLAY[tileType] || TILE_DISPLAY[0];
        const isFurniture = FURNITURE_TILES.has(tileType);

        if (spriteLoaded) {
          // Sprite rendering
          const floorSprite = TILE_SPRITES[0]; // floor tile for underneath furniture
          const tileSprite = TILE_SPRITES[tileType] || TILE_SPRITES[0];

          if (isFurniture) {
            // Draw floor underneath
            terrainLayer.add(new Konva.Image({
              x: x * tileSize, y: y * tileSize,
              width: tileSize, height: tileSize,
              image: spriteImage,
              crop: { x: floorSprite.sx, y: floorSprite.sy, width: SPRITE_SIZE, height: SPRITE_SIZE },
              imageSmoothingEnabled: false,
            }));
            // Draw furniture on furniture layer
            const furNode = new Konva.Image({
              x: x * tileSize, y: y * tileSize,
              width: tileSize, height: tileSize,
              image: spriteImage,
              crop: { x: tileSprite.sx, y: tileSprite.sy, width: SPRITE_SIZE, height: SPRITE_SIZE },
              imageSmoothingEnabled: false,
            });
            furnitureLayer.add(furNode);
          } else {
            terrainLayer.add(new Konva.Image({
              x: x * tileSize, y: y * tileSize,
              width: tileSize, height: tileSize,
              image: spriteImage,
              crop: { x: tileSprite.sx, y: tileSprite.sy, width: SPRITE_SIZE, height: SPRITE_SIZE },
              imageSmoothingEnabled: false,
            }));
          }

          // Animation overlay for animated tiles (on UI layer)
          const key = `${x},${y}`;
          if (ANIMATED_TILES[tileType] && !entityMap.has(key) && !ambientNpcSet.has(key)) {
            const overlay = new Konva.Rect({
              x: x * tileSize, y: y * tileSize,
              width: tileSize, height: tileSize,
              fill: ANIMATED_TILES[tileType].frames[0],
              opacity: 0.3,
            });
            uiLayer.add(overlay);
            animatedNodes.push({ node: overlay, tileType, mode: 'overlay' });
          }
        } else {
          // Colored rectangle fallback
          terrainLayer.add(new Konva.Rect({
            x: x * tileSize, y: y * tileSize,
            width: tileSize, height: tileSize,
            fill: td.bg,
          }));
          const textNode = new Konva.Text({
            x: x * tileSize, y: y * tileSize,
            width: tileSize, height: tileSize,
            text: td.char,
            fontSize: Math.max(8, tileSize - 4),
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fill: td.fg,
            align: 'center',
            verticalAlign: 'middle',
          });
          const layer = isFurniture ? furnitureLayer : terrainLayer;
          layer.add(textNode);

          // Track animated tiles for color cycling
          const key = `${x},${y}`;
          if (ANIMATED_TILES[tileType] && !entityMap.has(key) && !ambientNpcSet.has(key)) {
            animatedNodes.push({ node: textNode, tileType, mode: 'text' });
          }
        }
      }
    }

    // Cache terrain + furniture layers (static content)
    terrainLayer.cache();
    furnitureLayer.cache();

    // Draw ambient NPCs on entity layer
    for (const amb of (ambientNpcs || [])) {
      const td = TILE_DISPLAY[grid[amb.y]?.[amb.x] ?? 0] || TILE_DISPLAY[0];
      if (spriteLoaded) {
        // Draw floor tile background
        entityLayer.add(new Konva.Rect({
          x: amb.x * tileSize, y: amb.y * tileSize,
          width: tileSize, height: tileSize,
          fill: '#1a1a1a',
        }));
      }
      entityLayer.add(new Konva.Text({
        x: amb.x * tileSize, y: amb.y * tileSize,
        width: tileSize, height: tileSize,
        text: 'o',
        fontSize: Math.max(8, tileSize - 4),
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fill: AMBIENT_NPC_COLOR,
        align: 'center',
        verticalAlign: 'middle',
      }));
    }

    // Draw named entities on entity layer
    for (const entity of (entities || [])) {
      if (entity.gridPosition?.x == null) continue;
      const { x, y } = entity.gridPosition;
      const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.other;
      const char = getEntityChar(entity);
      const td = TILE_DISPLAY[grid[y]?.[x] ?? 0] || TILE_DISPLAY[0];

      // Background rect
      entityLayer.add(new Konva.Rect({
        x: x * tileSize, y: y * tileSize,
        width: tileSize, height: tileSize,
        fill: spriteLoaded ? '#1a1a1a' : td.bg,
      }));
      entityLayer.add(new Konva.Text({
        x: x * tileSize, y: y * tileSize,
        width: tileSize, height: tileSize,
        text: char,
        fontSize: Math.max(8, tileSize - 2),
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fill: color,
        fontStyle: 'bold',
        align: 'center',
        verticalAlign: 'middle',
      }));
    }

    // Draw player on entity layer
    if (playerPosition?.x != null) {
      const td = TILE_DISPLAY[grid[playerPosition.y]?.[playerPosition.x] ?? 0] || TILE_DISPLAY[0];
      entityLayer.add(new Konva.Rect({
        x: playerPosition.x * tileSize, y: playerPosition.y * tileSize,
        width: tileSize, height: tileSize,
        fill: spriteLoaded ? '#1a1a1a' : td.bg,
      }));
      const pNode = new Konva.Text({
        x: playerPosition.x * tileSize, y: playerPosition.y * tileSize,
        width: tileSize, height: tileSize,
        text: '@',
        fontSize: Math.max(8, tileSize - 2),
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fill: '#00FFFF',
        fontStyle: 'bold',
        align: 'center',
        verticalAlign: 'middle',
      });
      entityLayer.add(pNode);
      playerNode = pNode;
    }

    // Click handler on stage
    stage.on('click tap', (e) => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const gridX = Math.floor(pointer.x / tileSize);
      const gridY = Math.floor(pointer.y / tileSize);
      if (gridX < 0 || gridY < 0 || gridX >= width || gridY >= height) return;

      // Get the DOM event for screen coordinates
      const domEvent = e.evt;
      handleClick(gridX, gridY, domEvent, data);
    });

    // Set pixelated rendering on canvas elements
    const canvases = containerEl.querySelectorAll('canvas');
    for (const canvas of canvases) {
      canvas.style.imageRendering = 'pixelated';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.imageSmoothingEnabled = false;
    }

    // Draw all layers
    stage.draw();

    // Start animation loop
    if (animatedNodes.length > 0 || playerNode) {
      animFrame = 0;
      animationInterval = setInterval(() => drawAnimationFrame(), 300);
    }
  }

  function drawAnimationFrame() {
    if (!stage) return;
    animFrame = (animFrame + 1) % 4;

    // Animate tiles
    for (const { node, tileType, mode } of animatedNodes) {
      const anim = ANIMATED_TILES[tileType];
      if (mode === 'overlay') {
        node.fill(anim.frames[animFrame]);
      } else {
        node.fill(anim.frames[animFrame]);
      }
    }

    // Pulse player
    if (playerNode) {
      playerNode.fill(PLAYER_PULSE[animFrame]);
    }

    // Only redraw the layers that have animated content
    if (animatedNodes.length > 0) uiLayer.batchDraw();
    if (playerNode) entityLayer.batchDraw();
  }

  function handleClick(x, y, domEvent, data) {
    const key = `${x},${y}`;
    const tileType = data.grid[y]?.[x] ?? 0;
    const td = TILE_DISPLAY[tileType] || TILE_DISPLAY[0];
    const walkable = WALKABLE_TILES.has(tileType);

    const isPlayer = data.playerPosition?.x === x && data.playerPosition?.y === y;
    const entity = entityMap.get(key);
    const exit = doorExitMap.get(key);
    const isAmbientNpc = ambientNpcSet.has(key);

    showTileTooltip({
      screenX: domEvent.clientX,
      screenY: domEvent.clientY,
      tileX: x,
      tileY: y,
      tileType,
      tileName: td.name || 'Unknown',
      walkable,
      entity: entity ? {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        disposition: entity.disposition || '',
        icon: entity.icon || ''
      } : null,
      exit: exit || null,
      ambientNpc: isAmbientNpc,
      isPlayer
    });
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
