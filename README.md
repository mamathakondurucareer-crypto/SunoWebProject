# Devotional Music Video Workflow

An automated pipeline for producing devotional (bhajan) music videos. The system orchestrates
Suno (audio generation), Grok (video generation), and ChatGPT (prompt refinement) via a
browser-automation worker, coordinated through a Next.js web UI backed by SQLite.

---

## How it works

1. **Create a project** — upload source material (lyrics, theme, style notes)
2. **Run a workflow** — the worker drives browser sessions against Suno, ChatGPT, and Grok
3. **Review candidates** — the UI shows generated assets for approval or rejection
4. **Approved assets** are downloaded to `data/downloads/` for final editing

---

## Architecture

| Service | Role |
|---------|------|
| `web` | Next.js UI on port 3000; manages projects, runs, approvals |
| `worker` | Playwright worker; polls a SQLite job queue and drives browser automation |
| `migrate` | One-shot DB migration; runs before web and worker start |
| `login-helper` | Interactive browser for one-time session setup (not part of normal operation) |

---

## Prerequisites

- Docker Engine 23+ — `docker --version`
- Docker Compose v2.1+ — `docker compose version` (note: `docker compose`, not `docker-compose`)
- ~4 GB free RAM (Chromium uses 1–2 GB per browser tab)

---

## Quick start

### 1. Create host data directories (once)

```bash
./scripts/init-data-dirs.sh
# custom path:
./scripts/init-data-dirs.sh /opt/devotional/data
```

### 2. Configure environment (once)

```bash
cp .env.example .env
$EDITOR .env
```

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_DATA_DIR` | `./data` | Host directory for all persistent data |
| `WEB_PORT` | `3000` | Host port the web app listens on |

All other variables have sensible defaults.

### 3. Build and start

```bash
docker compose build
docker compose up -d
```

The `migrate` service runs first and exits; `web` and `worker` start after it completes.

### 4. Open the app

```
http://localhost:3000
```

---

## Browser session setup (first time only)

The worker reuses saved browser sessions so it does not need to log in on every run.
Run the login helper once per service to save those sessions:

```bash
# macOS / Linux with a display
docker compose --profile login run --rm login-helper

# macOS without a display (XQuartz)
# 1. Install XQuartz (xquartz.org)
# 2. xhost +localhost
# 3. DISPLAY=host.docker.internal:0 docker compose --profile login run --rm login-helper

# Linux X11
DISPLAY=:0 docker compose --profile login run --rm login-helper
```

Log in to each site in the browser window that opens. Sessions are saved to
`data/browser-profiles/` and reused by the headless worker.

---

## Using the app

### Projects

Navigate to **Projects** to create and manage music video projects. Each project holds:
- Song title, theme, and mood
- Lyric data and scene breakdown
- All generated assets and approval history

### Scheduler / Workflows

The **Scheduler** page lets you queue workflow runs. Each run passes through a series of
automated stages (scene generation, prompt refinement, video generation). You can monitor
stage progress and view worker logs in real time.

### Assets & Approvals

Generated clips and images appear in the **Assets** view. Approve or reject each candidate;
approved assets are downloaded to `data/downloads/` on the host.

### Settings

The **Settings** page stores global defaults such as visual style guide, continuity rules,
and worker concurrency.

---

## Common operations

```bash
# View live logs
docker compose logs -f web
docker compose logs -f worker

# Check service health
docker compose ps

# Stop all services
docker compose down

# Stop and delete all data (DESTRUCTIVE)
docker compose down -v

# Rebuild a single service after a code change
docker compose build web
docker compose up -d --no-deps web

# Run the DB migration manually
docker compose run --rm migrate
```

---

## Development mode

Mounts the source tree into containers; Next.js hot-reloads and the worker restarts on edits — no
rebuild required.

```bash
./scripts/start.sh --dev
# or:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Data directory layout

```
data/                        ← HOST_DATA_DIR (bind-mounted into containers)
├── db/
│   └── devotional.db        ← SQLite database (all state lives here)
├── projects/                ← Project source files uploaded via the UI
├── downloads/               ← Approved assets downloaded by the worker
├── logs/                    ← Structured worker run logs
└── browser-profiles/
    ├── suno/                ← Suno browser session
    ├── chatgpt/             ← ChatGPT browser session
    ├── grok/                ← Grok browser session
    └── gemini/              ← Gemini browser session
```

Back up the entire `data/` directory to preserve all state.

---

## Updating

```bash
git pull
docker compose build
docker compose up -d          # migrate runs automatically before web/worker restart
```

---

## Detailed deployment notes

See [DEPLOY.md](DEPLOY.md) for production tips including reverse proxy setup, absolute data
paths, SQLite WAL mode, and Chromium `shm_size` requirements.
