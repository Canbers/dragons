import { writable } from 'svelte/store';

export const messages = writable([]);
export const isStreaming = writable(false);
export const streamingText = writable('');
export const streamingSkillCheck = writable(null);
export const streamingToolCall = writable(null);
export const oldestLogId = writable(null);
export const currentLogId = writable(null);
export const worldReaction = writable(null);
