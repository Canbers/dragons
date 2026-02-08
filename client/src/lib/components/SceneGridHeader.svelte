<script>
  import { sceneContext } from '../stores/sceneStore.js';
  import { location } from '../stores/gameStore.js';

  const tensionColors = {
    calm: 'var(--tension-calm)',
    cautious: 'var(--tension-cautious)',
    tense: 'var(--tension-tense)',
    hostile: 'var(--tension-hostile)',
    critical: 'var(--tension-critical)',
  };

  const tensionColor = $derived(tensionColors[$sceneContext?.tension] || tensionColors.calm);
</script>

<div class="grid-header">
  <div class="tension-dot" style="background: {tensionColor}"></div>
  <span class="location-name">{$location?.name || '--'}</span>
</div>

<style>
  .grid-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tension-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 0.5s ease;
  }

  .location-name {
    font-family: 'Crimson Text', serif;
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent-gold);
  }
</style>
