<script>
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal } from '../stores/modalStore.js';
  import { showToast } from '../stores/toastStore.js';
  import * as api from '../services/api.js';

  let quests = $state([]);
  let loading = $state(false);

  // Fetch quests when modal opens
  $effect(() => {
    if ($activeModal === 'questJournal') loadQuests();
  });

  async function loadQuests() {
    loading = true;
    try {
      quests = await api.getQuests($plotId) || [];
    } catch (e) {
      console.error('Error loading quests:', e);
    } finally {
      loading = false;
    }
  }

  async function handleTrack(questId) {
    try {
      await api.trackQuest($plotId, questId);
      showToast('Quest tracked!', 'success');
      await loadQuests();
    } catch (e) {
      showToast('Failed to track quest', 'error');
    }
  }

  const active = $derived(quests.filter(q => q.status === 'active'));
  const leads = $derived(quests.filter(q => q.status === 'discovered'));
  const completed = $derived(quests.filter(q => ['completed', 'failed', 'expired'].includes(q.status)));

  const statusColors = {
    active: '#6366f1', discovered: '#f59e0b', completed: '#22c55e',
    failed: '#ef4444', expired: '#6b7280'
  };
  const statusLabels = {
    active: 'Active', discovered: 'Lead', completed: 'Completed',
    failed: 'Failed', expired: 'Expired'
  };
</script>

<Modal name="questJournal" title="Quest Journal">
  {#if loading}
    <em>Loading...</em>
  {:else}
    <div class="qj-section">
      <h4>Active Quests</h4>
      {#if active.length === 0}
        <em class="empty">No active quests. Track a lead to begin.</em>
      {:else}
        {#each active as quest}
          <div class="qj-card" style="border-left-color: {statusColors[quest.status]}">
            <div class="qj-header">
              <span class="qj-title">{quest.title}</span>
              <span class="qj-badge" style="background: {statusColors[quest.status]}">{statusLabels[quest.status]}</span>
            </div>
            {#if quest.description}<div class="qj-desc">{quest.description}</div>{/if}
            {#if quest.currentSummary}<div class="qj-summary"><em>{quest.currentSummary}</em></div>{/if}
            {#if quest.objectives?.length > 0}
              <div class="qj-objectives">
                {#each quest.objectives.filter(o => o.status !== 'unknown') as obj}
                  <div class="qj-obj" class:current={obj.isCurrent}>
                    {obj.status === 'completed' ? '\u2611' : obj.status === 'failed' ? '\u2612' : '\u2610'} {obj.description}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="qj-section">
      <h4>Leads</h4>
      {#if leads.length === 0}
        <em class="empty">No leads discovered yet. Explore the world and talk to people.</em>
      {:else}
        {#each leads as quest}
          <div class="qj-card" style="border-left-color: {statusColors[quest.status]}">
            <div class="qj-header">
              <span class="qj-title">{quest.title}</span>
              <span class="qj-badge" style="background: {statusColors[quest.status]}">{statusLabels[quest.status]}</span>
            </div>
            {#if quest.description}<div class="qj-desc">{quest.description}</div>{/if}
            <button class="qj-track-btn" onclick={() => handleTrack(quest.id)}>Track Quest</button>
          </div>
        {/each}
      {/if}
    </div>

    <div class="qj-section">
      <h4>Completed</h4>
      {#if completed.length === 0}
        <em class="empty">No completed quests yet.</em>
      {:else}
        {#each completed as quest}
          <div class="qj-card" style="border-left-color: {statusColors[quest.status]}">
            <div class="qj-header">
              <span class="qj-title">{quest.title}</span>
              <span class="qj-badge" style="background: {statusColors[quest.status]}">{statusLabels[quest.status]}</span>
            </div>
            {#if quest.description}<div class="qj-desc">{quest.description}</div>{/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .qj-section { margin-bottom: 20px; }
  .qj-section h4 { color: var(--accent-gold); font-family: 'Crimson Text', serif; font-size: 1.1rem; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; }
  .qj-card { background: var(--bg-input); border-left: 3px solid #888; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
  .qj-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .qj-title { font-family: 'Crimson Text', serif; font-size: 1.05rem; font-weight: 600; color: var(--text-primary); }
  .qj-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; color: white; text-transform: uppercase; letter-spacing: 0.5px; }
  .qj-desc { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 6px; }
  .qj-summary { color: var(--text-muted); font-size: 0.8rem; margin-bottom: 6px; }
  .qj-objectives { margin-top: 6px; }
  .qj-obj { color: var(--text-secondary); font-size: 0.82rem; padding: 2px 0; }
  .qj-obj.current { color: var(--text-primary); font-weight: 500; }
  .qj-track-btn { margin-top: 8px; background: var(--accent-indigo); color: white; border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 0.82rem; transition: background 0.2s; }
  .qj-track-btn:hover { background: #4f46e5; }
  .empty { color: var(--text-muted); font-size: 0.85rem; }
</style>
