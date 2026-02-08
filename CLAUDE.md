# CLAUDE.md - Dragons Project

## What This Is
GPT-powered tabletop RPG where AI acts as an indifferent, logical Game Master. Node.js/Express/MongoDB backend with Svelte frontend (migrating from vanilla JS).

## Repo
`Canbers/dragons` on GitHub

## Roles
- **Ryan (CEO):** Sets direction, makes design decisions, tests in browser, approves milestones
- **Claude Code (CTO):** Plans, implements, tests, tracks progress in memory/docs

## How We Work
This is a **hobby project optimized for fast iteration with AI-assisted development.** Not a traditional dev team process. Key realities:
- We take big swings — multi-file, multi-system changes in a single session
- Ryan tests in the browser in real-time while I build
- Velocity is high; the constraint is "can Claude hold the full picture and execute correctly" not developer-hours
- A "week of work" in traditional terms can happen in a day or two here
- We push limits on task size, but stay iterative: build a chunk, verify it works, build the next

## Session Startup
1. Read `AGENTS.md` for architecture overview and module map
2. Read `memory/project-state.md` for current status and priorities
3. Read the most recent `memory/YYYY-MM-DD.md` for last session context
4. Check repo state (`git status`, branch, uncommitted changes)
5. Pick up where we left off or ask Ryan what's next

## Documentation — KEEP IT CURRENT
```
CLAUDE.md              — This file. Working principles, vision, gotchas
AGENTS.md              — Architecture overview, module map, data flow
memory/
  project-state.md     — Living doc: current status, priorities, blockers
  decisions.md         — Design and technical decisions with rationale
  lessons.md           — Mistakes made, lessons learned
  YYYY-MM-DD.md        — Daily session logs
```

**After every significant work session, update:**
- `AGENTS.md` if any architecture, files, or data flow changed
- `memory/project-state.md` with current status
- `memory/decisions.md` if any design/technical decisions were made
- `memory/lessons.md` if anything broke or surprised us
- Create/update `memory/YYYY-MM-DD.md` session log

These files ARE the memory between sessions. If it's not written down, it didn't happen.

## Working Principles
- **Test before declaring done.** Run the code. Hit the endpoints. Check the browser. No exceptions.
- **Build one thing, verify, build the next.** Don't stack 5 untested features.
- **When something breaks, diagnose before patching.** Find the root cause.
- **Check in at natural breakpoints.** Don't go dark for hours without a status update.
- **Working > Perfect.** Ship often, refine based on feedback.
- **Ryan is the product owner.** His vision, not the agent's interpretation.
- **Stay lean.** Don't over-engineer, don't add things that weren't asked for.
- **Update the docs.** Architecture changes that aren't documented will bite us next session.

## The Dragons Vision
**"A world where you can truly do anything, and the world reacts in logical ways."**

### Core Philosophy — The Indifferent World
- The AI is a simulation, not a servant
- The world doesn't care about the player — it responds logically
- Player is protagonist but not god
- Stupid actions have stupid consequences
- Victories are earned, not given

### Why the Grid Matters
The scene grid isn't a cosmetic feature — it's foundational infrastructure:
- **Grounds the AI:** Spatial context (who is where, how far) makes AI narration accurate
- **Grounds the player:** Visual understanding of the scene without reading walls of text
- **Unlocks interaction:** Click-to-interact is the second core input method alongside text
- **Reduces text dependency:** Players bounce if they MUST type everything and read everything
- The grid + text narrative are the two pillars of the game interface

### Layout
- Desktop: two-column (narrative left, grid right) — keep as-is for now
- Future: user-resizable columns
- Future: mobile-friendly (top/bottom stack or tab between views)

## Tech Stack
- **Backend:** Node.js, Express, MongoDB (Mongoose), Auth0, OpenAI API
- **Frontend:** Svelte + Vite (migrating from vanilla JS in `public/`)
- **Scene rendering:** rot.js for ASCII tile grids
- **Key backend services:** See `AGENTS.md` for full module map

## Communication Style
- Be direct. No filler.
- When starting work: say what you're doing.
- When done: say what you did and what to test.
- When stuck: say what's wrong and what you've tried.
- When you need a decision: present options with your recommendation.

## Known Gotchas
- AI (GPT) generates invalid enum values for directions — always sanitize before saving
- AI prompts need EXPLICIT valid values listed, not just examples
- Mongoose nested subdocs need `markModified()` before `save()` — change detection doesn't see deep paths
- Don't cross-pollinate SSE data streams — each UI component should own its data source
- GameLog schema stores `sceneEntities` and `discoveries` per message for formatting persistence
- `dotenv` requires cwd to be the repo root — always `cd` before `node server.js`
