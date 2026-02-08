import { get } from 'svelte/store';
import { activeModal, closeModal, openModal } from '../stores/modalStore.js';
import { hideEntityMenu } from '../stores/entityMenuStore.js';

/**
 * Initialize global keyboard shortcuts.
 * Call once from App.svelte onMount.
 * Returns a cleanup function to remove the listener.
 */
export function initKeyboard(actionCallback) {
  function handler(e) {
    const tag = document.activeElement?.tagName;

    // When focus is in an input, only handle Escape
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') {
        document.activeElement.blur();
        hideEntityMenu();
        closeModal();
      }
      return;
    }

    // Close modal if open
    if (get(activeModal)) {
      if (e.key === 'Escape') {
        closeModal();
      }
      return;
    }

    // Number keys 1-9 → click action button by index
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      const buttons = document.querySelectorAll('.ap-action');
      if (buttons[index]) buttons[index].click();
      return;
    }

    // Enter → focus chat input
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = document.querySelector('.action-input input');
      if (input) input.focus();
      return;
    }

    // Escape → close entity menu
    if (e.key === 'Escape') {
      hideEntityMenu();
      return;
    }

    // M → open settlement map
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      openModal('settlementMap');
      return;
    }

    // J → open quest journal
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      openModal('questJournal');
      return;
    }
  }

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
