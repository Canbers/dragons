# Dragons

An AI-powered text RPG where players explore procedurally generated fantasy worlds. Built on the "Indifferent World" philosophy — the world exists independently of the player, NPCs have their own motivations, and actions have real consequences.

## How It Works

1. **World Generation** — Create a named world and the system generates regions, ecosystems, and settlements using OpenAI
2. **Character Creation** — Build a character with race, class, and backstory
3. **Gameplay** — Explore settlements, talk to NPCs, take on quests, and navigate a living world through natural language input
4. **AI Narration** — Two AI pipelines interpret player actions: a tool-calling agent that queries game state for grounded responses, and a streaming interpreter for GM-style queries

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed technical breakdown of how the system works.

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: MongoDB (Mongoose ODM)
- **AI**: OpenAI API (gpt-5-mini for gameplay, tool-calling for the game agent)
- **Auth**: Auth0 (OpenID Connect)
- **Frontend**: Vanilla JS, HTML/CSS (no framework)
- **Deployment**: Render.com (see [DEPLOYMENT.md](DEPLOYMENT.md))

## Local Development Setup

### Prerequisites

- Node.js (v18+)
- MongoDB (local instance or MongoDB Atlas)
- An OpenAI API key
- `mkcert` for local SSL certificates (optional, for Auth0 callback)

### 1. Clone and Install

```bash
git clone https://github.com/Canbers/dragons.git
cd dragons
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```env
# MongoDB
MONGO_URL=mongodb://localhost:27017/dragons

# OpenAI
OPENAI_API_KEY=your-openai-api-key
DRAGONS_PROJECT=your-openai-project-id
GAME_MODEL=gpt-4o-mini

# Auth0 (or skip with SKIP_AUTH=true for local dev)
SKIP_AUTH=true
# AUTH0_SECRET=your-auth0-secret
# AUTH0_BASE_URL=https://localhost:3000/
# AUTH0_CLIENT_ID=your-auth0-client-id
# AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com
```

Set `SKIP_AUTH=true` to bypass Auth0 during local development. The server will mock an authenticated user.

### 3. Database Setup

With MongoDB running locally:

```bash
# Run migrations
cd db && npx migrate-mongo up && cd ..

# (Optional) Seed initial data
npm run seed
```

Or reset and seed in one step:

```bash
npm run migrate:reset:seed
```

### 4. SSL Certificates (Optional)

Required if using Auth0 locally (Auth0 callbacks require HTTPS).

1. Install [mkcert](https://github.com/FiloSottile/mkcert):

   ```bash
   mkcert -install
   ```

2. Generate certificates in the project root:

   ```bash
   mkcert localhost
   ```

   This creates `localhost.pem` and `localhost-key.pem`. The server detects these automatically.

### 5. Start the Server

```bash
npm start
```

The server starts on `https://localhost:3000` (with SSL certs) or `http://localhost:3000` (without).

## Project Structure

```
dragons/
├── server.js              # Entry point — Express config, middleware, DB connection
├── routes/                # API route modules (auth, worlds, regions, plots, characters, gameLogs)
├── middleware/             # Auth middleware (ensureAuthenticated)
├── services/              # Business logic (gptService, gameAgent, movement, discovery, layout)
├── agents/                # AI pipelines (actionInterpreter, world generation factories)
├── db/models/             # Mongoose schemas (World, Region, Settlement, Plot, Quest, etc.)
├── db/migrations/         # Database migrations
├── helpers/               # Shared utility functions
└── public/                # Frontend (vanilla JS — app.js, MapViewer.js, styles)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture diagrams, data models, and design decisions.

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run seed` | Seed the database |
| `npm run migrate:reset` | Drop all collections and re-run migrations |
| `npm run migrate:reset:seed` | Drop, migrate, and seed |
