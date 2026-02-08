<script>
  import { onMount } from 'svelte';
  import { plotId, characterId, character, plot, currentTime } from './lib/stores/gameStore.js';
  import { messages, currentLogId, oldestLogId } from './lib/stores/logStore.js';
  import { gridData } from './lib/stores/gridStore.js';
  import { sceneContext } from './lib/stores/sceneStore.js';
  import * as api from './lib/services/api.js';
  import { submitAction } from './lib/services/sseService.js';
  import NarrativeLog from './lib/components/NarrativeLog.svelte';
  import ActionBar from './lib/components/ActionBar.svelte';
  import EntityMenu from './lib/components/EntityMenu.svelte';
  import SceneGrid from './lib/components/SceneGrid.svelte';
  import SceneGridHeader from './lib/components/SceneGridHeader.svelte';
  import CharacterStrip from './lib/components/CharacterStrip.svelte';
  import ContextBar from './lib/components/ContextBar.svelte';
  import GameButtons from './lib/components/GameButtons.svelte';
  import Toast from './lib/components/Toast.svelte';
  import QuestJournal from './lib/components/QuestJournal.svelte';
  import SettlementMap from './lib/components/SettlementMap.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import ReputationModal from './lib/components/ReputationModal.svelte';
  import StorySummary from './lib/components/StorySummary.svelte';
  import GameInitOverlay from './lib/components/GameInitOverlay.svelte';
  import { initKeyboard } from './lib/services/keyboard.js';

  let loaded = $state(false);
  let error = $state(null);
  let needsInit = $state(false);

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const pId = params.get('plotId');
    const cId = params.get('characterId');

    if (!pId || !cId) {
      error = 'No plotId or characterId in URL. Add ?plotId=X&characterId=Y';
      return;
    }

    plotId.set(pId);
    characterId.set(cId);

    try {
      // Check plot status — may need initialization
      const plotData = await api.getPlot(pId);
      if (plotData) {
        plot.set(plotData);
        const status = plotData.status;
        if (status === 'created' || status === 'error') {
          needsInit = true;
          return; // Wait for init overlay to complete
        }
      }

      await loadGameData(pId, cId);
    } catch (e) {
      console.error('[Dragons] Init error:', e);
      error = e.message;
    }

    // Init keyboard shortcuts
    return initKeyboard();
  });

  async function loadGameData(pId, cId) {
    const gameInfo = await api.getGameInfo(pId, cId);
    if (gameInfo) {
      plot.set(gameInfo.plot);
      character.set(gameInfo.character);
    }

    try {
      const logData = await api.getRecentGameLog(pId);
      if (logData) {
        messages.set(logData.messages || []);
        currentLogId.set(logData.logId);
        oldestLogId.set(logData.logId);
      }
    } catch (e) {
      if (!e.message.includes('404')) throw e;
    }

    try {
      const grid = await api.getSceneGrid(pId);
      if (grid) gridData.set(grid);
    } catch { /* no grid yet */ }

    try {
      const ctx = await api.getSceneContext(pId);
      if (ctx) sceneContext.set(ctx);
    } catch { /* no context yet */ }

    loaded = true;
    console.log('[Dragons] App loaded. Character:', gameInfo?.character?.name);
  }

  async function handleInitComplete() {
    needsInit = false;
    try {
      await loadGameData($plotId, $characterId);
    } catch (e) {
      console.error('[Dragons] Post-init load error:', e);
      error = e.message;
    }
  }

  async function handleSubmit(text, inputType) {
    const pId = $plotId;

    // Add player message to log immediately
    messages.update(m => [...m, {
      _id: 'player-' + Date.now(),
      author: 'Player',
      content: text,
      timestamp: new Date().toISOString()
    }]);

    // Stream AI response
    const result = await submitAction(text, inputType);

    if (result?.fullMessage) {
      // Add final AI message to log
      const aiMsg = {
        _id: 'ai-' + Date.now(),
        author: 'AI',
        content: result.fullMessage,
        timestamp: new Date().toISOString(),
        sceneEntities: result.sceneEntities || null,
        discoveries: result.discoveries || null,
        skillCheck: result.skillCheck || null,
        questUpdates: result.questUpdates?.length > 0 ? result.questUpdates : null
      };

      // Add quest discoveries as questUpdates for consistency
      if (result.questDiscoveries?.length > 0) {
        const discoveryUpdates = result.questDiscoveries.map(q => ({
          questId: q.id, title: q.title, status: 'discovered'
        }));
        aiMsg.questUpdates = [...(aiMsg.questUpdates || []), ...discoveryUpdates];
      }

      messages.update(m => [...m, aiMsg]);

      // Save to server
      const token = localStorage.getItem('authToken');
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
      await fetch('/api/game-logs', {
        method: 'POST', headers,
        body: JSON.stringify({ plotId: pId, author: 'Player', content: text })
      });
      const aiLogBody = { plotId: pId, author: 'AI', content: result.fullMessage };
      if (result.sceneEntities) aiLogBody.sceneEntities = result.sceneEntities;
      if (result.discoveries?.length > 0) aiLogBody.discoveries = result.discoveries;
      if (result.skillCheck) aiLogBody.skillCheck = result.skillCheck;
      if (aiMsg.questUpdates) aiLogBody.questUpdates = aiMsg.questUpdates;
      await fetch('/api/game-logs', { method: 'POST', headers, body: JSON.stringify(aiLogBody) });

      // Refresh sidebar data
      try {
        const gameInfo = await api.getGameInfo(pId, $characterId);
        if (gameInfo) {
          plot.set(gameInfo.plot);
          character.set(gameInfo.character);
        }
      } catch { /* non-critical */ }
    }
  }

  function handleEntityAction(actionText) {
    handleSubmit(actionText, 'play');
  }

  function handleDoorClick(exit) {
    handleSubmit(`I go to ${exit.name}`, 'play');
  }
</script>

{#if needsInit}
  <GameInitOverlay onComplete={handleInitComplete} />
{:else if error}
  <div class="error-screen">
    <h2>Failed to load</h2>
    <p>{error}</p>
  </div>
{:else if !loaded}
  <div class="loading-screen">
    <div class="loading-dragon">&#x1F409;</div>
    <p>Loading your adventure...</p>
  </div>
{:else}
  <div class="game-layout">
    <!-- LEFT COLUMN: Narrative -->
    <div class="narrative-column">
      <div class="game-header">
        <h1 class="world-name">Dragons</h1>
        <div class="header-status">
          <span class="status-chip">{$currentTime}</span>
          {#if $character}
            <span class="status-chip health">HP {$character.currentStatus?.health ?? '--'}</span>
          {/if}
        </div>
      </div>

      <div class="chat-section">
        <NarrativeLog />

        <ContextBar />

        <ActionBar onSubmit={handleSubmit} />
      </div>
    </div>

    <!-- RIGHT COLUMN: Scene Grid -->
    <div class="scene-column">
      <div class="grid-panel">
        <SceneGridHeader />
        <SceneGrid onDoorClick={handleDoorClick} />
      </div>

      <CharacterStrip />
      <GameButtons />
    </div>
  </div>

  <EntityMenu onAction={handleEntityAction} />
  <Toast />
  <QuestJournal />
  <SettlementMap onAction={handleEntityAction} />
  <SettingsModal />
  <ReputationModal />
  <StorySummary />
{/if}

<style>
  .error-screen, .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
    gap: 16px;
  }

  .loading-dragon {
    font-size: 4rem;
    animation: breathe 3s ease-in-out infinite;
  }

  .error-screen h2 {
    color: var(--accent-health);
    font-family: 'Crimson Text', serif;
  }

  .game-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    height: 100vh;
    padding: 16px;
  }

  .narrative-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .game-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-panel);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    margin-bottom: 12px;
  }

  .world-name {
    font-family: 'Crimson Text', serif;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--accent-gold);
  }

  .header-status {
    display: flex;
    gap: 12px;
  }

  .status-chip {
    background: var(--bg-input);
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    font-size: 0.85rem;
  }

  .status-chip.health {
    color: var(--accent-health);
  }

  .chat-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  .scene-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    overflow: hidden;
  }

  .grid-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
    min-height: 0;
  }

  @media (max-width: 900px) {
    .game-layout {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
      padding: 8px;
      gap: 8px;
    }
  }
</style>
