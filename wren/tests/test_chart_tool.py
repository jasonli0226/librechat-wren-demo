import asyncio
import json

import httpx
import pytest

from chart_tool import GalleryError, make_gallery_poster, register_save_chart, save_chart

GOOD_RESULT = {
    "columns": ["store_name", "revenue"],
    "rows": [{"store_name": "Central", "revenue": 10.5}, {"store_name": "Kowloon", "revenue": None}],
    "row_count": 2,
    "truncated": False,
}
SAVED = {"id": 3, "url": "http://localhost:3090/charts/3", "status": "created"}


def call(query=None, post=None, **overrides):
    args = dict(
        title="Revenue by store",
        description="Completed revenue per store.",
        chart_type="bar",
        sql="SELECT store_name, revenue FROM x",
        x_field="store_name",
        y_fields=["revenue"],
    )
    args.update(overrides)
    return save_chart(query=query or (lambda sql: GOOD_RESULT), post=post or (lambda payload: SAVED), **args)


def result_with(**overrides):
    return {**GOOD_RESULT, **overrides}


def test_happy_path_posts_rerun_rows_and_returns_link():
    seen = {}

    def query(sql):
        seen["sql"] = sql
        return GOOD_RESULT

    def post(payload):
        seen["payload"] = payload
        return SAVED

    assert call(query=query, post=post) == {"saved": True, **SAVED}
    assert seen["sql"] == "SELECT store_name, revenue FROM x"
    assert seen["payload"] == {
        "title": "Revenue by store",
        "description": "Completed revenue per store.",
        "chart_type": "bar",
        "sql": "SELECT store_name, revenue FROM x",
        "x_field": "store_name",
        "y_fields": ["revenue"],
        "rows": GOOD_RESULT["rows"],
    }


def test_unsupported_chart_type_is_rejected_before_running_sql():
    def query(sql):
        raise AssertionError("must not run")

    result = call(query=query, chart_type="area")
    assert result == {"saved": False, "error": "save_chart supports line, bar, pie, scatter; the chart was not saved"}


def test_pie_needs_exactly_one_y_field():
    assert call(chart_type="pie", y_fields=["a", "b"])["error"] == "pie charts take exactly one y field"


def test_needs_at_least_one_y_field():
    assert call(y_fields=[])["error"] == "y_fields needs 1 to 5 column names"


def test_sql_error_is_reported():
    def query(sql):
        raise RuntimeError("column x does not exist")

    assert call(query=query)["error"] == "SQL failed in Wren: column x does not exist"


def test_unknown_field_lists_columns():
    assert call(x_field="store")["error"] == "unknown field(s): store; result columns are: store_name, revenue"


def test_field_case_mismatch_lists_exact_columns():
    assert call(y_fields=["Revenue"])["error"] == "unknown field(s): Revenue; result columns are: store_name, revenue"


@pytest.mark.parametrize("bad", ["1,234", True, "$10.00"])
def test_non_numeric_y_is_rejected_with_cast_hint(bad):
    rows = [{"store_name": "Central", "revenue": bad}]
    error = call(query=lambda sql: result_with(rows=rows))["error"]
    assert error.startswith("y field 'revenue' has a non-numeric value")
    assert "cast it to numeric in SQL" in error


SCATTER_ROWS = [{"price": 1.5, "units": 3}]


def scatter_call(rows, post=None):
    return call(
        query=lambda sql: result_with(columns=["price", "units"], rows=rows),
        post=post,
        chart_type="scatter",
        x_field="price",
        y_fields=["units"],
    )


def test_scatter_saves_with_numeric_x():
    posted = []

    def post(payload):
        posted.append(payload)
        return SAVED

    assert scatter_call(SCATTER_ROWS, post=post)["saved"] is True
    assert posted[0]["chart_type"] == "scatter"


@pytest.mark.parametrize("bad", ["cheap", True])
def test_scatter_rejects_non_numeric_x(bad):
    def post(payload):
        raise AssertionError("must not post")

    result = scatter_call([{"price": bad, "units": 3}], post=post)
    assert result["saved"] is False
    assert f"x field 'price' has a non-numeric value {bad!r}; cast it to numeric in SQL" in result["error"]


def test_scatter_rejects_null_x():
    def post(payload):
        raise AssertionError("must not post")

    result = scatter_call([{"price": None, "units": 3}], post=post)
    assert result["saved"] is False
    assert "x field 'price' has a non-numeric value None; cast it to numeric in SQL" in result["error"]


def test_unsupported_type_message_lists_scatter():
    assert "line, bar, pie, scatter" in call(chart_type="area")["error"]


def test_null_y_values_are_allowed():
    assert call()["saved"] is True


def test_truncated_result_is_rejected():
    error = call(query=lambda sql: result_with(truncated=True))["error"]
    assert error == "query returned more than 200 rows; aggregate further (GROUP BY) and try again"


def test_empty_result_is_rejected():
    assert call(query=lambda sql: result_with(rows=[]))["error"] == "query returned no rows; nothing to chart"


def test_gallery_failure_is_reported():
    def post(payload):
        raise GalleryError("HTTP 401: invalid or missing token")

    assert call(post=post) == {
        "saved": False,
        "error": "chart gallery rejected or unreachable: HTTP 401: invalid or missing token",
    }


def poster(handler):
    return make_gallery_poster("http://gallery.internal:3090", "s" * 40, transport=httpx.MockTransport(handler))


def test_poster_sends_bearer_json_and_returns_data():
    def handler(request):
        assert request.url.path == "/internal/charts"
        assert request.headers["authorization"] == "Bearer " + "s" * 40
        assert json.loads(request.content) == {"title": "t"}
        return httpx.Response(200, json={"success": True, "data": SAVED, "error": None})

    assert poster(handler)({"title": "t"}) == SAVED


def test_poster_raises_on_error_envelope():
    def handler(request):
        return httpx.Response(401, json={"success": False, "data": None, "error": "invalid or missing token"})

    with pytest.raises(GalleryError, match="HTTP 401: invalid or missing token"):
        poster(handler)({})


def test_poster_raises_on_non_json():
    def handler(request):
        return httpx.Response(502, text="bad gateway")

    with pytest.raises(GalleryError, match="HTTP 502: no detail"):
        poster(handler)({})


def test_poster_raises_when_unreachable():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(GalleryError, match="cannot reach the chart gallery"):
        poster(handler)({})


def test_register_adds_save_chart_tool():
    from mcp.server.fastmcp import FastMCP

    server = FastMCP("test")
    register_save_chart(server, query=lambda sql: GOOD_RESULT, post=lambda payload: SAVED)
    tools = {tool.name: tool for tool in asyncio.run(server.list_tools())}
    schema = tools["save_chart"].inputSchema
    assert schema["properties"]["y_fields"]["type"] == "array"
    assert set(schema["required"]) == {"title", "description", "chart_type", "sql", "x_field", "y_fields"}
