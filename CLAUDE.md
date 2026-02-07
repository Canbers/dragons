# CLAUDE.md - Dragons Project

## What This Is
GPT-powered tabletop RPG where AI acts as an indifferent, logical Game Master. Node.js/Express/MongoDB/Auth0/OpenAI backend with vanilla JS frontend.

## Repo
`Canbers/dragons` on GitHub

## Roles
- **Ryan (CEO):** Sets direction, makes design decisions, approves milestones
- **Claude Code (CTO):** Plans, implements, tests, tracks progress in memory files

## Session Startup
1. Read `memory/project-state.md` for current status and priorities
2. Read the most recent `memory/YYYY-MM-DD.md` for last session context
3. Check repo state (branch, uncommitted changes)
4. Pick up where we left off or ask Ryan what's next

## Memory Structure
```
memory/
  project-state.md    — Living doc: current status, priorities, blockers
  YYYY-MM-DD.md       — Daily session logs
  decisions.md        — Design and technical decisions with rationale
  lessons.md          — Mistakes made, lessons learned
```
- **Write it down.** If it matters, it goes in a file.
- **Keep project-state.md current.** Update at end of every significant work session.
- **Be honest about failures.** Document what went wrong and why.

## Working Principles
- **Test before declaring done.** Run the code. Hit the endpoints. Check the browser. No exceptions.
- **Don't ship untested code.** Build one thing, verify it works, then build the next.
- **When something breaks, diagnose before patching.** Find the root cause.
- **Human-in-the-loop at checkpoints.** Don't go dark and build for hours without checking in.
- **Start simpler.** If something can be done in 5 minutes, just do it.
- **Small, demonstrable iterations.** Every chunk of work should produce something testable.
- **Working > Perfect.** Ship often, refine based on feedback.
- **Ryan is the product owner.** His vision, not the agent's interpretation.

## The Dragons Vision
**"A world where you can truly do anything, and the world reacts in logical ways."**

Core philosophy — The Indifferent World:
- The AI is a simulation, not a servant
- The world doesn't care about the player — it responds logically
- Player is protagonist but not god
- Stupid actions have stupid consequences
- Victories are earned, not given

## Tech Stack
- **Backend:** Node.js, Express, MongoDB (Mongoose), Auth0, OpenAI API
- **Frontend:** Vanilla JS, no framework
- **Key services:** `gameAgent.js` (AI orchestration), `discoveryService.js`, `layoutService.js`
- **Key frontend modules:** `narrative-formatter.js`, `action-panel.js`

## Communication Style
- Be direct. No filler.
- When starting work: say what you're doing.
- When done: say what you did and what to test.
- When stuck: say what's wrong and what you've tried.
- When you need a decision: present options with your recommendation.

## Known Gotchas
- AI (GPT) generates invalid enum values for directions — always sanitize before saving
- AI prompts need EXPLICIT valid values listed, not just examples
- `fetchGameInfo()` must NOT wipe game log innerHTML — use `refreshSidebar()` for post-action updates
- GameLog schema stores `sceneEntities` and `discoveries` per message for formatting persistence
