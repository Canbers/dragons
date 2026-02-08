<script>
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal } from '../stores/modalStore.js';
  import * as api from '../services/api.js';

  let rep = $state(null);
  let loading = $state(false);

  $effect(() => {
    if ($activeModal === 'reputation') loadRep();
  });

  async function loadRep() {
    loading = true;
    try {
      rep = await api.getReputation($plotId);
    } catch (e) {
      console.error('Error loading reputation:', e);
    } finally {
      loading = false;
    }
  }

  const dispEmojis = { hostile: 'Hostile', unfriendly: 'Unfriendly', neutral: 'Neutral', friendly: 'Friendly', allied: 'Allied' };
  const repEmojis = { notorious: 'Notorious', disliked: 'Disliked', unknown: 'Unknown', known: 'Known', respected: 'Respected', legendary: 'Legendary' };
</script>

<Modal name="reputation" title="Reputation">
  {#if loading}
    <em>Loading...</em>
  {:else if rep}
    <div class="rep-section">
      <h4>Known NPCs</h4>
      {#if rep.npcs?.length > 0}
        {#each rep.npcs as npc}
          <div class="rep-item">
            <span class="rep-name">{npc.name}</span>
            <span class="rep-status">{npc.disposition}</span>
            {#if npc.lastInteraction}<span class="rep-detail">{npc.lastInteraction}</span>{/if}
          </div>
        {/each}
      {:else}
        <em class="empty">You haven't made any lasting impressions yet.</em>
      {/if}
    </div>

    <div class="rep-section">
      <h4>Faction Standing</h4>
      {#if rep.factions?.length > 0}
        {#each rep.factions as f}
          <div class="rep-item">
            <span class="rep-name">{f.name}</span>
            <div class="faction-bar">
              <div class="faction-fill" style="width: {Math.abs(f.standing)}%; background: {f.standing > 0 ? '#4CAF50' : f.standing < 0 ? '#f44336' : '#888'}"></div>
            </div>
            <span class="rep-status">{f.standing > 50 ? 'Friendly' : f.standing < -50 ? 'Hostile' : 'Neutral'} ({f.standing})</span>
          </div>
        {/each}
      {:else}
        <em class="empty">No faction relationships established.</em>
      {/if}
    </div>

    <div class="rep-section">
      <h4>Local Reputation</h4>
      {#if rep.locations?.length > 0}
        {#each rep.locations as loc}
          <div class="rep-item">
            <span class="rep-name">{loc.name}</span>
            <span class="rep-status">{loc.reputation}</span>
            {#if loc.knownFor}<span class="rep-detail">{loc.knownFor}</span>{/if}
          </div>
        {/each}
      {:else}
        <em class="empty">You're unknown in these lands.</em>
      {/if}
    </div>
  {:else}
    <em>Failed to load reputation data.</em>
  {/if}
</Modal>

<style>
  .rep-section { margin-bottom: 20px; }
  .rep-section h4 { color: var(--accent-gold); font-family: 'Crimson Text', serif; margin-bottom: 8px; }
  .rep-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; }
  .rep-name { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; }
  .rep-status { font-size: 0.8rem; color: var(--text-secondary); }
  .rep-detail { font-size: 0.75rem; color: var(--text-muted); width: 100%; }
  .faction-bar { flex: 1; height: 6px; background: var(--bg-input); border-radius: 3px; overflow: hidden; max-width: 120px; }
  .faction-fill { height: 100%; border-radius: 3px; }
  .empty { color: var(--text-muted); font-size: 0.85rem; }
</style>
