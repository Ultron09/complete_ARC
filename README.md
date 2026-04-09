# A.R.C. Backend (Node.js & Express) 🧠

This is the command center and AI proxy for the Airborne Intelligent Performance Agent (A.R.C.). The backend handles intensive mathematical routing (the Momentum Score Engine), acts as a secure middleware for interacting with the Anthropic API (Claude 3.5 Sonnet & Haiku), and hosts background CRON jobs.

## Architecture
- **Express.js:** Core HTTP web server framework.
- **Anthropic SDK (`@anthropic-ai/sdk`):** Connects to Claude AI for post-set analysis and nutrition log natural language extraction.
- **Redis (`ioredis`):** In-memory datastore holding the rapidly oscillating Momentum Score global leaderboards (O(log(N)) efficiency).
- **Node-Cron:** Runs the weekly aggregation job to recalculate the momentum of the entire userbase natively.
- **Multer:** Handles multipart `FormData` for incoming voice log `.m4a` files.

## Environment Variables
Create a `.env` file in the root of the `arc-backend` directory with the following variables:

```env
PORT=3000

# AI Configuration
ANTHROPIC_API_KEY=your_anthropic_secret_key

# Database Connectivity (Used by the Cron job and Leaderboard syncs)
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Caching
REDIS_URL=redis://your-redis-url-here
```

## Running Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   node index.js
   ```
   *The server will run on `http://localhost:3000`.*

## Core Endpoints
- `POST /api/claude/set-analysis`: Takes lifting telemetry and returns AI-driven post-set RPE estimations and coaching cues. (Also triggers the internal Medal Achievement system).
- `POST /api/claude/food-estimate`: Takes natural language descriptions of food and outputs precisely extracted JSON macros.
- `POST /api/claude/voice-parse`: Receives `.m4a` audio formData and maps them to Claude NLP extractions.
- `POST /api/claude/brief`: Synthesizes Morning HRV, recent volume, and calories to draft a 3-line daily strategy.
- `GET /api/leaderboard/global`: Fetches the highest Momentum Scores directly from Redis cache and maps them to Supabase Usernames.
- `POST /api/test/trigger-momentum`: *Hidden Admin Route*. Manually forces the Monday 00:00 UTC score calculation.

## Deployment
For production, it is highly recommended to host this API on a PaaS provider like **Render**, **Railway**, or **Heroku**. 
When deploying, make sure to add the `.env` variables to your host's secure configuration panel.
"# complete_ARC" 
"# complete_ARC" 
