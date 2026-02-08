import { writable } from 'svelte/store';

// activeModal: null | 'questJournal' | 'settlementMap' | 'settings' | 'reputation' | 'storySummary' | 'characterSheet'
export const activeModal = writable(null);

export function openModal(name) {
  activeModal.set(name);
}

export function closeModal() {
  activeModal.set(null);
}
