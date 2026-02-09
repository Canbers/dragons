<script>
  import { tileTooltip, hideTileTooltip } from '../stores/tileTooltipStore.js';

  let { onAction, onMove, onTravel } = $props();

  let customText = $state('');

  // Positioning — clamp to viewport
  const tooltipStyle = $derived.by(() => {
    let top = $tileTooltip.screenY;
    let left = $tileTooltip.screenX + 12;
    const w = 260, h = 300;
    if (left + w > window.innerWidth) left = $tileTooltip.screenX - w - 12;
    if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    return `top: ${top}px; left: ${left}px;`;
  });

  const tt = $derived($tileTooltip);

  function handleAction(text) {
    hideTileTooltip();
    customText = '';
    if (onAction) onAction(text);
  }

  function handleMove() {
    hideTileTooltip();
    customText = '';
    if (onMove) onMove(tt.tileX, tt.tileY);
  }

  function handleTravel() {
    hideTileTooltip();
    customText = '';
    if (onTravel) onTravel(tt.exit);
  }

  function handleCustomSubmit() {
    const text = customText.trim();
    if (!text) return;
    hideTileTooltip();
    customText = '';
    if (onAction) onAction(text);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && customText.trim()) {
      e.preventDefault();
      handleCustomSubmit();
    }
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape' && $tileTooltip.visible) {
      hideTileTooltip();
      customText = '';
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      hideTileTooltip();
      customText = '';
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if tt.visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tt-backdrop" onclick={handleBackdropClick}>
    <div class="tt-panel" style={tooltipStyle}>
      {#if tt.isPlayer}
        <!-- Player's own tile -->
        <div class="tt-header">You are here</div>
        <div class="tt-info">{tt.tileName}</div>

      {:else if tt.entity}
        <!-- Named entity (NPC or object) -->
        <div class="tt-header">{tt.entity.name}</div>
        {#if tt.entity.description}
          <div class="tt-desc">{tt.entity.description}</div>
        {/if}
        {#if tt.entity.disposition}
          <div class="tt-disposition">{tt.entity.disposition}</div>
        {/if}

        {#if tt.entity.type === 'npc' || tt.entity.type === 'quest'}
          <button class="tt-action" onclick={() => handleAction(`I speak to ${tt.entity.name}`)}>
            Talk to {tt.entity.name}
          </button>
          <button class="tt-action" onclick={() => handleAction(`I observe ${tt.entity.name} carefully`)}>
            Observe {tt.entity.name}
          </button>
          <button class="tt-action" onclick={() => handleAction(`I ask about ${tt.entity.name}`)}>
            Ask about {tt.entity.name}
          </button>
        {:else}
          <button class="tt-action" onclick={() => handleAction(`I examine the ${tt.entity.name}`)}>
            Examine {tt.entity.name}
          </button>
          <button class="tt-action" onclick={() => handleAction(`I interact with the ${tt.entity.name}`)}>
            Interact with {tt.entity.name}
          </button>
        {/if}

      {:else if tt.exit}
        <!-- Door / exit tile -->
        <div class="tt-header">Exit to {tt.exit.name}</div>
        <div class="tt-info">{tt.tileName}</div>
        <button class="tt-action tt-travel" onclick={handleTravel}>
          Travel here
        </button>

      {:else if tt.ambientNpc}
        <!-- Ambient NPC -->
        <div class="tt-header">Townsperson</div>
        <div class="tt-info">{tt.tileName}</div>
        <button class="tt-action" onclick={() => handleAction('I observe the nearby townsperson')}>
          Observe
        </button>

      {:else if tt.walkable}
        <!-- Empty walkable tile -->
        <div class="tt-header">{tt.tileName}</div>
        <button class="tt-action tt-move" onclick={handleMove}>
          Move here
        </button>

      {:else}
        <!-- Furniture / wall / non-walkable -->
        <div class="tt-header">{tt.tileName}</div>
      {/if}

      <!-- Free-text input (always shown except on player tile) -->
      {#if !tt.isPlayer}
        <div class="tt-custom">
          <input
            type="text"
            class="tt-input"
            placeholder="Custom action..."
            bind:value={customText}
            onkeydown={handleKeydown}
          />
          <button class="tt-go" onclick={handleCustomSubmit} disabled={!customText.trim()}>Go</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tt-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 4999;
  }

  .tt-panel {
    position: fixed;
    z-index: 5000;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    min-width: 200px;
    max-width: 260px;
    padding: 4px;
    animation: tt-appear 0.12s ease;
  }

  @keyframes tt-appear {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .tt-header {
    padding: 8px 12px;
    font-weight: 600;
    color: var(--accent-gold);
    font-size: 0.85rem;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 4px;
  }

  .tt-desc {
    padding: 4px 12px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .tt-disposition {
    padding: 2px 12px 4px;
    color: #888;
    font-size: 0.75rem;
    font-style: italic;
  }

  .tt-info {
    padding: 4px 12px;
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .tt-action {
    display: block;
    width: 100%;
    padding: 7px 12px;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.82rem;
    font-family: 'Inter', sans-serif;
    transition: background 0.15s ease;
  }

  .tt-action:hover {
    background: var(--bg-input);
    color: var(--accent-gold);
  }

  .tt-action.tt-move {
    color: #00CCCC;
  }

  .tt-action.tt-move:hover {
    color: #00FFFF;
  }

  .tt-action.tt-travel {
    color: #CD853F;
  }

  .tt-action.tt-travel:hover {
    color: #FFD700;
  }

  .tt-custom {
    display: flex;
    gap: 4px;
    padding: 6px 8px 8px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 4px;
  }

  .tt-input {
    flex: 1;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    font-size: 0.8rem;
    font-family: 'Inter', sans-serif;
    outline: none;
  }

  .tt-input:focus {
    border-color: var(--accent-gold);
  }

  .tt-input::placeholder {
    color: #555;
  }

  .tt-go {
    background: var(--bg-input);
    color: var(--accent-gold);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 5px 10px;
    font-size: 0.8rem;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    transition: background 0.15s ease;
  }

  .tt-go:hover:not(:disabled) {
    background: var(--border-subtle);
  }

  .tt-go:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
