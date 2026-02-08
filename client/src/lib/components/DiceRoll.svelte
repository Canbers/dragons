<script>
  import { onMount } from 'svelte';

  let { skillCheck, animated = false } = $props();

  let revealed = $state(!animated);

  const resultLabels = { fail: 'Failed', pass: 'Passed', strong_success: 'Critical!' };
  const typeLabels = { physical: 'Physical', social: 'Social', mental: 'Mental', survival: 'Survival' };

  onMount(() => {
    if (animated) {
      setTimeout(() => { revealed = true; }, 2000);
    }
  });
</script>

{#if skillCheck}
  <div class="dr-container dr-container--{skillCheck.result}" class:dr-revealed={revealed}>
    <div class="dr-die" class:dr-rolling={!revealed}>&#x1F3B2;</div>
    <div class="dr-value">{skillCheck.roll}</div>
    <div class="dr-info">
      <span class="dr-type">{typeLabels[skillCheck.type] || skillCheck.type} Check — {skillCheck.difficulty}</span>
      <span class="dr-action">{skillCheck.action}</span>
    </div>
    <span class="dr-result">{resultLabels[skillCheck.result] || skillCheck.result}</span>
  </div>
{/if}

<style>
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
    animation: fadeIn 0.3s ease;
  }

  .dr-container--fail {
    border-color: var(--accent-health);
    background: rgba(239, 68, 68, 0.08);
  }

  .dr-container--pass {
    border-color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.08);
  }

  .dr-container--strong_success {
    border-color: var(--accent-gold);
    background: rgba(212, 175, 55, 0.08);
  }

  .dr-die {
    font-size: 2rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .dr-die.dr-rolling {
    animation: dr-tumble 0.4s ease-in-out infinite;
  }

  @keyframes dr-tumble {
    0%   { transform: rotate(0deg) scale(1); }
    25%  { transform: rotate(90deg) scale(1.1); }
    50%  { transform: rotate(180deg) scale(1); }
    75%  { transform: rotate(270deg) scale(1.1); }
    100% { transform: rotate(360deg) scale(1); }
  }

  .dr-value {
    font-size: 1.8rem;
    font-weight: 700;
    font-family: 'Crimson Text', serif;
    min-width: 36px;
    text-align: center;
    flex-shrink: 0;
  }

  .dr-container--fail .dr-value { color: var(--accent-health); }
  .dr-container--pass .dr-value { color: var(--accent-indigo); }
  .dr-container--strong_success .dr-value { color: var(--accent-gold); }

  .dr-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .dr-type {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .dr-action {
    font-size: 0.85rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dr-result {
    margin-left: auto;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .dr-container--fail .dr-result {
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-health);
  }

  .dr-container--pass .dr-result {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-indigo);
  }

  .dr-container--strong_success .dr-result {
    background: rgba(212, 175, 55, 0.15);
    color: var(--accent-gold);
  }

  /* Reveal animation */
  .dr-value, .dr-info, .dr-result {
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  .dr-revealed .dr-die {
    animation: none;
    opacity: 0.3;
    font-size: 1.4rem;
    transition: all 0.3s ease;
  }

  .dr-revealed .dr-value,
  .dr-revealed .dr-info,
  .dr-revealed .dr-result {
    opacity: 1;
  }
</style>
