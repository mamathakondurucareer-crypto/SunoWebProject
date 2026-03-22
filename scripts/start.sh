#!/usr/bin/env bash
# ─── Devotional Workflow — Quick-start script ────────────────────────────────
# Checks prerequisites, creates data dirs, and brings up the stack.
#
# Usage:
#   ./scripts/start.sh           # production (detached)
#   ./scripts/start.sh --dev     # development with hot-reload
#   ./scripts/start.sh --build   # force rebuild before starting
#   ./scripts/start.sh --down    # stop and remove containers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

DEV=false
BUILD=false
DOWN=false

for arg in "$@"; do
  case "$arg" in
    --dev)   DEV=true ;;
    --build) BUILD=true ;;
    --down)  DOWN=true ;;
    --help|-h)
      echo "Usage: $0 [--dev] [--build] [--down]"
      exit 0
      ;;
  esac
done

# ── Stop / remove containers ──────────────────────────────────────────────────
if $DOWN; then
  echo "Stopping containers..."
  docker compose down
  exit 0
fi

# ── Prerequisite checks ───────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is not installed or not in PATH" >&2
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "ERROR: Docker Compose v2 is required (docker compose, not docker-compose)" >&2
  exit 1
fi

# ── .env setup ────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "No .env found — copying from .env.example"
    cp .env.example .env
    echo "  Edit .env now if you need to set API keys, then re-run this script."
    echo "  Required: at minimum HOST_DATA_DIR (defaults to ./data)"
  else
    echo "ERROR: .env not found and no .env.example to copy from" >&2
    exit 1
  fi
fi

# Source HOST_DATA_DIR from .env if set, otherwise default to ./data
HOST_DATA_DIR="$(grep -E '^HOST_DATA_DIR=' .env | cut -d= -f2- | tr -d '"' || true)"
HOST_DATA_DIR="${HOST_DATA_DIR:-./data}"

# ── Data directories ──────────────────────────────────────────────────────────
echo "Initialising data directories at: $HOST_DATA_DIR"
bash scripts/init-data-dirs.sh "$HOST_DATA_DIR"

# ── Build ─────────────────────────────────────────────────────────────────────
COMPOSE_FILES="-f docker-compose.yml"
if $DEV; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.dev.yml"
fi

if $BUILD; then
  echo "Building images..."
  docker compose $COMPOSE_FILES build
fi

# ── Start ─────────────────────────────────────────────────────────────────────
if $DEV; then
  echo "Starting in DEVELOPMENT mode (hot-reload)..."
  docker compose $COMPOSE_FILES up
else
  echo "Starting in PRODUCTION mode..."
  docker compose $COMPOSE_FILES up -d
  echo ""
  echo "Stack is up. Access the app at:"
  WEB_PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2- | tr -d '"' || true)"
  WEB_PORT="${WEB_PORT:-3000}"
  echo "  http://localhost:${WEB_PORT}"
  echo ""
  echo "Useful commands:"
  echo "  docker compose logs -f web     # web app logs"
  echo "  docker compose logs -f worker  # worker logs"
  echo "  docker compose ps              # service status"
  echo "  docker compose down            # stop everything"
fi
