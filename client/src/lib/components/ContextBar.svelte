<script>
  import { location, currentActivity, currentTime, conditions } from '../stores/gameStore.js';

  const activityIcons = {
    'exploring': 'Exploring', 'conversation': 'Talking', 'in combat': 'Combat',
    'resting': 'Resting', 'traveling': 'Traveling'
  };
</script>

<div class="context-bar">
  <span class="context-chip">{$location?.name || '--'}</span>
  <span class="context-chip">{$currentActivity}</span>
  <span class="context-chip">{$conditions}</span>
</div>

<style>
  .context-bar {
    display: flex;
    gap: 12px;
    padding: 10px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-subtle);
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .context-chip {
    background: var(--bg-input);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }
</style>
