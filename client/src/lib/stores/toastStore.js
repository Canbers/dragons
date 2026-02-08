import { writable } from 'svelte/store';

export const toasts = writable([]);

let nextId = 0;

export function showToast(message, type = 'info') {
  const id = nextId++;
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }, 3000);
}
