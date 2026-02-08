import { get } from 'svelte/store';
import { token } from '../stores/gameStore.js';

function getHeaders(json = false) {
  const headers = {};
  const t = get(token);
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(!!options.body), ...options.headers }
  });
  if (res.status === 401) {
    window.location.href = '/authorize';
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ========== Game Info ==========

export async function getGameInfo(plotId, characterId) {
  return fetchJSON(`/api/game-info?plotId=${plotId}&characterId=${characterId}`);
}

// ========== Plot ==========

export async function getPlot(plotId) {
  return fetchJSON(`/api/plots/${plotId}`, { cache: 'no-store' });
}

export async function getPlotSettings(plotId) {
  return fetchJSON(`/api/plots/${plotId}/settings`);
}

export async function savePlotSettings(plotId, settings) {
  return fetchJSON(`/api/plots/${plotId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

// ========== Game Logs ==========

export async function getRecentGameLog(plotId) {
  return fetchJSON(`/api/game-logs/recent/${plotId}`);
}

export async function getGameLogById(gameLogId, plotId) {
  return fetchJSON(`/api/game-logs/${gameLogId}/${plotId}`);
}

export async function saveGameLog(plotId, logEntry) {
  return fetchJSON('/api/game-logs', {
    method: 'POST',
    body: JSON.stringify({ plotId, ...logEntry })
  });
}

// ========== Streaming (returns raw Response for SSE parsing) ==========

export async function submitActionStream(input, inputType, plotId) {
  const res = await fetch('/api/input/stream', {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({ input, inputType, plotId })
  });
  if (res.status === 401) {
    window.location.href = '/authorize';
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ========== Scene Grid ==========

export async function getSceneGrid(plotId) {
  return fetchJSON(`/api/plots/${plotId}/scene-grid`);
}

// ========== Scene Context ==========

export async function getSceneContext(plotId) {
  return fetchJSON(`/api/plots/${plotId}/scene-context`);
}

// ========== Location ==========

export async function getLocation(plotId) {
  return fetchJSON(`/api/plots/${plotId}/location`);
}

// ========== Movement ==========

export async function moveToLocation(plotId, targetId, targetName) {
  return fetchJSON(`/api/plots/${plotId}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetId: targetId || undefined, targetName })
  });
}

// ========== Quests ==========

export async function getQuests(plotId) {
  return fetchJSON(`/api/plots/${plotId}/quests`);
}

export async function trackQuest(plotId, questId) {
  return fetchJSON(`/api/plots/${plotId}/quests/${questId}/track`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

// ========== Reputation ==========

export async function getReputation(plotId) {
  return fetchJSON(`/api/plots/${plotId}/reputation`);
}

// ========== Story Summary ==========

export async function getStorySummary(plotId) {
  return fetchJSON(`/api/plots/${plotId}/story-summary`);
}

// ========== World & Region ==========

export async function getWorldAndRegion(plotId) {
  return fetchJSON(`/api/world-and-region/${plotId}`);
}

// ========== Initialize Plot ==========

export async function initializePlot(plotId) {
  const res = await fetch(`/api/plot/${plotId}/initialize`, {
    method: 'POST',
    headers: getHeaders(true)
  });
  return res;
}
