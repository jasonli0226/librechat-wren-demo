import asyncio
from datetime import datetime

import httpx
from fastapi.testclient import TestClient

from gallery.app import create_app
from gallery.config import Settings
from gallery.wren import WrenError

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SQL = "SELECT s.store_name, SUM(o.total) AS revenue FROM stores s JOIN orders o ON o.store_id = s.store_id GROUP BY 1"
RESULT = {"columns": ["store_name", "revenue"], "rows": [{"store_name": "Central", "revenue": 11.0}], "truncated": False}
CHART = {
    "title": "Revenue by store",
    "description": "Completed revenue per store.",
    "chart_type": "bar",
    "x_field": "store_name",
    "y_fields": ["revenue"],
    "sql": SQL,
    "rows": [{"store_name": "Central", "revenue": 10.5}],
}


class FakeQuery:
    def __init__(self, result=None, error=None):
        self.result = result or RESULT
        self.error = error
        self.calls: list[str] = []

    async def __call__(self, sql):
        self.calls.append(sql)
        if self.error:
            raise self.error
        return self.result


def make_app(tmp_path, query):
    settings = Settings(
        token=TOKEN,
        db_path=str(tmp_path / "charts.db"),
        public_url="http://gallery.test",
        allowed_hosts=("testserver",),
    )
    return create_app(settings, query=query)


def seeded(tmp_path, query):
    client = TestClient(make_app(tmp_path, query))
    assert client.post("/internal/charts", json=CHART, headers=AUTH).status_code == 200
    return client


def test_returns_live_rows_for_saved_sql(tmp_path):
    query = FakeQuery()
    response = seeded(tmp_path, query).get("/api/charts/1/data")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["rows"] == RESULT["rows"]
    assert data["columns"] == RESULT["columns"]
    assert data["truncated"] is False
    datetime.fromisoformat(data["ran_at"])
    assert query.calls == [SQL]


def test_unknown_chart_is_404_and_runs_nothing(tmp_path):
    query = FakeQuery()
    response = seeded(tmp_path, query).get("/api/charts/99/data")
    assert response.status_code == 404
    assert response.json()["error"] == "chart not found"
    assert query.calls == []


def test_wren_error_is_502_without_details(tmp_path):
    response = seeded(tmp_path, FakeQuery(error=WrenError("password=secret"))).get("/api/charts/1/data")
    assert response.status_code == 502
    assert response.json()["error"] == "live query failed"
    assert "secret" not in response.text


def test_timeout_is_504(tmp_path):
    response = seeded(tmp_path, FakeQuery(error=TimeoutError())).get("/api/charts/1/data")
    assert response.status_code == 504
    assert response.json()["error"] == "live query timed out"


def test_rate_limit_allows_a_dashboard_and_a_rebuild_then_429(tmp_path):
    client = seeded(tmp_path, FakeQuery())
    for _ in range(24):  # 12 tiles x 2 loads
        assert client.get("/api/charts/1/data").status_code == 200
    for _ in range(24, 60):
        assert client.get("/api/charts/1/data").status_code == 200
    response = client.get("/api/charts/1/data")
    assert response.status_code == 429
    assert response.json()["error"] == "too many requests"


def test_concurrency_is_capped(tmp_path):
    asyncio.run(_concurrency_is_capped(tmp_path))


async def _concurrency_is_capped(tmp_path):
    in_flight = 0
    max_in_flight = 0
    release = asyncio.Event()

    async def query(_sql):
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        try:
            await release.wait()
        finally:
            in_flight -= 1
        return RESULT

    app = make_app(tmp_path, query)
    seeded_client = TestClient(app)
    seeded_client.post("/internal/charts", json=CHART, headers=AUTH)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        tasks = [asyncio.create_task(client.get("/api/charts/1/data")) for _ in range(8)]
        for _ in range(50):
            await asyncio.sleep(0.01)
        release.set()
        responses = await asyncio.gather(*tasks)
    assert all(r.status_code == 200 for r in responses)
    assert max_in_flight == 4
