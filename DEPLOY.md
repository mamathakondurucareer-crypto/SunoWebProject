# Deployment Guide

This project ships as three Docker services orchestrated by Docker Compose:

| Service | Image | Role |
|---------|-------|------|
| `migrate` | `devotional-worker` | One-shot DB schema migration (runs first, exits) |
| `web` | `devotional-web` | Next.js standalone server on port 3000 |
| `worker` | `devotional-worker` | Playwright automation worker; polls SQLite job queue |

A fourth `login-helper` service (profile: `login`) provides an interactive browser for one-time session setup.

---

## Prerequisites

- Docker Engine 23+ (`docker --version`)
- Docker Compose v2.1+ (`docker compose version`) — note: `docker compose`, not `docker-compose`
- 4 GB RAM recommended (Chromium uses ~1–2 GB per tab)

---

## First-time setup

### 1. Create host data directories

```bash
./scripts/init-data-dirs.sh          # creates ./data/{db,projects,downloads,logs,browser-profiles/...}
# or to use a custom path:
./scripts/init-data-dirs.sh /opt/devotional/data
```

### 2. Configure environment

```bash
cp .env.example .env
$EDITOR .env
```

Key variables to set:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_DATA_DIR` | `./data` | Host directory for all persistent data |
| `WEB_PORT` | `3000` | Host port the web app is exposed on |

All other variables have sensible defaults for production.

### 3. Build images

```bash
docker compose build
```

### 4. Start the stack

```bash
# Using the convenience script:
./scripts/start.sh

# Or directly:
docker compose up -d
```

The `migrate` service runs first and exits; `web` and `worker` wait for it before starting.

### 5. Open the app

```
http://localhost:3000
```

---

## Logging in to browser profiles (first time)

The worker uses saved browser sessions stored in `browser-profiles/` to automate
sites without re-entering credentials on every run. Set these up once:

```bash
# macOS / Linux with display
docker compose --profile login run --rm login-helper

# macOS with XQuartz:
#   1. Install XQuartz (xquartz.org)
#   2. xhost +localhost
#   3. DISPLAY=host.docker.internal:0 docker compose --profile login run --rm login-helper

# Linux X11:
#   DISPLAY=:0 docker compose --profile login run --rm login-helper
```

The login helper opens a visible browser window. Log in to each service manually;
sessions are saved to the `browser-profiles` volume and reused by the headless worker.

---

## Useful commands

```bash
# View logs
docker compose logs -f web
docker compose logs -f worker

# Check service health
docker compose ps

# Stop everything
docker compose down

# Stop and remove volumes (DESTRUCTIVE — deletes all data)
docker compose down -v

# Rebuild a single service
docker compose build web
docker compose up -d --no-deps web

# Run DB migration manually
docker compose run --rm migrate
```

---

## Development mode

Development mode mounts the source tree into the containers so Next.js hot-reloads
on file changes and the worker restarts on edits — no rebuild required.

```bash
# Using the convenience script:
./scripts/start.sh --dev

# Or directly:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Note: On first run in dev mode, Docker will still need to build the base images.

---

## Production tips

- **Absolute data path**: Set `HOST_DATA_DIR=/opt/devotional/data` in `.env` to avoid
  issues with relative paths when running `docker compose` from different directories.
- **Backups**: The `data/` directory contains everything — back it up with standard
  file-system snapshots or rsync.
- **SQLite WAL mode**: The web and worker share the same DB file via the `db_data` volume.
  WAL mode (configured in the DB client) allows concurrent reads with one writer.
- **Reverse proxy**: Put Nginx or Caddy in front of port 3000 for TLS and a custom domain.
- **`shm_size: 2gb`**: The worker service has `shm_size: 2gb` to prevent Chromium from
  crashing due to Docker's default 64 MB `/dev/shm` limit.

---

## Directory layout

```
data/                        ← HOST_DATA_DIR (bind-mounted into containers)
├── db/
│   └── devotional.db        ← SQLite database
├── projects/                ← Project source files
├── downloads/               ← Files downloaded by the worker
├── logs/                    ← Worker run logs
└── browser-profiles/
    ├── suno/                ← Suno session
    ├── gemini/
    ├── chatgpt/
    └── ...
```

---

## Updating

```bash
git pull
docker compose build          # rebuild with latest source
docker compose up -d          # rolling restart (migrate runs first automatically)
```
