<script>
  import { activeModal, closeModal } from '../stores/modalStore.js';

  let { name, title = '', children } = $props();

  const isOpen = $derived($activeModal === name);

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) closeModal();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) closeModal();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdrop}>
    <div class="modal-content">
      <button class="close-btn" onclick={closeModal}>&times;</button>
      {#if title}
        <h3 class="modal-title">{title}</h3>
      {/if}
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .modal-content {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 24px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
    animation: fadeIn 0.2s ease;
  }

  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    font-size: 24px;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: none;
    line-height: 1;
    transition: color 0.2s;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-title {
    font-family: 'Crimson Text', serif;
    color: var(--accent-gold);
    margin-bottom: 16px;
  }
</style>
