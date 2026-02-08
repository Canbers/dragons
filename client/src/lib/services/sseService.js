/**
 * sseService.js — Handles streaming action submission and SSE parsing.
 * Dispatches events to stores as they arrive.
 */

import { get } from 'svelte/store';
import { plotId } from '../stores/gameStore.js';
import { actions } from '../stores/gameStore.js';
import { messages, isStreaming, streamingText, streamingSkillCheck, streamingToolCall } from '../stores/logStore.js';
import { gridData } from '../stores/gridStore.js';
import { sceneContext, sceneEntities } from '../stores/sceneStore.js';
import { questDiscoveries, questUpdates } from '../stores/questStore.js';
import { showToast } from '../stores/toastStore.js';
import * as api from './api.js';

/**
 * Submit a player action and process the SSE response stream.
 * @param {string} input - Player input text
 * @param {string} inputType - 'play' or 'askGM'
 * @returns {Promise<{fullMessage, sceneEntities, discoveries, skillCheck, questDiscoveries, questUpdates}>}
 */
export async function submitAction(input, inputType = 'play') {
  const pId = get(plotId);
  if (!pId) throw new Error('No plotId');

  isStreaming.set(true);
  streamingText.set('');
  streamingSkillCheck.set(null);
  streamingToolCall.set(null);

  // Reset per-action accumulators
  let fullMessage = '';
  let currentSceneEntities = null;
  let currentDiscoveries = null;
  let currentSkillCheck = null;
  let currentQuestDiscoveries = [];
  let currentQuestUpdates = [];

  try {
    const response = await api.submitActionStream(input, inputType, pId);
    if (!response) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

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

        if (data.debug) {
          // Could dispatch to a debug store — skip for now
        }

        if (data.done) {
          // Refresh grid after action
          try {
            const grid = await api.getSceneGrid(pId);
            if (grid) gridData.set(grid);
          } catch { /* non-critical */ }

          // Poll for scene context update
          pollSceneContext(pId);
        }

        if (data.error) {
          showToast(`Error: ${data.error}`, 'error');
        }
      }
    }

    return {
      fullMessage,
      sceneEntities: currentSceneEntities,
      discoveries: currentDiscoveries,
      skillCheck: currentSkillCheck,
      questDiscoveries: currentQuestDiscoveries,
      questUpdates: currentQuestUpdates
    };
  } finally {
    isStreaming.set(false);
    streamingText.set('');
    streamingSkillCheck.set(null);
    streamingToolCall.set(null);
  }
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
