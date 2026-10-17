import asyncio

import pytest
from mcp.server.fastmcp import FastMCP
from mcp.shared.memory import create_connected_server_and_client_session

from gallery.wren import WrenError, make_wren_query, run_sql_with_session

GOOD = {
    "columns": ["store", "revenue"],
    "rows": [{"store": "A", "revenue": 1.5}],
    "row_count": 1,
    "truncated": False,
}


def run_against(fake, sql="SELECT 1", limit=200):
    server = FastMCP("test")
    server.tool(name="run_sql")(fake)

    async def go():
        failure = None
        async with create_connected_server_and_client_session(server._mcp_server) as session:
            try:
                return await run_sql_with_session(session, sql, limit)
            except WrenError as exc:
                failure = exc  # raise outside the session's task group
        raise failure

    return asyncio.run(go())


def test_returns_columns_rows_truncated():
    result = run_against(lambda sql, limit=None: GOOD)
    assert result == {
        "columns": ["store", "revenue"],
        "rows": [{"store": "A", "revenue": 1.5}],
        "truncated": False,
    }


def test_passes_sql_and_limit():
    seen = []

    def fake(sql: str, limit: int | None = None) -> dict:
        seen.append((sql, limit))
        return GOOD

    run_against(fake)
    assert seen == [("SELECT 1", 200)]


def test_tool_error_raises_wren_error():
    def fake(sql: str, limit: int | None = None) -> dict:
        raise ValueError("bad column")

    with pytest.raises(WrenError, match="bad column"):
        run_against(fake)


def test_malformed_result_raises_wren_error():
    with pytest.raises(WrenError):
        run_against(lambda sql, limit=None: {"rows": "nope"})


def test_unreachable_url_raises_wren_error():
    with pytest.raises(WrenError):
        asyncio.run(make_wren_query("http://127.0.0.1:9/mcp", timeout=2)("SELECT 1"))
