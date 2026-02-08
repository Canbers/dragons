<script>
  import { streamingText, streamingSkillCheck, streamingToolCall } from '../stores/logStore.js';

  const resultLabels = { fail: 'Failed', pass: 'Passed', strong_success: 'Critical!' };
  const typeLabels = { physical: 'Physical', social: 'Social', mental: 'Mental', survival: 'Survival' };

  let diceRevealed = $state(false);

  // When a skill check arrives, start 2s reveal timer
  $effect(() => {
    if ($streamingSkillCheck) {
      diceRevealed = false;
      const timer = setTimeout(() => { diceRevealed = true; }, 2000);
      return () => clearTimeout(timer);
    } else {
      diceRevealed = false;
    }
  });
</script>

<div class="message ai streaming">
  <div class="systemText">
    {#if $streamingSkillCheck}
      {@const sc = $streamingSkillCheck}
      <div class="dr-container dr-container--{sc.result}" class:dr-revealed={diceRevealed}>
        <div class="dr-die dr-rolling">&#x1F3B2;</div>
        <div class="dr-value">{sc.roll}</div>
        <div class="dr-info">
          <span class="dr-type">{typeLabels[sc.type] || sc.type} Check — {sc.difficulty}</span>
          <span class="dr-action">{sc.action}</span>
        </div>
        <span class="dr-result">{resultLabels[sc.result] || sc.result}</span>
      </div>
    {/if}

    {#if $streamingToolCall}
      <div class="tool-status">{$streamingToolCall}</div>
    {/if}

    {#if !$streamingText}
      <span class="stream-narrating">The story unfolds...</span>
    {/if}

    <span class="stream-cursor">&#x258C;</span>
  </div>
</div>

<style>
  .message.streaming {
    margin-bottom: 20px;
    animation: fadeIn 0.3s ease;
  }

  .systemText {
    padding: 16px 20px;
    color: var(--text-primary);
    border-left: 2px solid var(--accent-gold);
    font-family: 'Crimson Text', serif;
    font-size: 1.05rem;
    line-height: 1.8;
  }

  .stream-narrating {
    color: var(--text-muted);
    font-style: italic;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .stream-cursor {
    animation: blink 1s infinite;
    color: var(--accent-gold);
  }

  .tool-status {
    font-size: 0.85rem;
    color: var(--accent-gold);
    font-style: italic;
    padding: 2px 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* Dice roll during stream */
  .dr-container {
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

  .dr-container--fail { border-color: var(--accent-health); background: rgba(239, 68, 68, 0.08); }
  .dr-container--pass { border-color: var(--accent-indigo); background: rgba(99, 102, 241, 0.08); }
  .dr-container--strong_success { border-color: var(--accent-gold); background: rgba(212, 175, 55, 0.08); }

  .dr-die { font-size: 2rem; line-height: 1; flex-shrink: 0; }
  .dr-die.dr-rolling { animation: dr-tumble 0.4s ease-in-out infinite; }
  .dr-value { font-size: 1.8rem; font-weight: 700; font-family: 'Crimson Text', serif; opacity: 0; }
  .dr-info { display: flex; flex-direction: column; gap: 2px; opacity: 0; }
  .dr-result { margin-left: auto; padding: 4px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; opacity: 0; }
  .dr-type { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
  .dr-action { font-size: 0.85rem; color: var(--text-secondary); }

  /* Reveal state */
  .dr-container.dr-revealed .dr-die { animation: none; opacity: 0.3; font-size: 1.4rem; transition: all 0.3s ease; }
  .dr-container.dr-revealed .dr-value { opacity: 1; transition: opacity 0.4s ease; }
  .dr-container.dr-revealed .dr-info { opacity: 1; transition: opacity 0.4s ease; }
  .dr-container.dr-revealed .dr-result { opacity: 1; transition: opacity 0.4s ease; }

  .dr-container--fail .dr-value { color: var(--accent-health); }
  .dr-container--pass .dr-value { color: var(--accent-indigo); }
  .dr-container--strong_success .dr-value { color: var(--accent-gold); }
  .dr-container--fail .dr-result { background: rgba(239, 68, 68, 0.15); color: var(--accent-health); }
  .dr-container--pass .dr-result { background: rgba(99, 102, 241, 0.15); color: var(--accent-indigo); }
  .dr-container--strong_success .dr-result { background: rgba(212, 175, 55, 0.15); color: var(--accent-gold); }
</style>
