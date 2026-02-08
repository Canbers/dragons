<script>
  import { tick } from 'svelte';
  import { messages, isStreaming } from '../stores/logStore.js';
  import MessageBubble from './MessageBubble.svelte';
  import StreamingMessage from './StreamingMessage.svelte';

  let logEl = $state(null);

  // Auto-scroll when messages change or streaming starts
  $effect(() => {
    // Access reactive deps
    $messages;
    $isStreaming;
    tick().then(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  });
</script>

<div class="game-log" bind:this={logEl}>
  {#each $messages as msg (msg._id || msg.timestamp)}
    <MessageBubble message={msg} />
  {/each}

  {#if $isStreaming}
    <StreamingMessage />
  {/if}
</div>

<style>
  .game-log {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    scroll-behavior: smooth;
  }
</style>
