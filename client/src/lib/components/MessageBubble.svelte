<script>
  import { formatCompletedMessage, renderDiscoveryCards } from '../services/narrativeFormatter.js';
  import { showEntityMenu } from '../stores/entityMenuStore.js';
  import { character } from '../stores/gameStore.js';
  import { sceneEntities } from '../stores/sceneStore.js';

  let { message } = $props();

  const isPlayer = $derived(message.author?.toLowerCase() === 'player');
  const charName = $derived($character?.name || 'Player');
  const timestamp = $derived(new Date(message.timestamp).toLocaleTimeString());

  // Format AI messages with narrative formatter
  const formattedContent = $derived.by(() => {
    if (isPlayer) return '';
    let html = '';

    // Prepend skill check if present
    if (message.skillCheck) {
      const sc = message.skillCheck;
      const resultLabels = { fail: 'Failed', pass: 'Passed', strong_success: 'Critical!' };
      const typeLabels = { physical: 'Physical', social: 'Social', mental: 'Mental', survival: 'Survival' };
      html += `<div class="dr-container dr-container--${sc.result} dr-revealed">
        <div class="dr-die">&#x1F3B2;</div>
        <div class="dr-value">${sc.roll}</div>
        <div class="dr-info">
          <span class="dr-type">${typeLabels[sc.type] || sc.type} Check — ${sc.difficulty}</span>
          <span class="dr-action">${sc.action}</span>
        </div>
        <span class="dr-result">${resultLabels[sc.result] || sc.result}</span>
      </div>`;
    }

    html += formatCompletedMessage(message.content, message.sceneEntities || $sceneEntities || null);

    // Discovery cards
    if (message.discoveries?.length > 0) {
      html += renderDiscoveryCards(message.discoveries);
    }

    // Quest discovery cards
    if (message.questUpdates?.length > 0) {
      const discoveries = message.questUpdates.filter(q => q.status === 'discovered');
      if (discoveries.length > 0) {
        html += discoveries.map(q => `
          <div class="quest-discovery-card">
            <div class="qdc-header">New Lead</div>
            <div class="qdc-title">${q.title}</div>
          </div>
        `).join('');
      }
    }

    return html;
  });

  function handleClick(e) {
    const link = e.target.closest('.nf-entity-link');
    if (link) {
      e.stopPropagation();
      const rect = link.getBoundingClientRect();
      showEntityMenu(rect.left, rect.bottom + 4, link.dataset.entityName, link.dataset.entityType);
      return;
    }
    const card = e.target.closest('.ec-card');
    if (card) {
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      showEntityMenu(rect.left, rect.bottom + 4, card.dataset.entityName, card.dataset.entityType);
    }
  }
</script>

<div class="message {isPlayer ? 'user' : 'ai'}">
  {#if isPlayer}
    <div class="author user">{charName}</div>
    <div class="userText">
      {message.content}
      <span class="timestamp">{timestamp}</span>
    </div>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="systemText" onclick={handleClick}>
      {@html formattedContent}
      <span class="timestamp">{timestamp}</span>
    </div>
  {/if}
</div>

<style>
  .message {
    margin-bottom: 20px;
    animation: fadeIn 0.3s ease;
  }

  .message.user {
    max-width: 70%;
    margin-left: auto;
  }

  .message.ai {
    max-width: 100%;
  }

  .author {
    font-size: 0.7rem;
    color: var(--accent-gold);
    margin-bottom: 4px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .author.user {
    text-align: right;
  }

  .userText {
    padding: 12px 16px;
    border-radius: var(--radius-md);
    line-height: 1.7;
    background: var(--accent-indigo);
    color: white;
    border-bottom-right-radius: 4px;
    font-size: 0.9rem;
  }

  .systemText {
    padding: 16px 20px;
    color: var(--text-primary);
    border-left: 2px solid var(--border-subtle);
    font-family: 'Crimson Text', serif;
    font-size: 1.05rem;
    line-height: 1.8;
  }

  .timestamp {
    display: block;
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-top: 8px;
    text-align: right;
    font-family: 'Inter', sans-serif;
  }

  /* Narrative formatting classes */
  .systemText :global(.nf-paragraph) { margin: 0 0 14px 0; }
  .systemText :global(.nf-paragraph:last-child) { margin-bottom: 0; }
  .systemText :global(.nf-bold) { color: var(--accent-gold); font-weight: 700; }
  .systemText :global(.nf-emphasis) { color: var(--text-secondary); font-style: italic; }

  .systemText :global(.nf-dialogue) {
    display: block;
    margin: 8px 0;
    padding: 8px 12px;
    border-left: 3px solid var(--accent-indigo);
    background: rgba(99, 102, 241, 0.08);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .systemText :global(.nf-speaker) {
    color: var(--accent-gold);
    font-weight: 600;
    font-family: 'Inter', sans-serif;
    font-size: 0.85rem;
    display: block;
    margin-bottom: 2px;
  }

  .systemText :global(.nf-dialogue-inline .nf-speaker) {
    display: inline;
    margin-bottom: 0;
  }

  .systemText :global(.nf-speech) {
    font-style: italic;
    color: var(--text-primary);
  }

  .systemText :global(.nf-entity-link) {
    color: var(--accent-gold);
    cursor: pointer;
    border-bottom: 1px dotted var(--accent-gold);
    transition: all 0.15s ease;
  }

  .systemText :global(.nf-entity-link:hover) {
    color: #e5c158;
    border-bottom-style: solid;
    background: rgba(212, 175, 55, 0.1);
  }

  .systemText :global(.nf-entity-link[data-entity-type="object"]) {
    color: #a78bfa;
    border-color: #a78bfa;
  }

  .systemText :global(.nf-entity-link[data-entity-type="location"]) {
    color: #34d399;
    border-color: #34d399;
  }

  /* Discovery cards */
  .systemText :global(.ec-discovery-row) {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 12px 0 8px;
    padding: 8px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .systemText :global(.ec-card) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    max-width: 260px;
    animation: ec-slide-in 0.3s ease;
  }

  .systemText :global(.ec-card:hover) {
    border-color: var(--accent-gold);
    background: rgba(212, 175, 55, 0.08);
    transform: translateY(-1px);
  }

  .systemText :global(.ec-icon) { font-size: 1.2rem; flex-shrink: 0; }
  .systemText :global(.ec-info) { display: flex; flex-direction: column; min-width: 0; }
  .systemText :global(.ec-name) { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); }
  .systemText :global(.ec-desc) { font-size: 0.75rem; color: var(--text-muted); }
  .systemText :global(.ec-badge) {
    font-size: 0.6rem; font-weight: 700; color: var(--accent-gold);
    background: rgba(212, 175, 55, 0.15); padding: 2px 6px; border-radius: 8px;
    flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.5px;
  }

  /* Dice roll */
  .systemText :global(.dr-container) {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    margin: 10px 0;
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-family: 'Inter', sans-serif;
  }

  .systemText :global(.dr-container--fail) { border-color: var(--accent-health); background: rgba(239, 68, 68, 0.08); }
  .systemText :global(.dr-container--pass) { border-color: var(--accent-indigo); background: rgba(99, 102, 241, 0.08); }
  .systemText :global(.dr-container--strong_success) { border-color: var(--accent-gold); background: rgba(212, 175, 55, 0.08); }

  .systemText :global(.dr-die) { font-size: 2rem; line-height: 1; flex-shrink: 0; }
  .systemText :global(.dr-revealed .dr-die) { opacity: 0.3; font-size: 1.4rem; }
  .systemText :global(.dr-value) { font-size: 1.8rem; font-weight: 700; font-family: 'Crimson Text', serif; min-width: 36px; text-align: center; }
  .systemText :global(.dr-container--fail .dr-value) { color: var(--accent-health); }
  .systemText :global(.dr-container--pass .dr-value) { color: var(--accent-indigo); }
  .systemText :global(.dr-container--strong_success .dr-value) { color: var(--accent-gold); }
  .systemText :global(.dr-info) { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .systemText :global(.dr-type) { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
  .systemText :global(.dr-action) { font-size: 0.85rem; color: var(--text-secondary); }
  .systemText :global(.dr-result) { margin-left: auto; padding: 4px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  .systemText :global(.dr-container--fail .dr-result) { background: rgba(239, 68, 68, 0.15); color: var(--accent-health); }
  .systemText :global(.dr-container--pass .dr-result) { background: rgba(99, 102, 241, 0.15); color: var(--accent-indigo); }
  .systemText :global(.dr-container--strong_success .dr-result) { background: rgba(212, 175, 55, 0.15); color: var(--accent-gold); }

  /* Quest discovery card */
  .systemText :global(.quest-discovery-card) {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04));
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    margin: 10px 0;
  }

  .systemText :global(.qdc-header) { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b; margin-bottom: 4px; }
  .systemText :global(.qdc-title) { font-family: 'Crimson Text', serif; font-size: 1.1rem; font-weight: 600; color: var(--text-primary); }
</style>
