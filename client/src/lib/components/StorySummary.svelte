<script>
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal } from '../stores/modalStore.js';
  import { messages } from '../stores/logStore.js';
  import { closeModal } from '../stores/modalStore.js';
  import * as api from '../services/api.js';

  let summary = $state(null);
  let loading = $state(false);

  $effect(() => {
    if ($activeModal === 'storySummary') loadSummary();
  });

  async function loadSummary() {
    loading = true;
    summary = null;
    try {
      summary = await api.getStorySummary($plotId);
    } catch (e) {
      console.error('Error loading story summary:', e);
    } finally {
      loading = false;
    }
  }

  function addToLog() {
    if (!summary) return;
    let content = summary.summary;
    if (summary.keyEvents?.length > 0) {
      content += '\n\nKey Events:\n' + summary.keyEvents.map(e => `- ${e}`).join('\n');
    }
    messages.update(m => [...m, {
      _id: 'story-' + Date.now(),
      author: 'System',
      content: `The Story So Far:\n${content}`,
      timestamp: new Date().toISOString()
    }]);
    closeModal();
  }
</script>

<Modal name="storySummary" title="The Story So Far">
  {#if loading}
    <em>Recalling your adventure...</em>
  {:else if summary}
    <div class="summary-text">{summary.summary}</div>

    {#if summary.keyEvents?.length > 0}
      <h4>Key Events</h4>
      <ul class="key-events">
        {#each summary.keyEvents as event}
          <li>{event}</li>
        {/each}
      </ul>
    {/if}

    <button class="add-btn" onclick={addToLog}>Add to Game Log</button>
  {:else}
    <em>Unable to generate story summary. Try again later.</em>
  {/if}
</Modal>

<style>
  .summary-text {
    font-family: 'Crimson Text', serif;
    font-size: 1.05rem;
    line-height: 1.8;
    color: var(--text-primary);
    margin-bottom: 16px;
  }

  h4 { color: var(--accent-gold); font-family: 'Crimson Text', serif; margin-bottom: 8px; }
  .key-events { margin: 0 0 16px 20px; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; }
  .key-events li { margin-bottom: 4px; }

  .add-btn {
    padding: 8px 20px; background: var(--accent-indigo); color: white;
    border: none; border-radius: var(--radius-sm); cursor: pointer;
    font-size: 0.85rem; transition: background 0.2s;
  }
  .add-btn:hover { background: #4f46e5; }
</style>
