"""Client for the wren-mcp `run_sql` tool, used to re-run saved charts' SQL live."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import TextContent

RUN_SQL_TOOL = "run_sql"


class QueryResult(TypedDict):
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool


class WrenError(Exception):
    """A failed Wren query. The message is safe to log, not to return to clients."""


QueryFn = Callable[[str], Awaitable[QueryResult]]


def _payload(result: Any) -> Any:
    if result.structuredContent is not None:
        return result.structuredContent
    for block in result.content:
        if isinstance(block, TextContent):
            try:
                return json.loads(block.text)
            except ValueError as exc:
                raise WrenError(f"run_sql returned non-JSON text: {exc}") from exc
    raise WrenError("run_sql returned no content")


def _error_text(result: Any) -> str:
    texts = [block.text for block in result.content if isinstance(block, TextContent)]
    return " ".join(texts) or "unknown error"


def _parse(payload: Any) -> QueryResult:
    if not isinstance(payload, dict):
        raise WrenError("run_sql returned a non-object result")
    columns, rows = payload.get("columns"), payload.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        raise WrenError("run_sql result is missing columns or rows")
    if not all(isinstance(row, dict) for row in rows):
        raise WrenError("run_sql rows must be objects")
    return {
        "columns": [str(column) for column in columns],
        "rows": rows,
        "truncated": bool(payload.get("truncated", False)),
    }


async def run_sql_with_session(session: ClientSession, sql: str, limit: int) -> QueryResult:
    result = await session.call_tool(RUN_SQL_TOOL, {"sql": sql, "limit": limit})
    if result.isError:
        raise WrenError(f"run_sql failed: {_error_text(result)}")
    return _parse(_payload(result))


def make_wren_query(url: str, limit: int = 200, timeout: float = 10.0) -> QueryFn:
    """Build a query function that opens one MCP session per call.

    The timeout covers handshake plus query and propagates as TimeoutError.
    Any other transport failure becomes WrenError.
    """

    async def query(sql: str) -> QueryResult:
        failure: WrenError | None = None
        async with asyncio.timeout(timeout):
            try:
                async with streamable_http_client(url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        try:
                            return await run_sql_with_session(session, sql, limit)
                        except WrenError as exc:
                            # Re-raised after the context managers exit: raising through
                            # their task groups would wrap it in an ExceptionGroup.
                            failure = exc
            except Exception as exc:  # transport errors arrive as (nested) exception groups
                raise WrenError(f"Wren MCP request failed: {exc!r}") from exc
        assert failure is not None
        raise failure

    return query
