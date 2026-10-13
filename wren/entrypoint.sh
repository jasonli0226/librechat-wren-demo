#!/bin/bash
set -euo pipefail

echo "[wren-mcp] waiting for postgres..."
until python3 -c "
import socket, os, sys
s = socket.socket(); s.settimeout(2)
try:
    s.connect((os.environ['PG_HOST'], int(os.environ['PG_PORT'])))
except Exception as e:
    sys.exit(1)
" 2>/dev/null; do sleep 2; done
echo "[wren-mcp] postgres is up"

# Idempotent profile creation (uses ${WREN_RO_PASSWORD} expansion from env)
if ! wren profile list 2>/dev/null | grep -q "retail"; then
  wren profile add retail --from-file /wren/connection.yml
else
  echo "[wren-mcp] profile 'retail' already exists"
fi

cd /wren/project

# Bind profile to project (idempotent — rewrites profile: in wren_project.yml)
wren context set-profile retail

# Regenerate MDL from the live schema, then build the context manifest
echo "[wren-mcp] generating MDL from retail schema..."
python3 /wren/scripts/gen_mdl.py

echo "[wren-mcp] building wren context..."
wren context build

echo "[wren-mcp] starting MCP server (streamable HTTP on :7080)..."
exec python3 /wren/scripts/serve_mcp.py serve mcp --transport http --host 0.0.0.0 --port 7080
