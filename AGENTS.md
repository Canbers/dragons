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

**Status:** Complete — all components built, compiles cleanly

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

  lib/components/ (22 components)
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
    DiceRoll.svelte           — Standalone animated d20 skill check card
    QuestDiscoveryCard.svelte — Standalone quest discovery card with Track button
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

### services/gameAgent.js (1474 lines) — THE GOD FILE
The main game engine. Handles the full turn loop:
1. Player input → AI tool planning (which tools to call)
2. Tool execution (get_scene, lookup_npc, move_player, skill_check, etc.)
3. Spatial context injection (distance/direction to entities)
4. Narrative streaming (AI generates response with tool context)
5. Background updates (scene context, quest seeds, discovery parsing)
6. Grid position updates (player/NPC movement on tile grid)

**Key functions:**
- `processInput()` — Main entry point. Orchestrates the full turn.
- `executeGetScene()` — Grid generation, first impressions, POI creation
- `updateGridPositions()` — Player/NPC movement on grid after each turn
- `updateSceneContextBackground()` — Background NPC arrival/departure
- `generateFirstImpression()` — AI creates initial POIs + gridParams for new locations
- `executeSkillCheck()` — d20 dice roll mechanic

**Needs refactoring into:** sceneManager, movementManager, narrativeManager, toolExecutor

### services/sceneGridService.js (861 lines)
Procedural grid generation for all 14 location types via 6 category generators:
- building_interior, open_space, fortification, underground, waterfront, religious
- `generateSceneGrid()` — Creates 2D tile array
- `placeEntitiesOnGrid()` — Semantic placement (bartender→counter, priest→altar)
- `generateAmbientNpcs()` — Background NPC population
- `findPlayerStart()`, `stepToward()`, `findAdjacentWalkable()`, `findDoors()`

### services/spatialService.js (68 lines)
Distance/direction calculations for AI prompt injection:
- `manhattanDistance()`, `getZone()` (ADJACENT/CLOSE/NEAR/FAR/DISTANT)
- `getDirectionTo()` — 8-point compass from atan2
- `generateSpatialContext()` — Builds text block for AI narrative prompts

### services/questService.js (603 lines)
Organic quest lifecycle: seed → discovered → active → completed/failed/expired
- `shouldGenerateSeeds()`, `generateQuestSeeds()` — Background probability
- `getHooksForNarrative()` — Rate-limited quest hooks for AI to weave in
- `detectQuestDiscovery()` — Fuzzy text matching
- `activateQuest()`, `updateQuestProgress()`, `getJournalQuests()`

### services/discoveryService.js (257 lines)
Parses AI narrative for new entity discoveries, persists to DB.

### services/tileConstants.js
Shared tile enum (25 types), display metadata, walkability rules. Used by both backend generators and frontend renderer.

### Other services
- `services/gptService.js` — OpenAI API wrapper, system prompt builder
- `services/layoutService.js` — BFS layout for settlement SVG maps
- `services/movementService.js` — Location-to-location movement logic

## Backend — Routes

### routes/plots.js (938 lines)
Main game API. Key endpoints:
- `POST /api/plots/:id/action` — Player action → SSE stream of game events
- `GET /api/plots/:id/scene-grid` — Grid + entities + player position
- `GET /api/plots/:id/scene-context` — Tension, NPCs present, events
- `GET /api/plots/:id/location` — Current location data
- `GET /api/plots/:id/quests` — Quest journal
- `POST /api/plots/:id/quests/:qid/track` — Activate a quest

### routes/gameLogs.js
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
