import logging

import pytest
from fastapi.testclient import TestClient

from gallery.app import MAX_BODY_BYTES, create_app
from gallery.config import Settings

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SQL = "SELECT s.store_name, SUM(o.total) AS revenue FROM stores s JOIN orders o ON o.store_id = s.store_id GROUP BY 1"


@pytest.fixture
def client(tmp_path):
    static = tmp_path / "static"
    (static / "ort").mkdir(parents=True)
    (static / "index.html").write_text("<html>spa</html>")
    (static / "ort" / "ort-wasm.wasm").write_bytes(b"\0asm")
    settings = Settings(
        token=TOKEN,
        db_path=str(tmp_path / "charts.db"),
        public_url="http://gallery.test",
        static_dir=str(static),
        allowed_hosts=("testserver",),
    )
    return TestClient(create_app(settings))


def payload(**overrides):
    base = {
        "title": "Revenue by store",
        "description": "Completed revenue per store.",
        "chart_type": "bar",
        "x_field": "store_name",
        "y_fields": ["revenue"],
        "sql": SQL,
        "rows": [{"store_name": "Central", "revenue": 10.5}, {"store_name": "Kowloon", "revenue": 7.25}],
    }
    return {**base, **overrides}


def save(client, **overrides):
    return client.post("/internal/charts", json=payload(**overrides), headers=AUTH)


def test_save_creates_chart_with_public_url(client):
    response = save(client)
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"id": 1, "url": "http://gallery.test/charts/1", "status": "created"},
        "error": None,
    }


def test_restyled_sql_updates_same_chart(client):
    save(client)
    restyled = "select S.STORE_NAME, sum(O.TOTAL) as revenue -- again\nfrom STORES s join ORDERS o on o.store_id=s.store_id group by 1"
    response = save(client, sql=restyled, title="Store revenue")
    assert response.json()["data"] == {"id": 1, "url": "http://gallery.test/charts/1", "status": "updated"}


def test_same_sql_as_pie_is_a_new_chart(client):
    save(client)
    assert save(client, chart_type="pie").json()["data"]["id"] == 2


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}])
def test_rejects_missing_or_wrong_token(client, headers):
    response = client.post("/internal/charts", json=payload(), headers=headers)
    assert response.status_code == 401
    assert response.json() == {"success": False, "data": None, "error": "invalid or missing token"}


def test_auth_is_checked_before_body_validation(client):
    assert client.post("/internal/charts", json={}, headers={}).status_code == 401


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"title": "x" * 121}, "title"),
        ({"description": ""}, "description"),
        ({"chart_type": "area"}, "chart_type"),
        ({"chart_type": "pie", "y_fields": ["revenue", "orders"]}, "exactly one y field"),
        ({"y_fields": []}, "y_fields"),
        ({"y_fields": ["revenue", "revenue"]}, "unique"),
        ({"x_field": "store"}, "fields not in rows: store"),
        ({"rows": []}, "rows"),
        ({"rows": [{"store_name": "s", "revenue": 1}] * 201}, "rows"),
        ({"extra": 1}, "extra"),
    ],
)
def test_validation_errors_use_envelope(client, overrides, message):
    response = save(client, **overrides)
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False and body["data"] is None
    assert message in body["error"]


def test_body_over_limit_is_rejected(client):
    response = client.post(
        "/internal/charts",
        content=b"x" * (MAX_BODY_BYTES + 1),
        headers={**AUTH, "content-type": "application/json"},
    )
    assert response.status_code == 413


def test_list_omits_rows_and_sql(client):
    save(client)
    data = client.get("/api/charts").json()["data"]
    assert data == [
        {
            "id": 1,
            "title": "Revenue by store",
            "description": "Completed revenue per store.",
            "chart_type": "bar",
            "tables": ["orders", "stores"],
            "updated_at": data[0]["updated_at"],
        }
    ]


def test_detail_includes_rows_sql_and_fields(client):
    save(client)
    data = client.get("/api/charts/1").json()["data"]
    assert data["rows"][0] == {"store_name": "Central", "revenue": 10.5}
    assert data["sql"] == SQL
    assert data["x_field"] == "store_name" and data["y_fields"] == ["revenue"]


def test_missing_chart_is_404_envelope(client):
    response = client.get("/api/charts/99")
    assert response.status_code == 404
    assert response.json() == {"success": False, "data": None, "error": "chart not found"}


def test_healthz(client):
    assert client.get("/healthz").json() == {"success": True, "data": {"status": "ok"}, "error": None}


def test_spa_fallback_serves_index_for_client_routes(client):
    response = client.get("/charts/5")
    assert response.status_code == 200
    assert "spa" in response.text


def test_unknown_api_and_asset_paths_stay_404(client):
    assert client.get("/api/nope").status_code == 404
    assert client.get("/models/missing.onnx").status_code == 404


def test_wasm_is_served_with_wasm_mime_type(client):
    assert client.get("/ort/ort-wasm.wasm").headers["content-type"] == "application/wasm"


def test_logs_never_contain_sql_or_token(client, caplog):
    caplog.set_level(logging.DEBUG)
    save(client)
    assert "SELECT" not in caplog.text and TOKEN not in caplog.text
    assert "chart 1 created" in caplog.text


def test_rejects_unknown_host_header(client):
    # DNS rebinding: a page on evil.example resolving to 127.0.0.1 must not read charts.
    response = client.get("/api/charts", headers={"Host": "evil.example"})
    assert response.status_code == 400
