<script>
  import { isStreaming } from '../stores/logStore.js';
  import { actions } from '../stores/gameStore.js';
  import { pickEmoji } from '../services/narrativeFormatter.js';

  let { onSubmit } = $props();
  let inputValue = $state('');
  let inputEl = $state(null);

  function handleSubmit(overrideType) {
    const text = inputValue.trim();
    if (!text || $isStreaming) return;
    onSubmit(text, overrideType || 'play');
    inputValue = '';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleActionClick(action) {
    if ($isStreaming) return;
    onSubmit(action, 'play');
  }

  function handleAskGM() {
    const text = inputValue.trim();
    if (text) {
      handleSubmit('askGM');
    } else {
      if (inputEl) {
        inputEl.placeholder = 'Type your question for the GM, then click ? again';
        inputEl.focus();
      }
    }
  }

  const CATEGORY_META = {
    movement: { icon: '\uD83D\uDEB6', label: 'Move' },
    social:   { icon: '\uD83D\uDCAC', label: 'Social' },
    explore:  { icon: '\uD83D\uDD0D', label: 'Explore' },
    combat:   { icon: '\u2694\uFE0F', label: 'Combat' }
  };

  const categoryOrder = ['movement', 'social', 'explore', 'combat'];
</script>

<div class="action-bar">
  <!-- Categorized actions -->
  {#if $actions.categorized}
    <div class="quick-actions">
      {#each categoryOrder as cat}
        {#if $actions.categorized[cat]?.length > 0}
          <div class="ap-category">
            <div class="ap-category-header">{CATEGORY_META[cat]?.icon} {CATEGORY_META[cat]?.label}</div>
            <div class="ap-actions">
              {#each $actions.categorized[cat] as action}
                <button
                  class="ap-action"
                  disabled={$isStreaming}
                  onclick={() => handleActionClick(action.action)}
                >{action.label}</button>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
      <div class="ap-category ap-utility">
        <div class="ap-actions">
          <button class="ap-action static" disabled={$isStreaming} onclick={() => handleActionClick('I look around carefully')}>Look</button>
          <button class="ap-action static" disabled={$isStreaming} onclick={() => handleActionClick('I find a safe spot to rest and catch my breath')}>Rest</button>
        </div>
      </div>
    </div>
  {:else if $actions.suggested?.length > 0}
    <div class="quick-actions flat">
      {#each $actions.suggested as action}
        <button
          class="quick-action dynamic"
          disabled={$isStreaming}
          onclick={() => handleActionClick(action.action)}
        >{pickEmoji(action.label)} {action.label}</button>
      {/each}
      <button class="quick-action static" disabled={$isStreaming} onclick={() => handleActionClick('I look around carefully')}>Look</button>
      <button class="quick-action static" disabled={$isStreaming} onclick={() => handleActionClick('I find a safe spot to rest and catch my breath')}>Rest</button>
    </div>
  {:else}
    <div class="quick-actions flat">
      <button class="quick-action dynamic" disabled={$isStreaming} onclick={() => handleActionClick('I approach someone nearby and greet them')}>Talk</button>
      <button class="quick-action dynamic" disabled={$isStreaming} onclick={() => handleActionClick('I check my belongings and inventory')}>Inventory</button>
      <button class="quick-action dynamic" disabled={$isStreaming} onclick={() => handleActionClick('I explore the area further')}>Explore</button>
      <button class="quick-action static" disabled={$isStreaming} onclick={() => handleActionClick('I look around carefully')}>Look</button>
      <button class="quick-action static" disabled={$isStreaming} onclick={() => handleActionClick('I find a safe spot to rest and catch my breath')}>Rest</button>
    </div>
  {/if}

  <!-- Text input -->
  <div class="input-area">
    <div class="input-row">
      <input
        bind:this={inputEl}
        bind:value={inputValue}
        type="text"
        class="chat-input"
        placeholder="What do you do? (actions, speech, or both)"
        disabled={$isStreaming}
        onkeydown={handleKeydown}
      >
      <button class="send-btn" disabled={$isStreaming} onclick={() => handleSubmit()}>
        {$isStreaming ? '...' : 'Go'}
      </button>
      <button class="ask-gm-btn" disabled={$isStreaming} onclick={handleAskGM} title="Ask the GM a question">?</button>
    </div>
  </div>
</div>

<style>
  .action-bar {
    border-top: 2px solid var(--accent-gold);
  }

  /* Categorized actions */
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px 16px;
    background: var(--bg-secondary);
  }

  .quick-actions.flat {
    gap: 8px;
  }

  .ap-category {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }

  .ap-category-header {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--accent-gold);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .ap-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ap-action {
    padding: 10px 16px;
    font-size: 0.85rem;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .ap-action:hover:not(:disabled) {
    background: var(--accent-indigo);
    color: white;
    border-color: var(--accent-indigo);
    transform: translateY(-1px);
  }

  .ap-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ap-action.static {
    opacity: 0.7;
    font-size: 0.8rem;
  }

  .ap-utility {
    margin-left: auto;
    background: transparent;
    border: none;
    padding: 4px 8px;
  }

  .quick-action {
    padding: 10px 16px;
    font-size: 0.85rem;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .quick-action:hover:not(:disabled) {
    background: var(--accent-indigo);
    color: white;
    border-color: var(--accent-indigo);
    transform: translateY(-1px);
  }

  .quick-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .quick-action.dynamic {
    border-color: rgba(212, 175, 55, 0.5);
  }

  .quick-action.static {
    opacity: 0.7;
    font-size: 0.8rem;
  }

  /* Input area */
  .input-area {
    padding: 8px 16px 10px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border-subtle);
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .chat-input {
    flex: 1;
    padding: 12px 16px;
    font-size: 0.95rem;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-family: 'Crimson Text', serif;
  }

  .chat-input:focus {
    outline: none;
    border-color: var(--accent-indigo);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
  }

  .chat-input::placeholder {
    color: var(--text-muted);
  }

  .send-btn {
    padding: 12px 20px;
    font-size: 1.2rem;
    background: var(--accent-gold);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s ease;
  }

  .send-btn:hover:not(:disabled) {
    background: #e5c158;
    transform: translateY(-1px);
  }

  .send-btn:disabled {
    background: var(--text-muted);
    cursor: not-allowed;
  }

  .ask-gm-btn {
    padding: 12px 16px;
    font-size: 1rem;
    background: var(--bg-input);
    color: var(--accent-indigo);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-weight: 700;
    transition: all 0.2s ease;
  }

  .ask-gm-btn:hover:not(:disabled) {
    background: var(--accent-indigo);
    color: var(--bg-primary);
    border-color: var(--accent-indigo);
  }

  .ask-gm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
