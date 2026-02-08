<script>
  import { character } from '../stores/gameStore.js';

  const healthPercent = $derived(Math.min(100, Math.max(0, $character?.currentStatus?.health ?? 0)));
  const manaPercent = $derived(Math.min(100, Math.max(0, $character?.currentStatus?.mana ?? 0)));
</script>

{#if $character}
  <div class="character-strip">
    <span class="char-name">{$character.name}</span>
    <div class="char-bars">
      <div class="char-bar">
        <span class="bar-icon">HP</span>
        <div class="bar-bg"><div class="bar-fill health" style="width: {healthPercent}%"></div></div>
        <span class="bar-value">{$character.currentStatus?.health ?? 0}/{$character.maxStatus?.health ?? 100}</span>
      </div>
      <div class="char-bar">
        <span class="bar-icon">MP</span>
        <div class="bar-bg"><div class="bar-fill mana" style="width: {manaPercent}%"></div></div>
        <span class="bar-value">{$character.currentStatus?.mana ?? 0}/{$character.maxStatus?.mana ?? 100}</span>
      </div>
    </div>
    <span class="char-class">{$character.class} Lv{$character.level || 1}</span>
  </div>
{/if}

<style>
  .character-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-panel);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }

  .char-name {
    font-family: 'Crimson Text', serif;
    font-weight: 600;
    color: var(--accent-gold);
    white-space: nowrap;
  }

  .char-bars { display: flex; gap: 8px; flex: 1; }
  .char-bar { display: flex; align-items: center; gap: 4px; flex: 1; }
  .bar-icon { font-size: 0.75rem; width: 24px; text-align: center; color: var(--text-muted); font-weight: 600; }
  .bar-bg { flex: 1; height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
  .bar-fill.health { background: linear-gradient(90deg, var(--accent-health), #f87171); }
  .bar-fill.mana { background: linear-gradient(90deg, var(--accent-mana), #60a5fa); }
  .bar-value { font-size: 0.75rem; color: var(--text-secondary); width: 50px; text-align: right; }
  .char-class { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
</style>
