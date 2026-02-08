<script>
  import { openModal } from '../stores/modalStore.js';
</script>

<div class="game-buttons">
  <button class="game-btn" onclick={() => openModal('questJournal')}>Journal</button>
  <button class="game-btn" onclick={() => openModal('reputation')}>Rep</button>
  <button class="game-btn" onclick={() => openModal('storySummary')}>Story</button>
  <button class="game-btn" onclick={() => openModal('settlementMap')}>Map</button>
  <button class="game-btn" onclick={() => openModal('settings')}>Settings</button>
</div>

<style>
  .game-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 12px;
    background: var(--bg-panel);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
  }

  .game-btn {
    flex: 1;
    min-width: 60px;
    padding: 8px 10px;
    font-size: 0.75rem;
    background: var(--bg-input);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .game-btn:hover {
    background: var(--accent-indigo);
    color: white;
    border-color: var(--accent-indigo);
  }
</style>
