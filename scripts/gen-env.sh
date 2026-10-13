#!/bin/bash
# Fills generated secrets in .env (only keys that are missing or empty).
# Portable across GNU and BSD/macOS (no sed -i).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { cp .env.example .env; echo "created .env from example"; }
# shellcheck source=lib/env.sh
. scripts/lib/env.sh

rand_hex() {  # $1 = number of random bytes
  openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# key:bytes. LibreChat needs CREDS_KEY = 32 bytes and CREDS_IV = 16 bytes (AES-256-CBC).
for spec in RETAIL_DB_PASSWORD:24 WREN_RO_PASSWORD:24 SEARXNG_SECRET:32 \
            CREDS_KEY:32 CREDS_IV:16 JWT_SECRET:32 JWT_REFRESH_SECRET:32; do
  key=${spec%%:*}; bytes=${spec##*:}
  val=$(env_get "$key")
  if [ -z "$val" ]; then
    env_set "$key" "$(rand_hex "$bytes")"; echo "generated ${key}"
  elif [ "$key" = CREDS_IV ] && [ ${#val} -ne 32 ]; then
    env_set "$key" "$(rand_hex 16)"; echo "regenerated CREDS_IV (must be 32 hex chars, was ${#val})"
  fi
done
echo ".env ready"
