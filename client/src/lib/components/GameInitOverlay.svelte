<script>
  import { plotId } from '../stores/gameStore.js';

  let { onComplete } = $props();

  let step = $state(0);
  let total = $state(4);
  let message = $state('Connecting to the world...');
  let fadingOut = $state(false);
  let showRetry = $state(false);

  const progressPercent = $derived(total > 0 ? (step / total) * 100 : 0);

  async function runInit() {
    showRetry = false;
    step = 0;
    message = 'Connecting to the world...';

    try {
      const response = await fetch(`/api/plot/${$plotId}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data.status === 'ready') {
          fadeAndComplete();
          return;
        }
        if (data.status === 'initializing') {
          message = 'World is being created by another session...';
          await pollUntilReady();
          fadeAndComplete();
          return;
        }
      }

      // SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'progress') {
              step = data.step;
              total = data.total;
              message = data.message;
            }

            if (data.type === 'complete') {
              step = total;
              message = data.message;
              setTimeout(() => fadeAndComplete(), 800);
              return;
            }

            if (data.type === 'error') {
              message = data.message;
              showRetry = true;
              return;
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // Stream ended without explicit complete
      fadeAndComplete();
    } catch (err) {
      console.error('[Init] Error:', err);
      message = 'Connection error. Click retry.';
      showRetry = true;
    }
  }

  async function pollUntilReady() {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/plot/${$plotId}`);
        const data = await res.json();
        if (data?.status === 'ready' || data?.plot?.status === 'ready') return;
      } catch { /* keep polling */ }
    }
  }

  function fadeAndComplete() {
    fadingOut = true;
    setTimeout(() => {
      if (onComplete) onComplete();
    }, 600);
  }

  // Auto-start on mount
  import { onMount } from 'svelte';
  onMount(() => runInit());
</script>

<div class="init-overlay" class:fade-out={fadingOut}>
  <div class="init-content">
    <div class="init-dragon">&#x1F409;</div>
    <h2 class="init-title">Forging Your World</h2>
    <div class="init-progress-container">
      <div class="init-progress-bar">
        <div class="init-progress-fill" style="width: {progressPercent}%"></div>
      </div>
      <p class="init-message">{message}</p>
    </div>
    {#if showRetry}
      <button class="init-retry-btn" onclick={runInit}>Retry</button>
    {/if}
  </div>
</div>

<style>
  .init-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 40%, #16213e 100%);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: opacity 0.6s ease;
  }

  .init-overlay.fade-out {
    opacity: 0;
    pointer-events: none;
  }

  .init-content {
    text-align: center;
    max-width: 500px;
    padding: 40px;
  }

  .init-dragon {
    font-size: 4rem;
    margin-bottom: 24px;
    animation: breathe 3s ease-in-out infinite;
  }

  .init-title {
    font-family: 'Crimson Text', serif;
    font-size: 2rem;
    color: var(--accent-gold);
    margin-bottom: 32px;
  }

  .init-progress-container { width: 100%; }

  .init-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--bg-input);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 16px;
  }

  .init-progress-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, var(--accent-indigo), var(--accent-gold));
    border-radius: 3px;
    transition: width 0.5s ease;
  }

  .init-message {
    color: var(--text-secondary);
    font-size: 1rem;
    margin-bottom: 24px;
    min-height: 24px;
  }

  .init-retry-btn {
    padding: 10px 24px;
    background: var(--accent-indigo);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.2s;
  }

  .init-retry-btn:hover { background: #4f46e5; }
</style>
