/**
 * sseService.js — Handles streaming action submission and SSE parsing.
 * Dispatches events to stores as they arrive.
 *
 * Architecture: Player is unblocked on 'done' event (after narrative streaming).
 * Late events (suggestions, discoveries, quests) arrive after done and update
 * stores asynchronously. A turn guard prevents stale late events from a previous
 * turn from corrupting a new turn's state.
 */

import { get } from 'svelte/store';
import { plotId } from '../stores/gameStore.js';
import { actions } from '../stores/gameStore.js';
import { messages, isStreaming, streamingText, streamingSkillCheck, streamingToolCall, worldReaction } from '../stores/logStore.js';
import { gridData } from '../stores/gridStore.js';
import { sceneContext, sceneEntities } from '../stores/sceneStore.js';
import { questDiscoveries, questUpdates } from '../stores/questStore.js';
import { showToast } from '../stores/toastStore.js';
import * as api from './api.js';

// Turn guard — prevents stale late events from a previous turn
let currentTurnId = 0;

/**
 * Submit a player action and process the SSE response stream.
 * Resolves on 'done' (player unblocked), but keeps reading late events.
 * @param {string} input - Player input text
 * @param {string} inputType - 'play' or 'askGM'
 * @returns {Promise<{fullMessage, sceneEntities, discoveries, skillCheck, questDiscoveries, questUpdates}>}
 */
export async function submitAction(input, inputType = 'play', options = {}) {
  const pId = get(plotId);
  if (!pId) throw new Error('No plotId');

  const turnId = ++currentTurnId;

  isStreaming.set(true);
  streamingText.set('');
  streamingSkillCheck.set(null);
  streamingToolCall.set(null);

  // Clear stale suggestions so old ones don't linger during narrative
  actions.set({ categorized: null, suggested: [] });

  // Reset per-action accumulators
  let fullMessage = '';
  let currentSceneEntities = null;
  let currentDiscoveries = null;
  let currentSkillCheck = null;
  let currentQuestDiscoveries = [];
  let currentQuestUpdates = [];

  return new Promise((resolve) => {
    (async () => {
      let doneReceived = false;
      let lineBuffer = ''; // Buffer for partial SSE lines across chunks
      try {
        const response = await api.submitActionStream(input, inputType, pId, options);
        if (!response) {
          isStreaming.set(false);
          resolve(null);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // If a new turn started, stop processing this one's late events
          if (doneReceived && turnId !== currentTurnId) break;

          const text = decoder.decode(value, { stream: true });
          // Prepend any leftover partial line from previous chunk
          const combined = lineBuffer + text;
          const lines = combined.split('\n');

          // Last element may be incomplete — save it for next chunk
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            let data;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (data.tool_call) {
              streamingToolCall.set(data.tool_call);
            }

            if (data.skill_check) {
              currentSkillCheck = data.skill_check;
              streamingSkillCheck.set(data.skill_check);
              streamingToolCall.set(null);
            }

            if (data.chunk) {
              streamingToolCall.set(null);
              fullMessage += data.chunk;
              streamingText.set(fullMessage);
            }

            if (data.scene_entities) {
              currentSceneEntities = data.scene_entities;
              sceneEntities.set(data.scene_entities);
            }

            if (data.discoveries) {
              currentDiscoveries = data.discoveries;
              // New entities discovered — refresh grid to show them
              refreshGrid(pId);
            }

            if (data.categorized_actions) {
              actions.update(a => ({ ...a, categorized: data.categorized_actions }));
            }

            if (data.suggested_actions) {
              actions.update(a => ({ ...a, suggested: data.suggested_actions }));
            }

            if (data.scene_context) {
              sceneContext.set(data.scene_context);
            }

            if (data.quest_discovered) {
              currentQuestDiscoveries = data.quest_discovered;
              questDiscoveries.set(data.quest_discovered);
              showToast('New quest lead discovered!', 'info');
            }

            if (data.quest_update) {
              currentQuestUpdates.push({
                questId: data.quest_update.id,
                title: data.quest_update.title,
                status: data.quest_update.status
              });
              questUpdates.set(currentQuestUpdates);
              showToast(`Quest updated: ${data.quest_update.title}`, 'info');
            }

            if (data.world_reaction) {
              // Background world reaction — arrives after done
              console.log('[SSE] world_reaction received');
              worldReaction.set(data.world_reaction);
            }

            if (data.grid_updated) {
              // Authoritative grid refresh — positions are now saved
              console.log('[SSE] grid_updated received — refreshing grid');
              refreshGrid(pId);
            }

            if (data.debug) {
              // Could dispatch to a debug store — skip for now
            }

            if (data.done && !doneReceived) {
              // ---- PLAYER UNBLOCKED ----
              doneReceived = true;
              isStreaming.set(false);
              streamingText.set('');
              streamingSkillCheck.set(null);
              streamingToolCall.set(null);

              // Resolve promise — caller gets result, player can type
              resolve({
                fullMessage,
                sceneEntities: currentSceneEntities,
                discoveries: currentDiscoveries,
                skillCheck: currentSkillCheck,
                questDiscoveries: currentQuestDiscoveries,
                questUpdates: currentQuestUpdates
              });

              // Early grid refresh (may be stale, grid_updated will replace)
              refreshGrid(pId);

              // Poll for scene context update
              pollSceneContext(pId);

              // DON'T break — keep reading for late events (suggestions, discoveries)
            }

            if (data.error) {
              showToast(`Error: ${data.error}`, 'error');
            }
          }
        }

        // Process any remaining buffered data after stream closes
        if (lineBuffer.startsWith('data: ')) {
          try {
            const data = JSON.parse(lineBuffer.slice(6));
            if (data.grid_updated) {
              console.log('[SSE] grid_updated received (final buffer) — refreshing grid');
              refreshGrid(pId);
            }
          } catch { /* incomplete data — ignore */ }
        }
      } catch (err) {
        console.error('[SSE] Stream error:', err);
      } finally {
        // Safety net — if done was never received (error case), clean up
        if (!doneReceived) {
          isStreaming.set(false);
          streamingText.set('');
          streamingSkillCheck.set(null);
          streamingToolCall.set(null);
          resolve({
            fullMessage,
            sceneEntities: currentSceneEntities,
            discoveries: currentDiscoveries,
            skillCheck: currentSkillCheck,
            questDiscoveries: currentQuestDiscoveries,
            questUpdates: currentQuestUpdates
          });
        }
      }
    })();
  });
}

/**
 * Refresh the grid store from the API (non-blocking).
 */
function refreshGrid(pId) {
  api.getSceneGrid(pId).then(grid => {
    if (grid) gridData.set(grid);
  }).catch(err => {
    console.warn('[SSE] Grid refresh failed:', err.message);
  });
}

/**
 * Poll scene context until turnCount increments (fire-and-forget)
 */
function pollSceneContext(pId) {
  let prevTurn = 0;
  const unsub = sceneContext.subscribe(v => { prevTurn = v?.turnCount || 0; });
  unsub();

  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const ctx = await api.getSceneContext(pId);
      if (ctx && ctx.turnCount > prevTurn) {
        sceneContext.set(ctx);
        clearInterval(interval);
      }
    } catch { /* non-critical */ }
    if (attempts >= 10) clearInterval(interval);
  }, 3000);
}
