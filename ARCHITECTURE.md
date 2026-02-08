# Architecture

## High-Level Overview

Dragons is a browser-based AI RPG where players explore a procedurally generated fantasy world. The server generates worlds, regions, and settlements using OpenAI, then runs real-time gameplay through an AI pipeline that interprets player actions, executes tools against the database, and streams narrative responses.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BROWSER CLIENT (two frontends)                   │
│                                                                     │
│  Svelte + Vite (client/)           Legacy (public/)                 │
│  ├── Stores (game, grid, log,      ├── app.js (monolith)           │
│  │   scene, quest, entity, modal)  ├── MapViewer.js                │
│  ├── SSE Service                   └── grid-renderer.js            │
│  ├── NarrativeLog + SceneGrid                                      │
│  └── 20 components total           (to be removed after Svelte     │
│                                     verified in browser)            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP + SSE
┌──────────────────────────▼──────────────────────────────────────────┐
│                    EXPRESS SERVER (server.js)                        │
│                                                                     │
│  Middleware: Auth0 (OIDC) · helmet · CORS · rate limiting           │
│             express.json (1mb limit) · ensureAuthenticated           │
│                                                                     │
│  ┌─────────────────── Route Modules ──────────────────────┐        │
│  │ auth.js       – login / logout / authorize / status     │        │
│  │ worlds.js     – create & list worlds                    │        │
│  │ regions.js    – regions, settlements, region hooks      │        │
│  │ plots.js      – plots, quests, map, movement, settings  │        │
│  │ characters.js – character CRUD & assignment              │        │
│  │ gameLogs.js   – log history & /input/stream (gameplay)  │        │
│  └─────────────────────────────────────────────────────────┘        │
└──────────┬────────────────┬───────────────────┬─────────────────────┘
           │                │                   │
    ┌──────▼──────┐  ┌──────▼──────────┐  ┌────▼──────────┐
    │  AI Layer   │  │  Services        │  │  Data Layer   │
    │             │  │                  │  │               │
    │ gameAgent   │  │ sceneManager     │  │ MongoDB via   │
    │ actionInt.  │  │ gridMovement     │  │ Mongoose      │
    │ storyTeller │  │ sceneContext     │  │               │
    │ factories   │  │ movement         │  │ 9 Models      │
    │             │  │ discovery        │  │ (see below)   │
    │             │  │ quest            │  │               │
    │             │  │ layout           │  │               │
    │             │  │ sceneGrid        │  │               │
    │             │  │ spatial          │  │               │
    │             │  │ suggestions      │  │               │
    │             │  │ toolFormatters   │  │               │
    │             │  │ locationResolver │  │               │
    │             │  │ plotInit         │  │               │
    └──────┬──────┘  └──────┬──────────┘  └───────────────┘
           │                │                      │
           └────────┬───────┘                      │
                    │                              │
             ┌──────▼──────┐                       │
             │  gptService  │── ALL OpenAI ──►  OpenAI API
             │  (centralized)│                  (gpt-5-mini)
             └──────────────┘                      │
                                            ┌──────▼──────┐
                                            │  MongoDB    │
                                            │  Atlas      │
                                            └─────────────┘
```

---

## Gameplay Loop

### Primary Pipeline: Game Agent (tool-calling)

Used for the primary gameplay input. The orchestrator coordinates extracted services to plan tools, execute them, stream narrative, and update game state.

```
Player Input
    │
    ▼
┌──────────────────────────┐
│  1. PLANNING CALL        │  gptService.toolPlanPrompt() with tool definitions
│     (gameAgent.js)       │  AI picks: get_scene, lookup_npc, move_player,
│                          │  skill_check, update_quest, update_relationship
└──────────┬───────────────┘
           │ tool_calls[]
           ▼
┌──────────────────────────┐
│  2. TOOL EXECUTION       │  Each tool reads/writes MongoDB:
│     (gameAgent.js)       │  - get_scene → sceneManager.executeGetScene()
│                          │  - lookup_npc → Poi queries
│                          │  - move_player → movementService.moveToLocation()
│                          │  - skill_check → d20 dice roll mechanics
│                          │  - update_quest → questService
│                          │  - update_relationship → Plot.reputation
└──────────┬───────────────┘
           │ tool results as context
           ▼
┌──────────────────────────┐
│  3. NARRATIVE STREAM     │  gptService.streamMessages() with tool results + history
│     (gameAgent.js)       │  Yields SSE chunks to client
│                          │  Post-processing: state updates, discovery parsing
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  4. BACKGROUND UPDATES   │  Fire-and-forget (non-blocking):
│                          │  - suggestionService: categorized action suggestions
│                          │  - sceneContextService: NPC arrivals/departures
│                          │  - gridMovementService: player/NPC grid positions
│                          │  - questService: quest seed generation
│                          │  - discoveryService: parse narrative for new entities
└──────────────────────────┘
```

### Secondary Pipeline: Action Interpreter (streaming)

Used for "Ask GM" input type. Simpler single-pass streaming with rich context building.

```
Player Input (askGM)
    │
    ▼
┌──────────────────────────┐
│  interpretStream()       │  Builds rich context:
│  (actionInterpreter.js)  │  - Recent message history
│                          │  - Location context with POIs and connections
│                          │  - Time-of-day, reputation, exploration hints
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  gptService.streamPrompt │  Single streaming OpenAI call
│                          │  System prompt: "The Indifferent World"
│                          │  Tone: dark / classic / whimsical
│                          │  Difficulty: casual / hardcore
└──────────┬───────────────┘
           │ SSE chunks
           ▼
┌──────────────────────────┐
│  Post-processing         │  - discoveryService.parseDiscoveries (async)
└──────────────────────────┘
```

---

## World Generation Pipeline

Creating a new game builds the world hierarchy top-down using AI at each step:

```
generateWorld(name)                    ─── worldFactory.js
    │
    ├── Create World document
    ├── Generate 5 Regions (AI)
    ├── Create Ecosystem per region
    └── Generate 5 Settlements per region (AI)
            │
            ▼
describe(regionId)                     ─── regionsFactory.js
    │
    └── AI generates detailed region description
            │
            ▼
describeSettlements(regionId)          ─── regionsFactory.js
    │
    └── AI names and describes each settlement
            │
            ▼
ensureLocations(settlementId)          ─── settlementsFactory.js
    │
    ├── AI generates internal locations (tavern, market, gate, etc.)
    ├── AI generates connections between locations
    ├── layoutService computes (x, y) positions via BFS
    └── Marks starting location
```

---

## Data Model

```
World
 ├── name, description, lore, history
 └── has many Regions

Region
 ├── name, description, terrain, climate
 ├── belongs to World
 ├── has one Ecosystem
 └── has many Settlements (ObjectId refs)

Settlement
 ├── name, description, size, population
 ├── belongs to Region
 ├── locations[] (embedded subdocuments)
 │    ├── name, type, description
 │    ├── connections[] (direction, locationName, distance)
 │    ├── interiorGrid (2D tile array), gridParams, gridGenerated
 │    ├── ambientNpcs [{x, y}]
 │    ├── coordinates {x, y}
 │    └── discovered, isStartingLocation
 └── quests[]

Poi (Point of Interest — standalone collection)
 ├── name, type (npc/object/entrance/landmark), description
 ├── settlement, locationId (where it lives)
 ├── gridPosition {x, y}
 ├── disposition, mannerisms (NPCs)
 └── discovered

Plot (a game session)
 ├── belongs to World
 ├── current_state
 │    ├── current_location (region, settlement, locationId, locationName)
 │    ├── gridPosition {x, y} (player position on scene grid)
 │    ├── sceneContext (tension, NPCs, events, outcomes)
 │    ├── questState (active quest tracking)
 │    ├── current_time, current_activity
 │    └── environment_conditions, mood_tone
 ├── characters[]
 ├── quests[]
 ├── reputation (npcs[], factions[], locations[])
 ├── gameLogs[] (ObjectId refs)
 ├── milestones[]
 └── settings (tone, difficulty)

Character
 ├── name, race, class, backstory
 ├── attributes, inventory
 └── currentStatus (hp, mana, location)

Quest
 ├── belongs to World + Settlement
 ├── status: seed → discovered → active → completed/failed/expired
 ├── hooks[] (narrative hooks for AI)
 ├── objectives[], progression
 └── outcomes[], consequences

GameLog
 ├── belongs to Plot (indexed)
 ├── messages[] (author, content, timestamp)
 │    ├── sceneEntities, discoveries, exits (per-message state)
 │    ├── skillCheck (dice roll data)
 │    └── questUpdates
 └── summary (AI-generated)

Ecosystem
 ├── belongs to Region
 └── flora[], fauna[], industry[]
```

---

## Directory Structure

```
dragons/
├── server.js                    # Express app: helmet, rate limiting, CORS, routes
├── package.json
├── AGENTS.md                    # Architecture overview and module map
├── ARCHITECTURE.md              # This file — system design and data flow
├── CLAUDE.md                    # Working principles, vision, gotchas
│
├── routes/                      # Express route modules (thin handlers)
│   ├── auth.js                  #   Login, logout, authorize, auth status
│   ├── worlds.js                #   World generation and listing
│   ├── regions.js               #   Regions, settlements, region hooks
│   ├── plots.js                 #   Plots, quests, map, movement, POIs, settings
│   ├── characters.js            #   Character CRUD and assignment
│   └── gameLogs.js              #   Game log history and /input/stream (gameplay)
│
├── middleware/
│   └── auth.js                  # ensureAuthenticated (Auth0 / SKIP_AUTH)
│
├── services/                    # Business logic (decomposed from gameAgent god file)
│   ├── gptService.js            #   Centralized OpenAI access (ALL API calls)
│   ├── gameAgent.js             #   Turn orchestrator: plan → execute → stream → update
│   ├── sceneManager.js          #   Scene loading, first impressions, POI creation
│   ├── gridMovementService.js   #   Player + NPC movement on tile grid
│   ├── sceneContextService.js   #   Background scene context updates (atomic $set)
│   ├── toolFormatters.js        #   Pure functions: tool display/result formatting
│   ├── suggestionService.js     #   Categorized action suggestions
│   ├── locationResolver.js      #   Shared "find current location" utility
│   ├── plotInitService.js       #   New game initialization (GPT-heavy)
│   ├── sceneGridService.js      #   Procedural grid generation (14 location types)
│   ├── spatialService.js        #   Distance/direction calculations
│   ├── questService.js          #   Quest lifecycle: seed → discover → active
│   ├── discoveryService.js      #   Parse AI narrative for new entities
│   ├── movementService.js       #   Location-to-location movement
│   ├── layoutService.js         #   BFS layout for settlement SVG maps
│   ├── tileConstants.js         #   Shared tile enum, walkability rules
│   └── vectorService.js         #   Grid vector utilities (used by seed scripts)
│
├── agents/
│   ├── actionInterpreter.js     # Streaming AI pipeline (Ask GM)
│   └── world/
│       ├── storyTeller.js       #   World/region/settlement detail lookup
│       └── factories/
│           ├── worldFactory.js  #   World + region + settlement generation
│           ├── regionsFactory.js#   Region description, settlement naming
│           ├── settlementsFactory.js # Location generation, POI management
│           └── mapFactory.js    #   Perlin noise terrain map generation
│
├── db/
│   ├── models/                  # Mongoose schemas (9 models)
│   │   ├── World.js
│   │   ├── Region.js
│   │   ├── Settlement.js
│   │   ├── Character.js
│   │   ├── Plot.js
│   │   ├── Quest.js             #   Indexed: world + settlement + status
│   │   ├── GameLog.js           #   Indexed: plotId
│   │   ├── Ecosystem.js
│   │   └── Poi.js
│   ├── migrations/              # Database migrations (migrate-mongo)
│   └── seeds/
│       └── rootseeds.js
│
├── client/                      # Svelte 5 + Vite frontend
│   ├── src/
│   │   ├── main.js              #   Svelte 5 mount() entry point
│   │   ├── App.svelte           #   Root layout (two-column: narrative | grid)
│   │   ├── app.css              #   CSS variables, animations, global styles
│   │   ├── lib/stores/          #   8 Svelte stores (game, log, grid, scene, quest, etc.)
│   │   ├── lib/services/        #   4 services (api, sse, narrativeFormatter, keyboard)
│   │   ├── lib/gridConstants.js #   Tile display, entity colors
│   │   └── lib/components/      #   20 components (NarrativeLog, SceneGrid, etc.)
│   └── dist/                    #   Production build output
│
├── public/                      # Legacy vanilla JS frontend (to be removed)
│   ├── landing.html, profile.html
│   ├── index.html, app.js, MapViewer.js
│   └── styles.css, map-styles.css
│
└── memory/                      # Project documentation
    ├── project-state.md
    ├── decisions.md
    ├── lessons.md
    └── YYYY-MM-DD.md            # Daily session logs
```

---

## Key Design Decisions

**"The Indifferent World" philosophy** — The AI system prompt establishes a world that doesn't cater to the player. NPCs have their own motivations, consequences are logical rather than dramatic, and the world continues whether the player engages or not.

**Decomposed game engine** — The game agent was refactored from a 1,483-line god file into a ~730-line orchestrator that delegates to 6 focused services (sceneManager, gridMovementService, sceneContextService, toolFormatters, suggestionService, locationResolver).

**Centralized OpenAI access** — All OpenAI API calls go through `gptService.js`, providing a single point for model configuration, error handling, and future metrics. No other file imports the OpenAI client directly.

**Atomic updates for concurrent writes** — Background fire-and-forget services (sceneContextService, activity updates) use `findByIdAndUpdate({ $set })` instead of load-modify-save to prevent race conditions with concurrent writes.

**Tool-calling pipeline** — The Game Agent uses OpenAI's tool-calling to ground responses in actual database state (preventing hallucination about locations, NPCs, etc.). Tools execute against MongoDB, and results are injected as context for narrative generation.

**Lazy generation** — Regions, settlements, and locations are generated on-demand when a player first visits them, rather than all at creation time. This distributes the AI generation cost across gameplay.

**Discovery parsing** — After each AI response, a background service extracts newly-mentioned NPCs, objects, and locations and persists them to the database, keeping the world state in sync with the narrative.

**Deterministic movement** — Player movement is handled by `movementService` using the connection graph, not by the AI. The AI narrates the result but doesn't decide whether movement succeeds.

**Security hardening** — helmet for security headers, express-rate-limit with 3 tiers (general 100/min, GPT endpoints 10/min, initialization 3/min), 1MB body limit.
