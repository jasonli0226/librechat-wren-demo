"""save_chart MCP tool: re-runs a chart's SQL through Wren and stores the chart in the gallery.

The model never sends data rows. The rows come from running the SQL again through
Wren's own run_sql path (read-only role, row cap), so every stored number is real.
Failures come back as {"saved": False, "error": ...} so the chat answer is never broken.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

SUPPORTED_TYPES = ("line", "bar", "pie", "scatter")
CHART_ROW_LIMIT = 200
MAX_Y_FIELDS = 5

QueryFn = Callable[[str], dict[str, Any]]
PostFn = Callable[[dict[str, Any]], dict[str, Any]]


class GalleryError(Exception):
    pass


def _fail(message: str) -> dict[str, Any]:
    return {"saved": False, "error": message}


def _check_spec(chart_type: str, y_fields: list[str]) -> str | None:
    if chart_type not in SUPPORTED_TYPES:
        return "save_chart supports line, bar, pie, scatter; the chart was not saved"
    if not 1 <= len(y_fields) <= MAX_Y_FIELDS:
        return f"y_fields needs 1 to {MAX_Y_FIELDS} column names"
    if chart_type == "pie" and len(y_fields) != 1:
        return "pie charts take exactly one y field"
    return None


def _check_result(result: dict[str, Any], x_field: str, y_fields: list[str], chart_type: str) -> str | None:
    columns = list(result.get("columns", []))
    rows = result.get("rows", [])
    if result.get("truncated"):
        return f"query returned more than {CHART_ROW_LIMIT} rows; aggregate further (GROUP BY) and try again"
    if not rows:
        return "query returned no rows; nothing to chart"
    missing = [field for field in (x_field, *y_fields) if field not in columns]
    if missing:
        return f"unknown field(s): {', '.join(missing)}; result columns are: {', '.join(columns)}"
    # Scatter x must be numeric on every row (null included) or the dashboard cannot draw it as a scatter.
    numeric_fields = [("x", x_field, False)] if chart_type == "scatter" else []
    numeric_fields += [("y", field, True) for field in y_fields]
    for axis, field, allow_null in numeric_fields:
        for row in rows:
            value = row.get(field)
            if value is None and allow_null:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return f"{axis} field '{field}' has a non-numeric value {value!r}; cast it to numeric in SQL"
    return None


def save_chart(
    *,
    query: QueryFn,
    post: PostFn,
    title: str,
    description: str,
    chart_type: str,
    sql: str,
    x_field: str,
    y_fields: list[str],
) -> dict[str, Any]:
    spec_error = _check_spec(chart_type, y_fields)
    if spec_error:
        return _fail(spec_error)
    try:
        result = query(sql)
    except Exception as exc:  # Wren raises many types; the model only needs the message.
        return _fail(f"SQL failed in Wren: {exc}")
    result_error = _check_result(result, x_field, y_fields, chart_type)
    if result_error:
        return _fail(result_error)
    payload = {
        "title": title,
        "description": description,
        "chart_type": chart_type,
        "sql": sql,
        "x_field": x_field,
        "y_fields": list(y_fields),
        "rows": result["rows"],
    }
    try:
        saved = post(payload)
    except GalleryError as exc:
        return _fail(f"chart gallery rejected or unreachable: {exc}")
    return {"saved": True, "id": saved["id"], "url": saved["url"], "status": saved["status"]}


def make_gallery_poster(
    base_url: str, token: str, timeout: float = 10.0, transport: httpx.BaseTransport | None = None
) -> PostFn:
    def post(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            with httpx.Client(base_url=base_url, timeout=timeout, transport=transport) as client:
                response = client.post("/internal/charts", json=payload, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            raise GalleryError(f"cannot reach the chart gallery ({exc.__class__.__name__})") from exc
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code != 200 or not body.get("success"):
            raise GalleryError(f"HTTP {response.status_code}: {body.get('error') or 'no detail'}")
        return body["data"]

    return post


def register_save_chart(server: Any, query: QueryFn, post: PostFn) -> None:
    from mcp.types import ToolAnnotations

    @server.tool(name="save_chart", annotations=ToolAnnotations(title="Save Chart", readOnlyHint=False))
    def save_chart_tool(
        title: str, description: str, chart_type: str, sql: str, x_field: str, y_fields: list[str]
    ) -> dict[str, Any]:
        """Save a chart you just drew to the shared chart gallery and get its link.

        Call this once after every chart artifact. The SQL is run again through Wren
        (max 200 rows), so pass the exact SQL you ran with run_sql.

        - title: short name of the chart, under 80 characters
        - description: one or two sentences on what the chart shows
        - chart_type: "line", "bar", "pie" or "scatter"
        - x_field: result column for the x axis (pie: slice label; scatter: numeric,
          non-year column; scatter needs at least 5 rows, use a line chart for years)
        - y_fields: result column(s) to plot, 1-5 numeric columns (pie: exactly one)

        Returns {"saved": true, "url": ...} — put the url in your answer — or
        {"saved": false, "error": ...} explaining what to fix.
        """
        return save_chart(
            query=query,
            post=post,
            title=title,
            description=description,
            chart_type=chart_type,
            sql=sql,
            x_field=x_field,
            y_fields=y_fields,
        )
