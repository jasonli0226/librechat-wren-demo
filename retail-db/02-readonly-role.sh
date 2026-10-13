#!/bin/bash
# Creates the read-only role used by the Wren MCP server (least privilege).
# Runs after 01-init.sql, so the GRANT covers every table already created.
set -euo pipefail
: "${WREN_RO_PASSWORD:?WREN_RO_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ro_pass="$WREN_RO_PASSWORD" <<'SQL'
CREATE ROLE wren_ro LOGIN PASSWORD :'ro_pass';
GRANT CONNECT ON DATABASE retail TO wren_ro;
GRANT USAGE ON SCHEMA public TO wren_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wren_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO wren_ro;
SQL
