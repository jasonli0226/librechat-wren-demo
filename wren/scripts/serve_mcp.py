#!/usr/bin/env python3
"""Run `wren serve mcp` with Host-header checks that accept the Docker hostname.

wrenai builds its FastMCP server with the default 127.0.0.1 host, which locks
DNS-rebinding protection to localhost Host headers, and only rebinds to
0.0.0.0 afterwards. Other containers then get "421 Misdirected Request" when
they call http://wren-mcp:7080/mcp. This keeps the protection on and adds the
hostnames listed in MCP_ALLOWED_HOSTS.

It also lowers run_sql's default row cap (1000, not configurable in wrenai)
to MCP_ROW_LIMIT, so a stray SELECT * cannot flood the model's context.

It also registers save_chart (see chart_tool.py) when CHART_GALLERY_URL and
CHART_GALLERY_TOKEN are set.
All CLI arguments pass through.
"""
import os
import sys

import wren.mcp_server as mcp_server
from mcp.server.transport_security import TransportSecuritySettings
from wren.cli import app

from chart_tool import CHART_ROW_LIMIT, make_gallery_poster, register_save_chart

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("MCP_ALLOWED_HOSTS", "localhost:*,127.0.0.1:*").split(",")
    if h.strip()
]

mcp_server.DEFAULT_ROW_LIMIT = int(os.environ.get("MCP_ROW_LIMIT", "200"))

GALLERY_URL = os.environ.get("CHART_GALLERY_URL", "")
GALLERY_TOKEN = os.environ.get("CHART_GALLERY_TOKEN", "")

_build_server = mcp_server.build_server


def build_server(ctx):
    server = _build_server(ctx)
    server.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=ALLOWED_HOSTS,
        allowed_origins=[f"http://{h}" for h in ALLOWED_HOSTS],
    )
    if GALLERY_URL and GALLERY_TOKEN and not ctx.no_connect:
        register_save_chart(
            server,
            # Same execution path, role and row probe as run_sql.
            query=lambda sql: mcp_server._query_with_limit_probe(ctx, sql, CHART_ROW_LIMIT),
            post=make_gallery_poster(GALLERY_URL, GALLERY_TOKEN),
        )
    return server


mcp_server.build_server = build_server

if __name__ == "__main__":
    sys.argv[0] = "wren"
    sys.exit(app())
