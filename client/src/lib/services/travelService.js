import { get } from 'svelte/store';
import { plotId, characterId, plot, character } from '../stores/gameStore.js';
import { messages } from '../stores/logStore.js';
import { gridData } from '../stores/gridStore.js';
import { sceneContext } from '../stores/sceneStore.js';
import { travelState } from '../stores/settlementStore.js';
import { showToast } from '../stores/toastStore.js';
import * as api from './api.js';

/**
 * Travel to a location via direct API call — bypasses the SSE/AI pipeline.
 * Used by both SettlementOverview and door/exit clicks in TileTooltip.
 *
 * @param {string|null} targetId - Target location ObjectId (if known)
 * @param {string} targetName - Target location name
 */
export async function travelTo(targetId, targetName) {
  const pId = get(plotId);
  const cId = get(characterId);
  if (!pId) return;

  travelState.set({ traveling: true, targetName });

  try {
    const result = await api.moveToLocation(pId, targetId, targetName);

    if (!result.success) {
      showToast(result.error || 'Cannot travel there', 'error');
      travelState.set({ traveling: false, targetName: null });
      return;
    }

    // Add narration to chat
    if (result.narration) {
      messages.update(m => [...m, {
        _id: 'travel-' + Date.now(),
        author: 'System',
        content: result.narration,
        timestamp: new Date().toISOString()
      }]);
    }

    // Show discovery toast
    if (result.discovered) {
      showToast(`Discovered: ${targetName}`, 'discovery');
    }

    // Refresh stores in parallel
    const [gridResult, gameInfo, ctx] = await Promise.all([
      api.getSceneGrid(pId).catch(() => null),
      api.getGameInfo(pId, cId).catch(() => null),
      api.getSceneContext(pId).catch(() => null),
    ]);

    if (gridResult) gridData.set(gridResult);
    if (gameInfo) {
      plot.set(gameInfo.plot);
      character.set(gameInfo.character);
    }
    if (ctx) sceneContext.set(ctx);

  } catch (e) {
    console.error('[Travel] Error:', e);
    showToast('Travel failed: ' + e.message, 'error');
  } finally {
    travelState.set({ traveling: false, targetName: null });
  }
}
