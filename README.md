# ChiGrid

ChiGrid is a Flask + Leaflet.js city-learning game for building real-world Chicago map knowledge.

Starting with Chicago, the project combines interactive maps, neighborhoods, landmarks, and navigation-style challenges. The long-term goal is to teach how cities work through landmarks, transit systems, neighborhoods, and real-world orientation rather than memorization alone.

## Current Features

- Interactive Chicago map.
- 200-location Chicago landmark dataset.
- Public and private multiplayer lobbies.
- Private lobbies use a 7 digit join code.
- Each lobby supports up to 6 players.
- Host-controlled "Let's Go" start.
- 20 shared locations per match.
- Players who finish early wait until everyone completes all 20.
- Server-issued player sessions for lobby actions.
- Server-side distance and score calculation.
- Redis-backed sessions and lobbies when `REDIS_URL` is configured.
- Optional photo clue panel using `image_url` values in the location dataset.
- Match generation prefers locations with photo clues when at least 20 are available.
- Distance scoring uses the haversine formula in miles.
- Speed bonus rewards faster correct guesses.

## Planned Features

- CTA train overlays and station quizzes.
- Neighborhood recognition.
- Route-planning challenges.
- Transit-based navigation scenarios.
- Timed memory and orientation modes.
- Expansion to cities like New York City and Los Angeles.

## Stack

- Python
- Flask
- Leaflet.js
- OpenStreetMap/CARTO no-label tiles
- Vanilla JavaScript

## Run Locally

Clone the repository:

```bash
git clone git@github.com:infosecBrook/chigrid_game.git
cd chigrid_game
```

Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the app:

```bash
python app.py
```

Open in browser:

```text
http://127.0.0.1:5000
```

By default the app listens on `0.0.0.0:5000`, which means other devices can reach it if your network allows the connection.

Useful run options:

```bash
PORT=8000 python app.py
```

```bash
HOST=127.0.0.1 FLASK_DEBUG=1 python app.py
```

## Playing With Friends

For people outside your home network, you need one of these:

- A tunnel service, such as Cloudflare Tunnel or ngrok, pointed at `http://localhost:5000`.
- Port forwarding on your router from a public port to this computer's port `5000`.
- A deployed server or VPS running this Flask app behind a real domain.

Keep one Python process running for a game session. Lobbies are stored in memory, so they reset when the server restarts.

When `REDIS_URL` is set, sessions and lobbies are stored in Redis instead of local memory.

## Deploy On Render

This repo includes:

- `requirements.txt` for Python dependencies.
- `Procfile` for a production Gunicorn start command.
- `render.yaml` for Render blueprint deployment.
- `Dockerfile` for Docker-based hosts such as Fly.io.
- `fly.example.toml` for a low-cost Fly.io setup.
- `/healthz` for host health checks.
- Optional `REDIS_URL` support for shared lobby/session storage.
- Optional `image_url` values in `data/locations.json` for photo clues.

Recommended Render settings if you create the service manually:

```text
Runtime: Python
Build command: pip install -r requirements.txt
Start command: gunicorn app:app --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT
Health check path: /healthz
```

The included `start.sh` runs the same Gunicorn command and prints the port on startup.

Use one Gunicorn worker if `REDIS_URL` is not set because local memory would create separate lobby lists. With Redis configured, sessions and lobbies can survive web app restarts and can be shared across workers.

Cheapest practical choice:

- Free Render web service for testing and casual games.
- Paid Render Starter web service when you want the app to stay awake reliably during planned games.

After deployment, add your custom domain in Render and point your DNS records to the values Render gives you. Render provides managed HTTPS certificates.

## Deploy On Fly.io

Fly.io is a good low-cost option if you want the app to stay running on one tiny machine.

```bash
cp fly.example.toml fly.toml
```

Edit `fly.toml` and change:

```text
app = "change-me-chigrid"
```

to a unique app name.

Then deploy:

```bash
fly launch --no-deploy
fly deploy
```

Keep `min_machines_running = 1` and `auto_stop_machines = false` for multiplayer sessions. That keeps the in-memory lobby state alive.

## How It Works

- Flask serves the main page at `/`.
- Flask serves the landmark dataset at `/api/locations`.
- Flask issues browser sessions at `/api/session`.
- Flask stores lightweight public/private lobbies in Redis when `REDIS_URL` is configured, otherwise in local memory.
- Public lobbies appear in the join list.
- Private lobbies can be joined with a 7 digit code.
- Each lobby allows up to 6 players.
- The lobby host starts the match with the "Let's Go" button.
- A match uses the same 20 locations for everyone in the lobby.
- Players who finish early wait until everyone completes all 20 locations.
- `static/game.js` handles the lobby UI, map clicks, scoring, and match flow.
- Guess submissions send raw coordinates and time; Flask computes the official distance and score.
- When a location has `image_url`, each target shows a photo clue in the top-right panel.
- The location data lives in `data/locations.json` and is the source of truth for the game.

## CI/CD

Render, Railway, and Fly.io can all deploy automatically from GitHub when changes are pushed to the connected branch. Keep the app on one running instance unless lobby state is moved out of memory into a shared store such as Redis or a database.
