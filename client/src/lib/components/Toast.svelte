<script>
  import { toasts } from '../stores/toastStore.js';
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <div class="toast {toast.type}">{toast.message}</div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toast {
    padding: 12px 20px;
    border-radius: var(--radius-md);
    color: white;
    font-size: 0.9rem;
    animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
    max-width: 300px;
    box-shadow: var(--shadow-soft);
  }

  .toast.success { background: #10b981; }
  .toast.error { background: #ef4444; }
  .toast.info { background: var(--accent-indigo); }
</style>
