#!/bin/bash
# One-command setup: prepare .env, build and start the stack, verify it.
# Safe to re-run: existing secrets and data are kept.
#
#   ./setup.sh                    # interactive: asks for the OpenRouter key if needed
#   OPENROUTER_KEY=sk-or-... ./setup.sh
#   ./setup.sh --data 500000      # also bulk-load 500k extra orders on first setup
set -euo pipefail
cd "$(dirname "$0")"

PORTS=(3080 7080 8888)
BOOT_TIMEOUT=900   # seconds; first boot pulls images and builds the Wren MDL
data_orders=0

usage() {
  cat <<'EOF'
Usage: ./setup.sh [options]

  --data N     after startup, generate N extra orders with scripts/generate-data.sh
               (skipped if the database already holds more than the seed data)
  -h, --help   show this help

Environment:
  OPENROUTER_KEY   used instead of prompting when .env has no key yet
EOF
}

step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data)    data_orders=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)         usage >&2; die "unknown option: $1" ;;
  esac
done
[[ $data_orders =~ ^[0-9]+$ ]] || die "--data must be a non-negative integer"

# ------------------------------------------------------------------ prerequisites
step "Checking prerequisites"
command -v docker >/dev/null || die "docker is not installed (https://docs.docker.com/get-docker/)"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon - is it running, and can this user access it?"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required ('docker compose', not 'docker-compose')"
command -v curl >/dev/null || die "curl is required"
echo "docker $(docker version -f '{{.Server.Version}}'), $(docker compose version --short | sed 's/^/compose /')"

# Ports only need to be free when our stack is not already running on them.
if [ -z "$(docker compose ps -q 2>/dev/null)" ]; then
  for port in "${PORTS[@]}"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      die "port $port is already in use - stop whatever is listening on it and re-run"
    fi
  done
fi

# ------------------------------------------------------------------ .env
step "Preparing .env"
[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example"; }
# shellcheck source=scripts/lib/env.sh
. scripts/lib/env.sh

key=$(env_get OPENROUTER_KEY)
if [ -z "$key" ] || [[ $key == *your-key* ]]; then
  if [ -n "${OPENROUTER_KEY:-}" ]; then
    key=$OPENROUTER_KEY
  elif [ -t 0 ]; then
    echo "An OpenRouter API key is needed for the chat models (https://openrouter.ai/keys)."
    read -r -s -p "OpenRouter API key: " key; echo
  else
    die "OPENROUTER_KEY is not set in .env - pass it as an environment variable or run interactively"
  fi
  [[ $key == sk-or-* ]] || die "that does not look like an OpenRouter key (expected sk-or-...)"
  env_set OPENROUTER_KEY "$key"
  echo "saved OPENROUTER_KEY to .env"
else
  echo "OPENROUTER_KEY already set"
fi
./scripts/gen-env.sh

# ------------------------------------------------------------------ start
step "Building and starting the stack (first run takes a few minutes)"
docker compose up -d --build --wait --wait-timeout "$BOOT_TIMEOUT" \
  || die "services did not become healthy - check 'docker compose ps' and 'docker compose logs wren-mcp'"

printf 'waiting for LibreChat'
deadline=$(( $(date +%s) + 180 ))
until curl -sf http://localhost:3080/health >/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo; die "LibreChat did not answer on :3080 - see 'docker compose logs librechat'"; }
  printf '.'; sleep 3
done
echo " up"

# ------------------------------------------------------------------ optional data
if [ "$data_orders" -gt 0 ]; then
  existing=$(docker compose exec -T retail-postgres psql -U postgres -d retail -tAc "SELECT count(*) FROM orders")
  if [ "$existing" -gt 14000 ]; then
    step "Skipping --data: database already holds ${existing} orders"
  else
    step "Generating ${data_orders} extra orders"
    ./scripts/generate-data.sh --orders "$data_orders"
  fi
fi

# ------------------------------------------------------------------ verify
step "Running smoke test"
./scripts/smoke-test.sh || die "smoke test failed - see the FAIL lines above"

cat <<'EOF'

Ready: open http://localhost:3080
  1. Sign up (the first account becomes admin)
  2. Start a new chat with "Retail Analyst (GLM-4.6)"
  3. Try: "How do monthly sales revenue trends look over the past 12 months? Chart it."

Stop:   docker compose down        (keeps data)
Reset:  docker compose down -v     (deletes all data and accounts)
EOF
