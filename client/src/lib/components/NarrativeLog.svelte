<script>
  import { tick } from 'svelte';
  import { messages, isStreaming, worldReaction } from '../stores/logStore.js';
  import MessageBubble from './MessageBubble.svelte';
  import StreamingMessage from './StreamingMessage.svelte';

  let logEl = $state(null);

  // Auto-scroll when messages change, streaming starts, or world reaction arrives
  $effect(() => {
    // Access reactive deps
    $messages;
    $isStreaming;
    $worldReaction;
    tick().then(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  });

  // Auto-clear world reaction after display
  $effect(() => {
    if ($worldReaction) {
      const timer = setTimeout(() => worldReaction.set(null), 10000);
      return () => clearTimeout(timer);
    }
  });
</script>

<div class="game-log" bind:this={logEl}>
  {#each $messages as msg (msg._id || msg.timestamp)}
    <MessageBubble message={msg} />
  {/each}

  {#if $isStreaming}
    <StreamingMessage />
  {/if}

  {#if $worldReaction}
    <div class="world-reaction">
      <div class="wr-label">The world stirs...</div>
      <div class="wr-text">{$worldReaction}</div>
    </div>
  {/if}
</div>

<style>
  .game-log {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    scroll-behavior: smooth;
  }

  .world-reaction {
    margin: 12px 0;
    padding: 12px 16px;
    border-left: 2px solid var(--accent-gold, #d4af37);
    background: rgba(212, 175, 55, 0.05);
    border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
    animation: wr-fade-in 0.5s ease;
  }

  .wr-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent-gold, #d4af37);
    margin-bottom: 4px;
    font-family: 'Inter', sans-serif;
    font-weight: 600;
  }

  .wr-text {
    font-family: 'Crimson Text', serif;
    font-size: 1rem;
    font-style: italic;
    line-height: 1.7;
    color: var(--text-secondary, #a0a0a0);
  }

  @keyframes wr-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
