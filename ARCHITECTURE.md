# Architecture

## High-Level Overview

Dragons is a browser-based AI RPG where players explore a procedurally generated fantasy world. The server generates worlds, regions, and settlements using OpenAI, then runs real-time gameplay through two AI pipelines that interpret player actions and stream narrative responses.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER CLIENT                            │
│                                                                     │
│  landing.html ──► profile.html ──► index.html (game)               │
│                                     ├── app.js (game logic, SSE)   │
│                                     ├── MapViewer.js (location map)│
│                                     └── auth.js (session UI)       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS / SSE
┌──────────────────────────▼──────────────────────────────────────────┐
│                        EXPRESS SERVER (server.js)                    │
│                                                                     │
│  Middleware: Auth0 (OIDC) · CORS · express.json · ensureAuthenticated│
│                                                                     │
│  ┌─────────────────── Route Modules ──────────────────────┐        │
│  │ auth.js      – login / logout / authorize / status     │        │
│  │ worlds.js    – create & list worlds                    │        │
│  │ regions.js   – regions, settlements, region hooks      │        │
│  │ plots.js     – plots, quests, map, movement, settings  │        │
│  │ characters.js – character CRUD & assignment             │        │
│  │ gameLogs.js  – log history & /input/stream (gameplay)  │        │
│  └────────────────────────────────────────────────────────┘        │
└──────────┬────────────────┬───────────────────┬─────────────────────┘
           │                │                   │
    ┌──────▼──────┐  ┌──────▼──────┐  ┌────────▼────────┐
    │  AI Layer   │  │  Services   │  │   Data Layer    │
    │             │  │             │  │                 │
    │ gameAgent   │  │ movement    │  │  MongoDB via    │
    │ actionInt.  │  │ discovery   │  │  Mongoose       │
    │ storyTeller │  │ layout      │  │                 │
    │ noteTaker   │  │ vector      │  │  8 Models       │
    │ factories   │  │ gptService  │  │  (see below)    │
    └─────────────┘  └─────────────┘  └─────────────────┘
           │                │                   │
           └────────┬───────┘                   │
                    │                           │
             ┌──────▼──────┐                    │
             │  OpenAI API │                    │
             │  (gpt-5-mini)│                    │
             └─────────────┘                    │
                                         ┌──────▼──────┐
                                         │  MongoDB    │
                                         │  Atlas      │
                                         └─────────────┘
```

---

## Gameplay Loop

Two AI pipelines handle player input, selected by the frontend:

### Pipeline 1: Game Agent (tool-calling)

Used for the primary gameplay input. The AI decides which tools to call, executes them against the database, then streams a narrative response grounded in real game state.

```
Player Input
    │
    ▼
┌──────────────────────────┐
│  1. PLANNING CALL        │  Non-streaming OpenAI call with tool definitions
│     (gameAgent.js)       │  AI picks: get_scene, lookup_npc, move_player,
│                          │  update_npc_relationship
└──────────┬───────────────┘
           │ tool_calls[]
           ▼
┌──────────────────────────┐
│  2. TOOL EXECUTION       │  Each tool reads/writes to MongoDB:
│     (gameAgent.js)       │  - get_scene → Plot + Settlement (populated)
│                          │  - lookup_npc → Plot.reputation + Settlement.pois
│                          │  - move_player → movementService.moveToLocation()
│                          │  - update_npc_relationship → Plot.reputation
└──────────┬───────────────┘
           │ tool results as context
           ▼
┌──────────────────────────┐
│  3. NARRATIVE STREAM     │  Streaming OpenAI call with tool results + history
│     (gameAgent.js)       │  Yields SSE chunks to client
│                          │  Post-processing: state updates, discovery parsing
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  4. SUGGESTION CALL      │  Non-streaming call to generate 3 suggested
│     (gameAgent.js)       │  next actions for the player (non-blocking)
└──────────────────────────┘
```

### Pipeline 2: Action Interpreter (streaming)

Used for "Ask GM" input type. Simpler single-pass streaming with rich context building.

```
Player Input (action / speak / askGM)
    │
    ▼
┌──────────────────────────┐
│  interpretStream()       │  Builds rich context:
│  (actionInterpreter.js)  │  - Recent message history (direct DB query)
│                          │  - Location context with POIs and connections
│                          │  - Time-of-day context
│                          │  - Reputation/NPC context
│                          │  - Movement detection (for action type)
│                          │  - Exploration hints
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
│  Post-processing         │  - updateCurrentState (activity, time)
│                          │  - discoveryService.parseDiscoveries (async)
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
            │
            ▼
storyOptions(plotId)                   ─── storyTeller.js
    │
    ├── AI generates 3 quest hooks
    ├── noteTaker.saveQuests() persists to DB
    └── questBuilder() fleshes out each quest (AI)
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
 └── has many Settlements

Settlement
 ├── name, description, size, population
 ├── belongs to Region
 ├── locations[] (embedded subdocuments)
 │    ├── name, type, description
 │    ├── connections[] (direction, locationName, distance)
 │    ├── pois[] (NPCs, objects, entrances, landmarks)
 │    ├── coordinates {x, y}
 │    └── discovered, isStartingLocation
 └── quests[]

Plot (a game session)
 ├── belongs to World
 ├── current_state
 │    ├── current_location (region, settlement, locationId, locationName)
 │    ├── current_time, current_activity
 │    └── environment_conditions, mood_tone
 ├── characters[]
 ├── quests[]
 ├── reputation (npcs[], factions[], locations[])
 └── settings (tone, difficulty)

Character
 ├── name, race, class, backstory
 └── attributes, inventory

Quest
 ├── belongs to World
 ├── questTitle, description, status
 ├── triggers, keyActors, locations
 ├── outcomes[], consequences
 └── objectives[]

GameLog
 ├── belongs to Plot
 ├── messages[] (author, content, timestamp)
 └── summary (AI-generated)

Ecosystem
 ├── belongs to Region
 └── flora[], fauna[], industry[]
```

---

## Directory Structure

```
dragons/
├── server.js                    # Express app entry point, middleware, DB connection
├── package.json
├── render.yaml                  # Render.com deployment config
├── railway.json                 # Railway deployment config
│
├── routes/                      # Express route modules
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
├── services/                    # Business logic
│   ├── gptService.js            #   Shared OpenAI client, prompt functions, system prompt
│   ├── gameAgent.js             #   Tool-calling AI agent (primary gameplay pipeline)
│   ├── movementService.js       #   Player movement between locations
│   ├── discoveryService.js      #   Parse AI responses for new NPCs/objects/locations
│   ├── layoutService.js         #   BFS spatial layout for settlement maps
│   └── vectorService.js         #   Grid vector utilities
│
├── agents/
│   ├── actionInterpreter.js     # Streaming AI pipeline (Ask GM)
│   └── world/
│       ├── storyTeller.js       #   Quest generation and story options
│       ├── noteTaker.js         #   Quest persistence
│       └── factories/
│           ├── worldFactory.js  #   World + region + settlement generation
│           ├── regionsFactory.js#   Region description, settlement naming
│           ├── settlementsFactory.js # Location generation, POI management
│           └── mapFactory.js    #   Perlin noise terrain map generation
│
├── db/
│   ├── models/                  # Mongoose schemas
│   │   ├── World.js
│   │   ├── Region.js
│   │   ├── Settlement.js
│   │   ├── Character.js
│   │   ├── Plot.js
│   │   ├── Quest.js
│   │   ├── GameLog.js
│   │   └── Ecosystem.js
│   ├── migrations/              # Database migrations (migrate-mongo)
│   └── seeds/
│       └── rootseeds.js
│
├── helpers/
│   └── describeRegionAndSettlements.js
│
└── public/                      # Static frontend (vanilla JS)
    ├── index.html               #   Main game page
    ├── landing.html             #   Landing / login page
    ├── profile.html             #   User profile page
    ├── app.js                   #   Game client logic, SSE streaming
    ├── MapViewer.js             #   Canvas-based location map renderer
    ├── auth.js                  #   Auth UI helpers
    ├── profile.js               #   Profile page logic
    ├── landing.js               #   Landing page logic
    ├── styles.css               #   Main stylesheet
    └── map-styles.css           #   Map-specific styles
```

---

## Key Design Decisions

**"The Indifferent World" philosophy** — The AI system prompt establishes a world that doesn't cater to the player. NPCs have their own motivations, consequences are logical rather than dramatic, and the world continues whether the player engages or not.

**Two AI pipelines** — The Game Agent uses OpenAI's tool-calling to ground responses in actual database state (preventing hallucination about locations, NPCs, etc.). The Action Interpreter uses a simpler streaming approach with rich context for Ask GM queries.

**Lazy generation** — Regions, settlements, and locations are generated on-demand when a player first visits them, rather than all at creation time. This distributes the AI generation cost across gameplay.

**Discovery parsing** — After each AI response, a background service extracts newly-mentioned NPCs, objects, and locations and persists them to the database, keeping the world state in sync with the narrative.

**Deterministic movement** — Player movement is handled by `movementService` using the connection graph, not by the AI. The AI narrates the result but doesn't decide whether movement succeeds.
