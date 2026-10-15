#!/bin/bash
# Throwaway gallery for the E2E tests: a fresh SQLite file, the current SPA build and the
# locally served model. Never touches the compose stack's gallery_data volume.
# Usage (started by playwright.config.ts): scripts/e2e-gallery.sh <port>
set -euo pipefail
cd "$(dirname "$0")/.."
port=${1:-3091}
node scripts/fetch-model.mjs public   # skips files already present; Vite copies public/ into dist
npm run -s build
db_dir=$(mktemp -d)
trap 'rm -rf "$db_dir"' EXIT
cd ../api
GALLERY_DB_PATH="$db_dir/charts.db" GALLERY_STATIC_DIR="$PWD/../web/dist" GALLERY_PUBLIC_URL="http://localhost:$port" \
  uv run uvicorn gallery.main:app --host 127.0.0.1 --port "$port"
