<script>
  import { plotId } from '../stores/gameStore.js';
  import { showToast } from '../stores/toastStore.js';
  import * as api from '../services/api.js';

  let { quest } = $props();
  let tracked = $state(false);

  async function handleTrack() {
    try {
      await api.trackQuest($plotId, quest.id);
      tracked = true;
      showToast('Quest tracked!', 'success');
    } catch (e) {
      showToast('Failed to track quest', 'error');
    }
  }
</script>

<div class="quest-discovery-card">
  <div class="qdc-header">New Lead Discovered</div>
  <div class="qdc-title">{quest.title}</div>
  {#if quest.description}
    <div class="qdc-description">{quest.description}</div>
  {/if}
  {#if tracked}
    <button class="qdc-track-btn qdc-tracked" disabled>Tracked</button>
  {:else}
    <button class="qdc-track-btn" onclick={handleTrack}>Track Quest</button>
  {/if}
</div>

<style>
  .quest-discovery-card {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04));
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    margin: 10px 0;
    animation: qdc-appear 0.5s ease;
  }

  @keyframes qdc-appear {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .qdc-header {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #f59e0b;
    margin-bottom: 4px;
  }

  .qdc-title {
    font-family: 'Crimson Text', serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .qdc-description {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-bottom: 8px;
  }

  .qdc-track-btn {
    background: #f59e0b;
    color: #1a1a2e;
    border: none;
    padding: 5px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: background 0.2s;
  }

  .qdc-track-btn:hover { background: #d97706; }

  .qdc-track-btn:disabled,
  .qdc-tracked {
    background: #22c55e;
    cursor: default;
    color: white;
  }
</style>
