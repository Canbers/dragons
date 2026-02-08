# AGENTS.md - Architecture Overview

**Last updated:** 2026-02-08

> **IMPORTANT:** Update this file whenever architecture, files, or data flow changes.
> This is the primary reference for understanding the codebase between sessions.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Svelte + Vite) — client/                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Narrative │ │  Scene   │ │  Action  │  + Quest,  │
│  │   Log    │ │   Grid   │ │   Bar    │  Dice, Map │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       └─────────┬───┴───────────┘                   │
│           Svelte Stores (game state)                │
│                 │                                    │
│           SSE Service (event stream)                │
└─────────────────┼───────────────────────────────────┘
                  │ HTTP + SSE
┌─────────────────┼───────────────────────────────────┐
│  Backend (Express)                                   │
│  ┌──────────────┴──────────────┐                    │
│  │     routes/ (API layer)     │                    │
│  └──────────────┬──────────────┘                    │
│  ┌──────────────┴──────────────┐                    │
│  │   services/ (game engine)   │                    │
│  │  gameAgent, sceneGrid,      │                    │
│  │  spatial, quest, discovery  │                    │
│  └──────────────┬──────────────┘                    │
│  ┌──────────────┴──────────────┐                    │
│  │  db/models/ (Mongoose)      │                    │
│  └─────────────────────────────┘                    │
└─────────────────────────────────────────────────────┘
```

## Frontend — Svelte App (`client/`)

**Status:** Complete — 20 components built, compiles cleanly (DiceRoll & QuestDiscoveryCard removed — rendering is inline in MessageBubble)

### File Structure
```
client/src/
  main.js                     — Svelte 5 mount() entry point
  App.svelte                  — Root layout (two-column: narrative | grid), init flow
  app.css                     — CSS variables, animations, global styles

  lib/stores/ (8 stores)
    gameStore.js              — plotId, characterId, character, plot, derived location/time
    logStore.js               — messages[], streaming state, currentLogId
    gridStore.js              — gridData (grid[][], entities, player position, exits)
    sceneStore.js             — sceneContext (tension, NPCs, events, outcomes)
    questStore.js             — quests[], discoveries[], updates[]
    entityMenuStore.js        — Entity context menu state + show/hide functions
    modalStore.js             — activeModal + open/close functions
    toastStore.js             — Toast notifications with auto-dismiss

  lib/services/ (4 services)
    api.js                    — All REST API fetch wrappers
    sseService.js             — SSE stream parsing, dispatches to stores, grid refresh
    narrativeFormatter.js     — Pure functions: formatCompletedMessage, renderDiscoveryCards
    keyboard.js               — Global keyboard shortcuts (1-9 actions, Enter, Escape, M, J)

  lib/gridConstants.js        — TILE_DISPLAY (25 types), ENTITY_COLORS, getEntityChar()

  lib/components/ (20 components)
    NarrativeLog.svelte       — Scrollable game log, loads history, auto-scroll
    MessageBubble.svelte      — AI narrative (formatted HTML) or player bubble
    StreamingMessage.svelte   — "Story unfolds..." indicator with dice roll during stream
    ActionBar.svelte          — Text input + categorized action buttons + Ask GM
    SceneGrid.svelte          — rot.js Display, click→entity menu or door→movement
    SceneGridHeader.svelte    — Tension dot + location name
    EntityMenu.svelte         — Floating context menu for entities
    CharacterStrip.svelte     — Name, HP bar, mana bar, class/level
    ContextBar.svelte         — Location, activity, conditions, time chips
    GameButtons.svelte        — Journal/Rep/Story/Map/Settings buttons
    Toast.svelte              — Notification system with auto-dismiss
    Modal.svelte              — Reusable modal wrapper (backdrop, close, Escape)
    QuestJournal.svelte       — Active/Leads/Completed quest sections
    SettlementMap.svelte      — Location list with move/look actions
    SettingsModal.svelte      — Tone + difficulty selectors
    ReputationModal.svelte    — NPC/faction/location reputation display
    StorySummary.svelte       — AI story summary with add-to-log
    GameInitOverlay.svelte    — Full-screen init with progress bar + SSE
```

### Build
- `cd client && npm run dev` — Vite dev server on port 5173 (proxies to Express 3001)
- `cd client && npx vite build` — Production build → `client/dist/`
- Bundle: ~111KB JS (39KB gzipped), ~26KB CSS (5KB gzipped)

### Legacy Frontend (`public/`)
Original vanilla JS files — kept during migration, will be removed after:
- `app.js` (1686 lines) — monolith: SSE, DOM, game log, quests, input
- `MapViewer.js` (539 lines) — scene grid + settlement map + scene context
- `grid-renderer.js` (270 lines) — rot.js grid rendering
- `narrative-formatter.js` (261 lines) — dialogue bubbles, entity links
- `action-panel.js` (216 lines) — categorized action buttons
- `index.html`, `styles.css`, `map-styles.css`

## Backend — Services

### services/gameAgent.js (~730 lines) — Game Turn Orchestrator
The main game engine. Orchestrates the full turn loop by coordinating extracted services:
1. Player input → AI tool planning via `toolPlanPrompt()` (gptService)
2. Tool execution (get_scene, lookup_npc, move_player, skill_check, etc.)
3. Spatial context injection (distance/direction to entities)
4. Narrative streaming via `streamMessages()` (gptService)
5. Background updates delegated to sceneContextService, questService, discoveryService
6. Grid position updates delegated to gridMovementService

**Key functions:**
- `processInput()` — Main entry point. Orchestrates the full turn.
- `executeTool()` — Dispatcher for all tool calls
- `executeLookupNpc()`, `executeMovePlayer()`, `executeUpdateRelationship()`, `executeSkillCheck()`, `executeUpdateQuest()` — Individual tool executors
- `runDiscoveryParsing()` — Post-narrative discovery parsing (delegates to discoveryService)

### services/sceneManager.js (~225 lines) — Scene Data & First Impressions
Extracted from gameAgent.js. Handles scene loading and new location initialization.
- `executeGetScene(plotId)` — Grid generation, first impressions, POI creation
- `generateFirstImpression(settlement, location)` — AI creates initial POIs + gridParams
- `getTypeSpecificParamsPrompt(locationType)` — Helper for first-impression prompts

### services/gridMovementService.js (~195 lines) — Grid Movement
Extracted from gameAgent.js. Player and NPC movement on the tile grid after each action.
- `updateGridPositions(plotId, input, didMove, lookedUpNpcNames)` — Player moves toward interacted entity, NPC moves toward player

### services/sceneContextService.js (~200 lines) — Background Scene Updates
Extracted from gameAgent.js. Background GPT call for NPC arrivals/departures, tension changes.
- `updateSceneContextBackground(plotId, prevContext, enrichedContext, input, fullResponse)` — Uses atomic `$set` to avoid race conditions

### services/toolFormatters.js (~85 lines) — Pure Functions
Extracted from gameAgent.js. Human-readable formatting for tool calls.
- `getToolDisplay(toolName, args)` — Tool call descriptions for debug/UI
- `formatToolResult(toolName, result)` — Formats tool results as text context for AI

### services/suggestionService.js (~60 lines) — Action Suggestions
Extracted from gameAgent.js. Generates categorized quick actions after each turn.
- `generateCategorizedSuggestions(enrichedContext, input, fullResponse)` — Returns { categories, flatActions }

### services/locationResolver.js (~65 lines) — Shared Utility
Eliminates 7 copy-pasted "find current location" patterns across the codebase.
- `getCurrentLocation(plot, settlement)` — Resolves location from plot state
- `getSettlementAndLocation(plotId)` — DB query + resolution in one call

### services/plotInitService.js (~110 lines) — Plot Initialization
Extracted from routes/plots.js. GPT-heavy initialization of new game sessions.
- `initializePlot(plot, sendEvent)` — Describe region, generate locations, create opening narrative

### services/gptService.js (~250 lines) — Centralized OpenAI Access
ALL OpenAI API calls go through this service. Exports:
- `prompt()` — Game interaction with Indifferent World system prompt + JSON mode
- `simplePrompt()` — Utility tasks with custom system prompt + JSON mode
- `streamPrompt()` — Streaming with world system prompt (async generator)
- `toolPlanPrompt()` — Tool-calling with function definitions
- `streamMessages()` — Streaming with custom messages (returns stream object)
- `chatCompletion()` — Simple completion with custom messages (no JSON mode)
- `summarizeLogs()` — Log summarization for memory persistence
- `generateStorySummary()` — AI story summary from game logs
- `buildSystemPrompt()` — Assembles world prompt with tone/difficulty/structure modifiers
- Constants: `GAME_MODEL`, `UTILITY_MODEL`, `TONE_MODIFIERS`, `DIFFICULTY_MODIFIERS`, `STRUCTURE_DIRECTIVES`

### services/sceneGridService.js (~860 lines)
Procedural grid generation for all 14 location types via 6 category generators:
- building_interior, open_space, fortification, underground, waterfront, religious
- `generateSceneGrid()` — Creates 2D tile array
- `placeEntitiesOnGrid()` — Semantic placement (bartender→counter, priest→altar)
- `generateAmbientNpcs()` — Background NPC population
- `findPlayerStart()`, `stepToward()`, `findAdjacentWalkable()`, `findDoors()`

### services/spatialService.js (~70 lines)
Distance/direction calculations for AI prompt injection:
- `manhattanDistance()`, `getZone()` (ADJACENT/CLOSE/NEAR/FAR/DISTANT)
- `getDirectionTo()` — 8-point compass from atan2
- `generateSpatialContext()` — Builds text block for AI narrative prompts

### services/questService.js (~600 lines)
Organic quest lifecycle: seed → discovered → active → completed/failed/expired
- `shouldGenerateSeeds()`, `generateQuestSeeds()` — Background probability
- `getHooksForNarrative()` — Rate-limited quest hooks for AI to weave in
- `detectQuestDiscovery()` — Fuzzy text matching
- `activateQuest()`, `updateQuestProgress()`, `getJournalQuests()`

### services/discoveryService.js (~260 lines)
Parses AI narrative for new entity discoveries, persists to DB.

### services/tileConstants.js (~85 lines)
Shared tile enum (25 types), display metadata, walkability rules. Used by both backend generators and frontend renderer.

### Other services
- `services/layoutService.js` (~355 lines) — BFS layout for settlement SVG maps
- `services/movementService.js` (~520 lines) — Location-to-location movement logic

## Backend — Routes

### routes/plots.js (~775 lines)
Main game API. Uses extracted services (plotInitService, gptService, locationResolver).
Key endpoints:
- `POST /api/plots/:id/action` — Player action → SSE stream of game events
- `POST /api/plots/:id/initialize` — New game initialization (delegates to plotInitService)
- `GET /api/plots/:id/scene-grid` — Grid + entities + player position
- `GET /api/plots/:id/scene-context` — Tension, NPCs present, events
- `GET /api/plots/:id/location` — Current location data
- `GET /api/plots/:id/quests` — Quest journal
- `GET /api/plots/:id/story-summary` — AI story summary (delegates to gptService)
- `GET /api/plots/:id/map-data` — Settlement map data (uses locationResolver)
- `POST /api/plots/:id/quests/:qid/track` — Activate a quest

### routes/gameLogs.js (~185 lines)
Game log CRUD + SSE relay for real-time events.

## Database Models

### Plot.js
Game session state. Key fields:
- `current_state.location` — Current location ID
- `current_state.gridPosition` — Player {x, y} on scene grid
- `current_state.sceneContext` — Tension, NPCs, events, outcomes
- `current_state.questState` — Active quest tracking

### Settlement.js
World locations. Key fields on LocationSchema:
- `interiorGrid` — 2D tile array (number[][])
- `gridParams` — AI-generated { condition, wealth, clutter, lighting }
- `gridGenerated` — Boolean flag
- `ambientNpcs` — [{x, y}] background NPC positions
- `connections` — Links to other locations with directions

### Poi.js
Points of interest (NPCs, objects, entrances, landmarks):
- `gridPosition` — {x, y} on scene grid
- `settlement`, `locationId` — Where this POI lives
- Can move between locations via `movePoi()`

### Quest.js
Quest lifecycle: seed → discovered → active → completed/failed/expired
- `hooks` — Narrative hooks for AI to weave in
- `objectives`, `progression` — Tracking

### GameLog.js
Chat history with metadata:
- `sceneEntities`, `discoveries`, `exits` — Per-message state for reload
- `skillCheck` — Dice roll data
- `questUpdates` — Quest changes

## Data Flow — Game Turn

```
Player types input (or clicks grid entity)
  → POST /api/plots/:id/action
  → gameAgent.processInput()
    → Step 1: AI decides tools to call
    → Step 2: Execute tools (get_scene, lookup_npc, etc.)
    → Step 3: Build spatial context from grid positions
    → Step 4: Stream narrative via SSE
    → Step 5: Background updates (scene context, quests, discoveries)
    → Step 6: Update grid positions (player + NPC movement)
  → SSE events dispatched to frontend
    → Narrative chunks → log store → NarrativeLog renders
    → Grid updates → grid store → SceneGrid re-renders
    → Skill checks → inline dice roll component
    → Quest events → quest store → discovery cards / journal
```

## Data Flow — Grid Generation

```
Player enters new location (first visit)
  → executeGetScene()
    → generateFirstImpression() — AI creates POIs + gridParams
    → sceneGridService.generateSceneGrid() — Procedural tile array
    → sceneGridService.placeEntitiesOnGrid() — Semantic positions
    → sceneGridService.generateAmbientNpcs() — Background population
    → Save to DB: Settlement.locations[].interiorGrid, Poi.gridPosition, Plot.gridPosition
  → Frontend fetches GET /scene-grid
    → rot.js renders tiles + entities + player @
```

## SSE Event Types
Current (ad-hoc, being normalized):
- Raw text chunks (narrative streaming)
- `scene_entities` — NPCs/objects/exits for scene panel
- `skill_check` — Dice roll data
- `quest_discovered` — New quest lead found
- `quest_update` — Quest progress change
- `done` — Turn complete, trigger refresh

## Key Design Decisions
See `memory/decisions.md` for full history with rationale.
