<script>
  import { entityMenu, hideEntityMenu } from '../stores/entityMenuStore.js';
  import { getEntityActions } from '../services/narrativeFormatter.js';

  let { onAction } = $props();

  const actions = $derived(
    $entityMenu.visible ? getEntityActions($entityMenu.name, $entityMenu.type) : []
  );

  // Positioning
  const menuStyle = $derived.by(() => {
    let top = $entityMenu.y;
    let left = $entityMenu.x;
    // Ensure visible within viewport (basic clamping)
    if (left + 200 > window.innerWidth) left = window.innerWidth - 210;
    if (top + 200 > window.innerHeight) top = $entityMenu.y - 200;
    return `top: ${top}px; left: ${left}px;`;
  });

  function handleAction(action) {
    hideEntityMenu();
    if (onAction) onAction(action);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      hideEntityMenu();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') hideEntityMenu();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $entityMenu.visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="em-backdrop" onclick={handleBackdropClick}>
    <div class="em-menu" style={menuStyle}>
      <div class="em-header">{$entityMenu.name}</div>
      {#each actions as action}
        <button class="em-action" onclick={() => handleAction(action.action)}>
          {action.icon} {action.label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .em-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 4999;
  }

  .em-menu {
    position: fixed;
    z-index: 5000;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    min-width: 180px;
    padding: 4px;
    animation: em-appear 0.15s ease;
  }

  .em-header {
    padding: 8px 12px;
    font-weight: 600;
    color: var(--accent-gold);
    font-size: 0.85rem;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 4px;
  }

  .em-action {
    display: block;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: 'Inter', sans-serif;
    transition: background 0.15s ease;
  }

  .em-action:hover {
    background: var(--bg-input);
    color: var(--accent-gold);
  }
</style>
