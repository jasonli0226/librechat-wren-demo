#!/bin/bash
# End-to-end smoke test for a running stack: SearXNG, Wren MCP, LibreChat.
# Usage: docker compose up -d --build && ./scripts/smoke-test.sh
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/env.sh
. scripts/lib/env.sh
fail=0
pass() { echo "PASS  $1"; }
flunk() { echo "FAIL  $1"; fail=1; }

# 1. SearXNG JSON API
if curl -sf "${SEARXNG_URL:-http://localhost:8888}/search?q=retail&format=json" | grep -q '"results"'; then
  pass "SearXNG JSON search"
else
  flunk "SearXNG JSON search"
fi

# 2. Wren MDL: the read-only role must see every table and FK
mdl=$(docker compose logs wren-mcp 2>/dev/null | grep '\[gen_mdl\] wrote' | tail -1)
if echo "$mdl" | grep -q 'wrote 13 models'; then
  pass "Wren MDL generated ($mdl)"
else
  flunk "Wren MDL generation (got: ${mdl:-no gen_mdl output})"
fi

# 3. Wren MCP handshake
init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
if curl -sf http://localhost:7080/mcp -X POST \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d "$init" | grep -q '"serverInfo"'; then
  pass "Wren MCP initialize"
else
  flunk "Wren MCP initialize"
fi

# 4. Read-only role can query but not write
ro_sql() {  # runs SQL as wren_ro inside the postgres container (password from its env)
  docker compose exec -T retail-postgres sh -c \
    'PGPASSWORD="$WREN_RO_PASSWORD" psql -h 127.0.0.1 -U wren_ro -d retail -tAc "$0"' "$1"
}
if [ "$(ro_sql 'SELECT count(*) > 0 FROM orders' 2>/dev/null)" = "t" ]; then
  pass "wren_ro can SELECT"
else
  flunk "wren_ro can SELECT"
fi
if ro_sql 'DELETE FROM orders WHERE false' >/dev/null 2>&1; then
  flunk "wren_ro is read-only (DELETE succeeded)"
else
  pass "wren_ro is read-only"
fi

# 5. LibreChat health
if curl -sf http://localhost:3080/health >/dev/null; then
  pass "LibreChat health"
else
  flunk "LibreChat health"
fi

# 6. Chart gallery: health, read API, write auth (without adding a chart)
gallery=${GALLERY_URL:-http://localhost:3090}
token=$(env_get CHART_GALLERY_TOKEN)
if curl -sf "$gallery/healthz" | grep -q '"success":true'; then pass "Gallery health"; else flunk "Gallery health"; fi
if curl -sf "$gallery/api/charts" | grep -q '"success":true'; then pass "Gallery list API"; else flunk "Gallery list API"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$gallery/internal/charts" -H 'content-type: application/json' -d '{}')
if [ "$code" = 401 ]; then pass "Gallery rejects writes without token"; else flunk "Gallery write without token (got $code)"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$gallery/internal/charts" \
  -H 'content-type: application/json' -H "Authorization: Bearer $token" -d '{}')
if [ "$code" = 422 ]; then pass "Gallery accepts the token"; else flunk "Gallery token check (got $code)"; fi

# 7. save_chart is registered on the Wren MCP server
mcp() {  # $1 = JSON-RPC body, $2 = session id (optional); prints the response
  curl -s -D "$hdrs" http://localhost:7080/mcp -X POST \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2025-03-26' ${2:+-H "mcp-session-id: $2"} -d "$1"
}
hdrs=$(mktemp)
mcp "$init" >/dev/null
sid=$(grep -i '^mcp-session-id:' "$hdrs" | tr -d '\r' | awk '{print $2}')
mcp '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$sid" >/dev/null
if mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' "$sid" | grep -q '"save_chart"'; then
  pass "Wren MCP exposes save_chart"
else
  flunk "Wren MCP exposes save_chart"
fi
rm -f "$hdrs"

exit $fail
