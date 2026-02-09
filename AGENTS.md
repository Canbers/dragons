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

**Status:** Complete — 21 components, compiles cleanly. Landing + Profile pages migrated from vanilla JS. DiceRoll & QuestDiscoveryCard rendering is inline in MessageBubble via narrativeFormatter. Scene rendering: Konva.js with Kenney spritesheet (replacing rot.js Display). Settlement travel: direct API (bypassing SSE pipeline).

### File Structure
```
client/src/
  main.js                     — Svelte 5 mount() entry point
  App.svelte                  — Page router (landing|profile|game) + game layout, init flow
  app.css                     — CSS variables, animations, global styles

  lib/stores/ (11 stores)
    gameStore.js              — plotId, characterId, character, plot, derived location/time
    logStore.js               — messages[], streaming state, currentLogId, worldReaction
    gridStore.js              — gridData (grid[][], entities, player position, exits)
    sceneStore.js             — sceneContext (tension, NPCs, events, outcomes)
    questStore.js             — quests[], discoveries[], updates[]
    entityMenuStore.js        — Entity context menu state + show/hide (for narrative entity links)
    tileTooltipStore.js       — Tile tooltip state for grid clicks (replaces EntityMenu for grid)
    settlementStore.js        — settlementData + travelState for direct travel
    modalStore.js             — activeModal + open/close functions
    toastStore.js             — Toast notifications with auto-dismiss
    authStore.js              — user, authenticated, checkAuth() for Landing/Profile pages

  lib/services/ (5 services)
    api.js                    — All REST API fetch wrappers
    sseService.js             — SSE stream parsing, early-done unblock, late event handling, turn guard, world_reaction handler
    travelService.js          — Direct code-only travel (bypasses SSE/AI pipeline), refreshes stores
    narrativeFormatter.js     — Pure functions: formatCompletedMessage, renderDiscoveryCards
    keyboard.js               — Global keyboard shortcuts (1-9 actions, Enter, Escape, M, J)

  lib/gridConstants.js        — TILE_DISPLAY (25 types w/ names), ENTITY_COLORS, WALKABLE_TILES, ANIMATED_TILES, PLAYER_PULSE, getEntityChar(), getDirectionPhrase()
  lib/tileSprites.js          — Kenney spritesheet coordinate mapping for 25 tile types, FURNITURE_TILES

  lib/components/ (21 components)
    Landing.svelte            — Landing page: hero, features, login/profile buttons
    Profile.svelte            — Profile page: user info, character CRUD, 5 modals (join/world/region/character/new-world)
    NarrativeLog.svelte       — Scrollable game log, loads history, auto-scroll
    MessageBubble.svelte      — AI narrative (formatted HTML) or player bubble
    StreamingMessage.svelte   — "Story unfolds..." indicator with dice roll during stream
    ActionBar.svelte          — Text input + categorized action buttons + Ask GM
    SceneGrid.svelte          — Konva.js canvas with Kenney sprite tiles, click→tile tooltip, animation loop (torches/water/player pulse)
    SceneGridHeader.svelte    — Tension dot + location name
    TileTooltip.svelte        — Rich tile inspection: NPC/object/door/ambient/walkable/furniture tooltips + free-text input
    EntityMenu.svelte         — Floating context menu for narrative entity links (kept for text entity clicks)
    CharacterStrip.svelte     — Name, HP bar, mana bar, class/level
    ContextBar.svelte         — Location, activity, conditions, time chips
    GameButtons.svelte        — Journal/Rep/Story/Map/Settings buttons
    Toast.svelte              — Notification system with auto-dismiss
    Modal.svelte              — Reusable modal wrapper (backdrop, close, Escape)
    QuestJournal.svelte       — Active/Leads/Completed quest sections
    SettlementOverview.svelte — SVG spatial node graph with direct travel (replaces SettlementMap)
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
Original vanilla JS files — kept during migration, can be removed once Svelte is fully verified:
- `app.js` (1686 lines) — monolith: SSE, DOM, game log, quests, input
- `MapViewer.js` (539 lines) — scene grid + settlement map + scene context
- `grid-renderer.js` (270 lines) — rot.js grid rendering
- `narrative-formatter.js` (261 lines) — dialogue bubbles, entity links
- `action-panel.js` (216 lines) — categorized action buttons
- `landing.html`, `landing.js`, `profile.html`, `profile.js`, `auth.js` — **Superseded by Svelte Landing/Profile**
- `index.html`, `styles.css`, `map-styles.css`

## Backend — Services

### services/gameAgent.js (~770 lines) — Game Turn Orchestrator
The main game engine. Orchestrates the full turn loop by coordinating extracted services:
1. Speculative `get_scene` starts in parallel with planning
2. Player input → AI tool planning via `toolPlanPrompt()` (gptService, **UTILITY_MODEL** for speed)
3. Tool execution **in parallel** (move_player runs last if present)
4. Spatial context injection (distance/direction to entities)
5. Narrative streaming via `streamMessages()` (gptService, GAME_MODEL)
6. **yield `done` → player unblocked** (input re-enabled immediately after narrative)
7. **Grid position update + yield `grid_updated`** — immediately after done for fast refresh
8. **Late events** (suggestions, discoveries, quest discovery) yielded after grid update — arrive asynchronously
9. **Game log persistence via gameLogService** — Player input + AI response saved server-side with all metadata

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

### services/gridMovementService.js (~310 lines) — Grid Movement
Extracted from gameAgent.js. Player and NPC movement on the tile grid after each action.
- `updateGridPositions(plotId, input, didMove, lookedUpNpcNames, moveTarget)` — Exact click-to-move (moveTarget), directional movement, entity-seeking, door-seeking
- `stepInDirection(grid, from, dx, dy, occupied)` — Single step with perpendicular fallbacks
- `parseDirectionFromInput(inputLower)` — Extracts compass direction + step count from text

### services/sceneContextService.js (~200 lines) — Background Scene Updates
Extracted from gameAgent.js. Background GPT call for NPC arrivals/departures, tension changes.
- `updateSceneContextBackground(plotId, prevContext, enrichedContext, input, fullResponse)` — Uses atomic `$set` to avoid race conditions

### services/npcContextService.js (~90 lines) — Shared NPC Context Builder
Utility for building rich NPC prompt context, used by Tier 1 and Tier 2/3 pipelines.
- `buildNpcPromptContext(npc, repNpc)` — Prompt-ready text block from POI + reputation
- `getDetailedNpcContext(npcName, settlementId, locationId, plotId)` — Full DB query + context
- `formatTensions(tensions)` — Formats location tensions as prompt text

### services/toolFormatters.js (~95 lines) — Pure Functions
Extracted from gameAgent.js. Human-readable formatting for tool calls.
- `getToolDisplay(toolName, args)` — Tool call descriptions for debug/UI
- `formatToolResult(toolName, result)` — Formats tool results as text context for AI (includes NPC personality/goal/problem, location tensions)

### services/suggestionService.js (~60 lines) — Action Suggestions
Extracted from gameAgent.js. Generates categorized quick actions after each turn.
- `generateCategorizedSuggestions(enrichedContext, input, fullResponse)` — Returns { categories, flatActions }

### services/inputClassifier.js (~210 lines) — Action Classification
Deterministic (no GPT) classifier that routes player input to the correct processing tier:
- `classify(input, plotId, options)` → `{ tier: 0|1|2|3, actionType, params }`
- Tier 0: Code-only, template responses (movement, look, rest, wait, gesture, examine, exits)
- Tier 1: UTILITY_MODEL quick AI (NPC greetings, simple questions, eat/drink, eavesdrop, flavor)
- Tier 2: GAME_MODEL compressed context (skill checks, deep dialogue)
- Tier 3: Full pipeline (default, everything else)
- Promotion rules: tension >= tense → minimum Tier 2; in combat → minimum Tier 2

### services/fastActionService.js (~520 lines) — Tier 0/1 Response Handlers
Async generator with same interface as `gameAgent.processInput()` so route handler stays identical.
- `execute(input, plotId, classification, options)` — Main entry point
- Tier 0 handlers: handleMovement, handleLookAround, handleExamineEntity, handleRest, handleWait, handleCheckExits, handleGesture
- Tier 1 handlers: handleNpcInteraction, handleSimpleInteract, handleFlavorAction, handleEavesdrop
- Uses location-specific templates for movement responses
- Fires worldTickService.check() after completion for world reactions
- Saves compressed game log via gameLogService.saveQuickAction()

### services/worldTickService.js (~250 lines) — Background Consequence Checker
Fires after Tier 0/1 actions. Debounced per-plot (500ms) to batch rapid actions.
- `check(plotId, input, actionType, result, callback)` — Queue a world tick
- `cancel(plotId)` — Cancel pending tick (when Tier 2/3 starts)
- `proactiveNpcAction(plotId, location, settlement, callback)` — ~10% chance per tick: NPC acts on their own goal in the background
- Uses UTILITY_MODEL to check if NPCs/world react
- Skip conditions: no NPCs + calm, pure flavor in calm areas, random 80% skip for quiet+calm
- Callback streams `world_reaction` events via SSE

### services/locationResolver.js (~65 lines) — Shared Utility
Eliminates 7 copy-pasted "find current location" patterns across the codebase.
- `getCurrentLocation(plot, settlement)` — Resolves location from plot state
- `getSettlementAndLocation(plotId)` — DB query + resolution in one call

### services/plotInitService.js (~110 lines) — Plot Initialization
Extracted from routes/plots.js. GPT-heavy initialization of new game sessions.
- `initializePlot(plot, sendEvent)` — Describe region, generate locations, create opening narrative

### services/gameLogService.js (~170 lines) — Central Game Log Persistence
All GameLog reads and writes go through this service. Handles log rotation, cross-log retrieval, and deduplication.
- `saveMessage(plotId, message)` — Save with auto-rotation at 50 messages + fire-and-forget summarization
- `getRecentMessages(plotId, limit, includeSummaries)` — Cross-log-boundary retrieval, chronological order
- `summarizeInBackground(logId, messages)` — Fire-and-forget GPT summarization of full logs
- `saveQuickAction(plotId, playerInput, actionType)` — Compressed Tier 0/1 log entries; merges consecutive quick actions into single entry

**Key behavior:** When a log fills up, creates a new GameLog, links it to the plot via `$push`, and kicks off background summarization of the old log. Duplicate messages (same author+content) are silently skipped.

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
Shared tile enum (25 types), display metadata (char, fg, bg, name), walkability rules. Used by both backend generators and frontend renderer.

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

### routes/gameLogs.js (~225 lines)
Game log CRUD + SSE relay for real-time events.
- `POST /api/input/stream` — Tiered action processing: inputClassifier → fastActionService (Tier 0/1) or gameAgent (Tier 2/3). World tick reactions streamed via SSE after fast-path actions.

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
- `tensions` — [{description, involvedNpcs[], severity}] active location conflicts

### Poi.js
Points of interest (NPCs, objects, entrances, landmarks):
- `gridPosition` — {x, y} on scene grid
- `settlement`, `locationId` — Where this POI lives
- NPC depth fields: `goal`, `problem`, `personality`, `profession` (nullable, zero-migration)
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
  → POST /api/input/stream
  → inputClassifier.classify() — deterministic tier assignment (no GPT)
  ↓
  TIER 0/1 (fast path — 0-5s):
    → fastActionService.execute()
      → Template response (Tier 0) or UTILITY_MODEL 1-2 sentences (Tier 1)
      → yield chunk + done → PLAYER UNBLOCKED
      → yield grid_updated (if movement)
      → Fire worldTickService.check() in background (debounced 500ms)
      → Save compressed log via gameLogService.saveQuickAction()
    → World tick fires after 500ms debounce:
      → UTILITY_MODEL: "Does anyone react?"
      → If yes → stream world_reaction event via SSE
      → Connection stays open 3s after done for world reactions

  TIER 2/3 (full pipeline — 8-35s):
    → gameAgent.processInput() (unchanged)
      → Speculative get_scene starts (parallel with planning)
      → Step 1: AI decides tools (UTILITY_MODEL, fast)
      → Step 2: Execute tools in parallel (move_player last)
      → Step 3: Build spatial context from grid positions
      → Step 4: Stream narrative via SSE
      → yield done → PLAYER UNBLOCKED
      → Step 5: Update grid positions + yield grid_updated
      → Step 6: Late events (suggestions, discoveries, quests)
      → Step 7: Save game log (gameLogService)

  → SSE events dispatched to frontend
    → Narrative chunks → log store → NarrativeLog renders
    → done → isStreaming=false, promise resolves, input re-enabled
    → Late events keep arriving on same SSE connection:
      → categorized_actions/suggested_actions → action store → ActionBar updates
      → discoveries/scene_entities → scene store → SceneGrid updates
      → quest events → quest store → discovery cards / journal
      → world_reaction → logStore.worldReaction → NarrativeLog world reaction display
    → Turn guard prevents stale late events from overwriting new turn data
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
Events before `done` (blocking phase):
- `tool_call` — Tool activity display ("Examining the scene...")
- `skill_check` — Dice roll data
- `quest_update` — Quest progress from tool execution
- `chunk` — Narrative text streaming
- `scene_entities` — NPCs/objects/exits for scene panel
- `done` — **Player unblocked, input re-enabled**

Events after `done` (late/async phase — same SSE connection):
- `grid_updated` — Grid positions saved, frontend re-fetches grid (fires immediately after done)
- `categorized_actions` — Categorized action suggestions
- `suggested_actions` — Flat action suggestions
- `discoveries` — New entity discoveries (also triggers grid refresh)
- `scene_entities` — Updated scene after discoveries
- `quest_discovered` — New quest lead found
- `quest_update` — Quest progress (from tool execution, yielded late)
- `world_reaction` — Background world tick reaction (Tier 0/1 only, arrives after debounce)
- `debug` — Debug info for dev panel

## Key Design Decisions
See `memory/decisions.md` for full history with rationale.
