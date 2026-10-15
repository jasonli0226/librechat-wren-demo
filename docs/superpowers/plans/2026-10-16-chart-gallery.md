# Chart Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chart the Retail Analyst draws is saved (title, description, spec, rows re-run through Wren) to a new gallery app that lists charts and suggests related ones by meaning.

**Architecture:** A new `save_chart` tool registered inside the existing `wren-mcp` server re-runs the chart SQL through Wren's own `run_sql` path and POSTs the result to a new `chart-gallery` container (FastAPI + SQLite + a React SPA). The SPA renders charts from a declarative spec with recharts and ranks related charts in a Web Worker with `semantic-state` (`useSimilar`), using a title+description embedding plus a one-hot "tables" feature; the embedding model is served by the gallery itself.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, SQLite, sqlglot 30.23.0, httpx, pytest · Vite, React 19, TypeScript, react-router 7, recharts, semantic-state 0.1.0-experimental.1, @huggingface/transformers, vitest, Testing Library, Playwright · Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-16-chart-gallery-design.md`

## Global Constraints

- Branch: `feat/chart-gallery`. Commit messages: conventional (`feat:`, `test:`, `docs:`, `chore:`), **no** `Co-Authored-By` or any Claude attribution trailer.
- `semantic-state` pinned to the exact version `0.1.0-experimental.1` (`npm install --save-exact`).
- `sqlglot==30.23.0`; `wrenai==0.15.0` stays as is in `wren/Dockerfile`.
- Chart types: `line | bar | pie` only. `y_fields`: 1–5 unique names; pie: exactly 1. Rows: 1–200. Title: 1–120 chars. Description: 1–500 chars.
- `save_chart` re-runs SQL with a 200-row cap; a truncated result is rejected.
- Dedup key: `sha256(normalized_sql + "|" + chart_type)`; upsert keeps `id` and `created_at`.
- `CHART_GALLERY_TOKEN`: required, ≥ 32 chars, compared with `hmac.compare_digest`. Generated as 32 random bytes (64 hex chars) by `scripts/gen-env.sh`.
- Gallery port: `127.0.0.1:3090` only. Uvicorn: exactly one worker. SQLite: `journal_mode=WAL`, `busy_timeout=5000`.
- Response envelope everywhere: `{ "success": bool, "data": ..., "error": string | null }`.
- Gallery logs chart id + status only — never rows, SQL or the token.
- Ranking: weights `{ text: 1, tables: TABLE_WEIGHT }`, `TABLE_WEIGHT = 0.15`, `RELATED_COUNT = 5`. Embedding model `Xenova/all-MiniLM-L6-v2` (q8), served from `/models/`, onnxruntime wasm from `/ort/`; the browser must make no request to huggingface.co or a CDN.
- Chart colours: categorical slots from the dataviz reference palette (light/dark), assigned in fixed order, never cycled; pie folds to "Other" beyond 8 slices. Legend only for ≥ 2 series (pie always has one).
- Coverage target: 80%+ for new Python and TypeScript code.

## Review Focus

Failure modes the spec implies that are most likely to bite a real user; each has a pinned test in the owning task.

1. **Model passes a y field in the wrong case** (`Revenue` vs result column `revenue`) → `save_chart` returns an error listing the exact result columns, so the model can fix the call. Test: Task 4 `test_field_case_mismatch_lists_exact_columns`.
2. **Chart title or description containing HTML** (`<img src=x onerror=alert(1)>`) → shown as literal text, no element created. Test: Task 7 `renders hostile titles as text`.
3. **Rows with `null` y values and ISO-date x values** → line chart still renders and the data table shows `—`. Tests: Task 5 `renders a line chart with null values`, Task 7 `shows a dash for null cells`.
4. **Gallery API down or returning non-JSON** → list page shows an alert with a message, never a blank page. Tests: Task 5 `api.test.ts` network/non-JSON cases, Task 7 `shows an alert when the API is unreachable`.
5. **Pie with more than 8 categories** → folded into 8 slices with "Other", colours never repeat. Test: Task 5 `foldPieRows` tests.

---

## File Structure

```
chart-gallery/
├── .dockerignore
├── .gitignore
├── Dockerfile                      # node build stage (SPA + model) → python runtime
├── api/
│   ├── pyproject.toml / uv.lock
│   ├── gallery/
│   │   ├── __init__.py
│   │   ├── normalize.py            # SQL → canonical text + tables; dedup key
│   │   ├── repository.py           # SQLite storage (WAL, upsert)
│   │   ├── models.py               # Pydantic ChartIn
│   │   ├── config.py               # Settings.from_env (token check)
│   │   ├── app.py                  # create_app: routes, auth, envelope, SPA static
│   │   └── main.py                 # uvicorn entry: gallery.main:app
│   └── tests/
│       ├── test_normalize.py
│       ├── test_repository.py
│       ├── test_config.py
│       └── test_app.py
└── web/
    ├── package.json / package-lock.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── playwright.config.ts
    ├── index.html
    ├── scripts/fetch-model.mjs     # model + ort wasm → <dir>/models, <dir>/ort
    ├── e2e/gallery.spec.ts
    └── src/
        ├── main.tsx
        ├── App.tsx                 # App, Layout, AppRoutes
        ├── config.ts               # LIBRECHAT_URL
        ├── styles.css              # tokens (light/dark), layout
        ├── types.ts
        ├── api.ts                  # fetchCharts, fetchChart, ApiError
        ├── useRequest.ts
        ├── charts.ts               # useChartList (upserts into store), useChart
        ├── filter.ts
        ├── time.ts                 # relativeTime
        ├── components/
        │   ├── chartData.ts        # seriesColor, foldPieRows
        │   ├── ChartView.tsx
        │   ├── ChartCard.tsx       # ChartCard, TableChips
        │   └── DataTable.tsx
        ├── pages/
        │   ├── ListPage.tsx
        │   ├── DetailPage.tsx
        │   └── NotFound.tsx
        ├── semantic/
        │   ├── model.json          # embedding model id + files (shared with fetch-model.mjs)
        │   ├── features.ts         # constants, chartText, tableFeatures, sharedTables
        │   ├── failOnce.ts
        │   ├── charts.worker.ts
        │   ├── store.ts
        │   ├── useRelatedCharts.ts # isRefining, useRelatedCharts
        │   └── RelatedCharts.tsx   # RelatedCharts, relatedReason
        └── test/
            ├── setup.ts
            ├── fakeStore.ts
            ├── mockApi.ts
            ├── fixtures.ts
            └── renderApp.tsx
wren/scripts/chart_tool.py          # save_chart logic + gallery poster + registration
wren/scripts/serve_mcp.py           # (modify) register save_chart
wren/tests/conftest.py, test_chart_tool.py
docker-compose.yml, scripts/gen-env.sh, .env.example, setup.sh, scripts/smoke-test.sh (modify)
librechat/librechat.yaml, wren/project/knowledge/rules/retail.md, README.md (modify)
```

---

### Task 1: Gallery API project and SQL normalizer

**Files:**
- Create: `chart-gallery/.gitignore`, `chart-gallery/api/pyproject.toml` (via uv), `chart-gallery/api/uv.lock`, `chart-gallery/api/gallery/__init__.py`, `chart-gallery/api/gallery/normalize.py`
- Test: `chart-gallery/api/tests/test_normalize.py`

**Interfaces:**
- Produces: `NormalizedSql(text: str, tables: tuple[str, ...])` (frozen dataclass), `normalize_sql(sql: str) -> NormalizedSql`, `dedup_key(normalized_text: str, chart_type: str) -> str` (64-char hex).

- [ ] **Step 1: Create the project**

```bash
mkdir -p chart-gallery/api/gallery chart-gallery/api/tests
cd chart-gallery/api
uv init --bare --name chart-gallery --python 3.11
uv add fastapi "uvicorn[standard]" "sqlglot==30.23.0"
uv add --dev pytest pytest-cov httpx
touch gallery/__init__.py
```

Append to `chart-gallery/api/pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Create `chart-gallery/.gitignore`:

```gitignore
api/.venv/
api/.coverage
__pycache__/
web/node_modules/
web/dist/
web/coverage/
web/public/models/
web/public/ort/
web/test-results/
web/playwright-report/
```

- [ ] **Step 2: Write the failing tests** — `chart-gallery/api/tests/test_normalize.py`

```python
from gallery.normalize import NormalizedSql, dedup_key, normalize_sql

STORE_REVENUE = (
    "select s.store_name, sum(oi.line_total) as revenue -- per store\n"
    "FROM stores s JOIN orders o ON o.store_id=s.store_id "
    "JOIN order_items oi on oi.order_id = o.order_id group by 1"
)
STORE_REVENUE_RESTYLED = (
    "SELECT   S.Store_Name, SUM(OI.LINE_TOTAL) AS Revenue\n/* x */ from STORES s "
    "join ORDERS o on o.store_id = s.store_id join ORDER_ITEMS oi ON oi.order_id=o.order_id GROUP BY 1;"
)


def test_whitespace_case_and_comment_variants_normalize_identically():
    assert normalize_sql(STORE_REVENUE) == normalize_sql(STORE_REVENUE_RESTYLED)


def test_normalized_text_is_canonical_postgres():
    assert normalize_sql(STORE_REVENUE).text == (
        "SELECT s.store_name, SUM(oi.line_total) AS revenue FROM stores AS s "
        "JOIN orders AS o ON o.store_id = s.store_id "
        "JOIN order_items AS oi ON oi.order_id = o.order_id GROUP BY 1"
    )


def test_tables_are_sorted_lowercase_unique():
    assert normalize_sql(STORE_REVENUE).tables == ("order_items", "orders", "stores")


def test_quoted_identifiers_keep_their_case():
    assert normalize_sql('SELECT "Revenue" FROM orders').text == 'SELECT "Revenue" FROM orders'


def test_cte_names_are_not_tables():
    sql = "WITH m AS (SELECT count(*) AS n FROM orders) SELECT n FROM m"
    assert normalize_sql(sql).tables == ("orders",)


def test_schema_qualified_table_uses_table_name():
    assert normalize_sql("SELECT a FROM public.Orders").tables == ("orders",)


def test_table_functions_are_not_tables():
    assert normalize_sql("select * from generate_series(1, 3) g").tables == ()


def test_different_limit_is_different_sql():
    assert normalize_sql("SELECT x FROM orders LIMIT 10").text != normalize_sql("SELECT x FROM orders LIMIT 20").text


def test_unparseable_sql_falls_back_to_collapsed_lowercase():
    assert normalize_sql("SELEC  broken -- note\n (((") == NormalizedSql(text="selec broken (((", tables=())


def test_multiple_statements_fall_back():
    assert normalize_sql("SELECT 1; SELECT 2") == NormalizedSql(text="select 1; select 2", tables=())


def test_dedup_key_differs_by_chart_type_and_is_stable():
    text = normalize_sql(STORE_REVENUE).text
    assert dedup_key(text, "bar") != dedup_key(text, "pie")
    assert dedup_key(text, "bar") == dedup_key(text, "bar")
    assert len(dedup_key(text, "bar")) == 64
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd chart-gallery/api && uv run pytest tests/test_normalize.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'gallery.normalize'`

- [ ] **Step 4: Implement** — `chart-gallery/api/gallery/normalize.py`

```python
"""Canonical SQL text and table list, used only to build the chart dedup key."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class NormalizedSql:
    text: str
    tables: tuple[str, ...]


def normalize_sql(sql: str) -> NormalizedSql:
    """Re-emit SQL in canonical Postgres form; fall back to plain text cleanup if it won't parse."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except SqlglotError:
        return _fallback(sql)
    if len(statements) != 1:
        return _fallback(sql)
    tree = normalize_identifiers(statements[0], dialect="postgres")
    ctes = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    tables = {t.name.lower() for t in tree.find_all(exp.Table) if t.name} - ctes
    return NormalizedSql(text=tree.sql(dialect="postgres", comments=False), tables=tuple(sorted(tables)))


def dedup_key(normalized_text: str, chart_type: str) -> str:
    return hashlib.sha256(f"{normalized_text}|{chart_type}".encode()).hexdigest()


def _fallback(sql: str) -> NormalizedSql:
    text = _LINE_COMMENT.sub(" ", _BLOCK_COMMENT.sub(" ", sql))
    text = _WHITESPACE.sub(" ", text).strip().rstrip(";").strip().lower()
    return NormalizedSql(text=text, tables=())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd chart-gallery/api && uv run pytest tests/test_normalize.py -q`
Expected: 11 passed

- [ ] **Step 6: Commit**

```bash
git add chart-gallery/.gitignore chart-gallery/api
git commit -m "feat: add chart gallery SQL normalizer for dedup"
```

---

### Task 2: SQLite chart repository

**Files:**
- Create: `chart-gallery/api/gallery/repository.py`
- Test: `chart-gallery/api/tests/test_repository.py`

**Interfaces:**
- Consumes: nothing from Task 1 (the app combines them in Task 3).
- Produces:
  - `NewChart` frozen dataclass: `dedup_key: str, title: str, description: str, chart_type: str, x_field: str, y_fields: tuple[str, ...], sql: str, normalized_sql: str, tables: tuple[str, ...], rows: tuple[dict[str, Any], ...]`
  - `ChartRepository(db_path: str, clock: Callable[[], str] = utc_now)` with `init_schema() -> None`, `upsert(chart: NewChart) -> tuple[int, str]` (`"created"`/`"updated"`), `list_summaries() -> list[dict]` (keys `id, title, description, chart_type, tables, updated_at`), `get(chart_id: int) -> dict | None` (keys `id, title, description, chart_type, x_field, y_fields, sql, tables, rows, created_at, updated_at`), `ping() -> bool`, `journal_mode() -> str`.

- [ ] **Step 1: Write the failing tests** — `chart-gallery/api/tests/test_repository.py`

```python
import sqlite3

import pytest

from gallery.repository import ChartRepository, NewChart

T1, T2, T3 = "2026-10-16T10:00:00+00:00", "2026-10-16T11:00:00+00:00", "2026-10-16T12:00:00+00:00"


def make_repo(tmp_path, times=(T1, T2, T3)):
    clock = iter(times)
    repo = ChartRepository(str(tmp_path / "charts.db"), clock=lambda: next(clock))
    repo.init_schema()
    return repo


def chart(**overrides) -> NewChart:
    base = dict(
        dedup_key="k1",
        title="Revenue by store",
        description="Completed revenue per store.",
        chart_type="bar",
        x_field="store_name",
        y_fields=("revenue",),
        sql="SELECT store_name, revenue FROM x",
        normalized_sql="SELECT store_name, revenue FROM x",
        tables=("orders", "stores"),
        rows=({"store_name": "Central", "revenue": 10.5},),
    )
    return NewChart(**{**base, **overrides})


def test_first_save_is_created(tmp_path):
    repo = make_repo(tmp_path)
    assert repo.upsert(chart()) == (1, "created")


def test_same_key_updates_in_place_and_keeps_created_at(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    rows = ({"store_name": "Central", "revenue": 99.0},)
    assert repo.upsert(chart(title="Store revenue", rows=rows)) == (1, "updated")
    saved = repo.get(1)
    assert saved["title"] == "Store revenue"
    assert saved["rows"] == [{"store_name": "Central", "revenue": 99.0}]
    assert saved["created_at"] == T1
    assert saved["updated_at"] == T2


def test_new_key_creates_second_chart(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    assert repo.upsert(chart(dedup_key="k2")) == (2, "created")


def test_list_is_newest_first_without_rows_or_sql(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart(dedup_key="k1", title="Old"))
    repo.upsert(chart(dedup_key="k2", title="New"))
    summaries = repo.list_summaries()
    assert [s["title"] for s in summaries] == ["New", "Old"]
    assert set(summaries[0]) == {"id", "title", "description", "chart_type", "tables", "updated_at"}
    assert summaries[0]["tables"] == ["orders", "stores"]


def test_get_decodes_json_columns(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    saved = repo.get(1)
    assert saved["y_fields"] == ["revenue"]
    assert saved["tables"] == ["orders", "stores"]
    assert saved["sql"] == "SELECT store_name, revenue FROM x"
    assert "dedup_key" not in saved and "normalized_sql" not in saved


def test_get_missing_returns_none(tmp_path):
    assert make_repo(tmp_path).get(42) is None


def test_wal_mode_and_ping(tmp_path):
    repo = make_repo(tmp_path)
    assert repo.journal_mode() == "wal"
    assert repo.ping() is True


def test_init_schema_is_idempotent(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    repo.init_schema()
    assert repo.get(1) is not None


def test_rejects_unknown_chart_type(tmp_path):
    repo = make_repo(tmp_path)
    with pytest.raises(sqlite3.IntegrityError):
        repo.upsert(chart(chart_type="area"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd chart-gallery/api && uv run pytest tests/test_repository.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'gallery.repository'`

- [ ] **Step 3: Implement** — `chart-gallery/api/gallery/repository.py`

```python
"""SQLite storage for charts. One writer (single Uvicorn worker); WAL lets reads run alongside it."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS charts (
    id             INTEGER PRIMARY KEY,
    dedup_key      TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL,
    chart_type     TEXT NOT NULL CHECK (chart_type IN ('line', 'bar', 'pie')),
    x_field        TEXT NOT NULL,
    y_fields       TEXT NOT NULL,
    sql            TEXT NOT NULL,
    normalized_sql TEXT NOT NULL,
    tables         TEXT NOT NULL,
    rows           TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
)
"""

_UPDATABLE = "title, description, chart_type, x_field, y_fields, sql, normalized_sql, tables, rows"


@dataclass(frozen=True)
class NewChart:
    dedup_key: str
    title: str
    description: str
    chart_type: str
    x_field: str
    y_fields: tuple[str, ...]
    sql: str
    normalized_sql: str
    tables: tuple[str, ...]
    rows: tuple[dict[str, Any], ...]


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ChartRepository:
    def __init__(self, db_path: str, clock: Callable[[], str] = utc_now) -> None:
        self._db_path = db_path
        self._clock = clock

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, timeout=5, isolation_level=None)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            yield conn
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(SCHEMA)

    def journal_mode(self) -> str:
        with self._connect() as conn:
            return str(conn.execute("PRAGMA journal_mode").fetchone()[0])

    def ping(self) -> bool:
        try:
            with self._connect() as conn:
                conn.execute("SELECT 1 FROM charts LIMIT 1")
            return True
        except sqlite3.Error:
            return False

    def upsert(self, chart: NewChart) -> tuple[int, str]:
        now = self._clock()
        values = (
            chart.title,
            chart.description,
            chart.chart_type,
            chart.x_field,
            json.dumps(list(chart.y_fields)),
            chart.sql,
            chart.normalized_sql,
            json.dumps(list(chart.tables)),
            json.dumps(list(chart.rows)),
        )
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing = conn.execute("SELECT id FROM charts WHERE dedup_key = ?", (chart.dedup_key,)).fetchone()
                if existing is None:
                    cursor = conn.execute(
                        f"INSERT INTO charts ({_UPDATABLE}, dedup_key, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (*values, chart.dedup_key, now, now),
                    )
                    result = (int(cursor.lastrowid), "created")
                else:
                    assignments = ", ".join(f"{col.strip()} = ?" for col in _UPDATABLE.split(","))
                    conn.execute(
                        f"UPDATE charts SET {assignments}, updated_at = ? WHERE id = ?",
                        (*values, now, existing["id"]),
                    )
                    result = (int(existing["id"]), "updated")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return result

    def list_summaries(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, title, description, chart_type, tables, updated_at "
                "FROM charts ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [{**dict(row), "tables": json.loads(row["tables"])} for row in rows]

    def get(self, chart_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, title, description, chart_type, x_field, y_fields, sql, tables, rows, "
                "created_at, updated_at FROM charts WHERE id = ?",
                (chart_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            **dict(row),
            "y_fields": json.loads(row["y_fields"]),
            "tables": json.loads(row["tables"]),
            "rows": json.loads(row["rows"]),
        }
```

(The f-strings only interpolate the constant `_UPDATABLE`; every value goes through `?` parameters.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chart-gallery/api && uv run pytest tests/test_repository.py -q`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add chart-gallery/api/gallery/repository.py chart-gallery/api/tests/test_repository.py
git commit -m "feat: add SQLite chart repository with upsert"
```

---

### Task 3: Gallery HTTP API

**Files:**
- Create: `chart-gallery/api/gallery/config.py`, `chart-gallery/api/gallery/models.py`, `chart-gallery/api/gallery/app.py`, `chart-gallery/api/gallery/main.py`
- Test: `chart-gallery/api/tests/test_config.py`, `chart-gallery/api/tests/test_app.py`

**Interfaces:**
- Consumes: `normalize_sql`, `dedup_key` (Task 1); `ChartRepository`, `NewChart` (Task 2).
- Produces:
  - `Settings(token: str, db_path: str, public_url: str, static_dir: str | None = None)`, `Settings.from_env(env: Mapping[str, str]) -> Settings`, `ConfigError`, `MIN_TOKEN_LENGTH = 32`.
  - `create_app(settings: Settings, repo: ChartRepository | None = None) -> FastAPI`; `gallery.main:app`.
  - HTTP contract used by Task 4 and the SPA:
    - `POST /internal/charts` body `{title, description, chart_type, x_field, y_fields, sql, rows}` → `200 {"success": true, "data": {"id": int, "url": str, "status": "created"|"updated"}, "error": null}`; 401 / 411 / 413 / 422 with `success: false` and `error` text.
    - `GET /api/charts` → `data: ChartSummary[]`; `GET /api/charts/{id}` → `data: ChartDetail` or 404; `GET /healthz`.
  - Env vars: `CHART_GALLERY_TOKEN`, `GALLERY_DB_PATH` (default `charts.db`), `GALLERY_PUBLIC_URL` (default `http://localhost:3090`), `GALLERY_STATIC_DIR` (optional).

- [ ] **Step 1: Write the failing config tests** — `chart-gallery/api/tests/test_config.py`

```python
import pytest

from gallery.config import ConfigError, Settings


def test_rejects_missing_token():
    with pytest.raises(ConfigError, match="CHART_GALLERY_TOKEN"):
        Settings.from_env({})


def test_rejects_short_token():
    with pytest.raises(ConfigError, match="at least 32"):
        Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 31})


def test_defaults_and_trailing_slash():
    settings = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "GALLERY_PUBLIC_URL": "http://gallery.test/"})
    assert settings.public_url == "http://gallery.test"
    assert settings.db_path == "charts.db"
    assert settings.static_dir is None


def test_reads_paths():
    settings = Settings.from_env(
        {"CHART_GALLERY_TOKEN": "x" * 40, "GALLERY_DB_PATH": "/data/c.db", "GALLERY_STATIC_DIR": "/app/static"}
    )
    assert (settings.db_path, settings.static_dir) == ("/data/c.db", "/app/static")
```

- [ ] **Step 2: Write the failing app tests** — `chart-gallery/api/tests/test_app.py`

```python
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
        token=TOKEN, db_path=str(tmp_path / "charts.db"), public_url="http://gallery.test", static_dir=str(static)
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd chart-gallery/api && uv run pytest tests/test_config.py tests/test_app.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'gallery.config'`

- [ ] **Step 4: Implement config** — `chart-gallery/api/gallery/config.py`

```python
"""Settings read from the environment. The service refuses to start without a strong token."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

MIN_TOKEN_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    token: str
    db_path: str
    public_url: str
    static_dir: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        token = env.get("CHART_GALLERY_TOKEN", "")
        if len(token) < MIN_TOKEN_LENGTH:
            raise ConfigError(f"CHART_GALLERY_TOKEN must be set and at least {MIN_TOKEN_LENGTH} characters")
        return cls(
            token=token,
            db_path=env.get("GALLERY_DB_PATH", "charts.db"),
            public_url=env.get("GALLERY_PUBLIC_URL", "http://localhost:3090").rstrip("/"),
            static_dir=env.get("GALLERY_STATIC_DIR") or None,
        )
```

- [ ] **Step 5: Implement the request model** — `chart-gallery/api/gallery/models.py`

```python
"""Validated body of POST /internal/charts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ChartType = Literal["line", "bar", "pie"]
MAX_ROWS = 200
MAX_Y_FIELDS = 5


class ChartIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    chart_type: ChartType
    x_field: str = Field(min_length=1, max_length=128)
    y_fields: list[str] = Field(min_length=1, max_length=MAX_Y_FIELDS)
    sql: str = Field(min_length=1, max_length=20_000)
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_ROWS)

    @model_validator(mode="after")
    def check_fields(self) -> ChartIn:
        if self.chart_type == "pie" and len(self.y_fields) != 1:
            raise ValueError("pie charts take exactly one y field")
        if len(set(self.y_fields)) != len(self.y_fields) or not all(self.y_fields):
            raise ValueError("y_fields must be unique, non-empty names")
        missing = [f for f in (self.x_field, *self.y_fields) if f not in self.rows[0]]
        if missing:
            raise ValueError(f"fields not in rows: {', '.join(missing)}")
        return self
```

- [ ] **Step 6: Implement the app** — `chart-gallery/api/gallery/app.py`

```python
"""HTTP API and static SPA for the chart gallery."""

from __future__ import annotations

import hmac
import logging
import mimetypes
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings
from .models import ChartIn
from .normalize import dedup_key, normalize_sql
from .repository import ChartRepository, NewChart

MAX_BODY_BYTES = 1_000_000
# Paths that must 404 instead of falling back to index.html.
NON_SPA_PREFIXES = ("api/", "internal/", "assets/", "models/", "ort/")

logger = logging.getLogger("gallery")
mimetypes.add_type("application/wasm", ".wasm")


def envelope(data: Any = None, error: str | None = None) -> dict[str, Any]:
    return {"success": error is None, "data": data, "error": error}


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(envelope(error=message), status_code=status)


class SpaStaticFiles(StaticFiles):
    """Static files with index.html as the fallback for client-side routes like /charts/12."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith(NON_SPA_PREFIXES):
                raise
            return await super().get_response("index.html", scope)


def create_app(settings: Settings, repo: ChartRepository | None = None) -> FastAPI:
    repository = repo or ChartRepository(settings.db_path)
    repository.init_schema()
    expected_auth = f"Bearer {settings.token}".encode()
    app = FastAPI(title="Chart Gallery", docs_url=None, redoc_url=None, openapi_url=None)

    def require_token(authorization: str | None = Header(default=None)) -> None:
        if authorization is None or not hmac.compare_digest(authorization.encode(), expected_auth):
            raise HTTPException(status_code=401, detail="invalid or missing token")

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None:
                return _error(411, "content-length required")
            if not length.isdigit() or int(length) > MAX_BODY_BYTES:
                return _error(413, "request body too large")
        return await call_next(request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in err['loc'][1:]) or 'body'}: {err['msg']}" for err in exc.errors()
        )
        return _error(422, problems)

    @app.post("/internal/charts", dependencies=[Depends(require_token)])
    def save_chart(chart: ChartIn) -> dict[str, Any]:
        normalized = normalize_sql(chart.sql)
        chart_id, status = repository.upsert(
            NewChart(
                dedup_key=dedup_key(normalized.text, chart.chart_type),
                title=chart.title,
                description=chart.description,
                chart_type=chart.chart_type,
                x_field=chart.x_field,
                y_fields=tuple(chart.y_fields),
                sql=chart.sql,
                normalized_sql=normalized.text,
                tables=normalized.tables,
                rows=tuple(chart.rows),
            )
        )
        logger.info("chart %s %s", chart_id, status)
        return envelope({"id": chart_id, "url": f"{settings.public_url}/charts/{chart_id}", "status": status})

    @app.get("/api/charts")
    def list_charts() -> dict[str, Any]:
        return envelope(repository.list_summaries())

    @app.get("/api/charts/{chart_id}")
    def get_chart(chart_id: int) -> dict[str, Any]:
        chart = repository.get(chart_id)
        if chart is None:
            raise HTTPException(status_code=404, detail="chart not found")
        return envelope(chart)

    @app.get("/healthz", response_model=None)
    def healthz() -> dict[str, Any] | JSONResponse:
        if not repository.ping():
            return _error(503, "database unavailable")
        return envelope({"status": "ok"})

    if settings.static_dir:
        app.mount("/", SpaStaticFiles(directory=settings.static_dir, html=True), name="spa")
    return app
```

- [ ] **Step 7: Implement the entry point** — `chart-gallery/api/gallery/main.py`

```python
"""Uvicorn entry point: `uvicorn gallery.main:app --workers 1`."""

import logging
import os

from .app import create_app
from .config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app(Settings.from_env(os.environ))
```

- [ ] **Step 8: Run the tests and coverage**

Run: `cd chart-gallery/api && uv run pytest -q --cov=gallery --cov-report=term-missing`
Expected: all pass; `gallery/main.py` is the only uncovered module; total ≥ 80%.
If `test_auth_is_checked_before_body_validation` fails with 422, move the token check into the `limit_body` middleware for `/internal/` paths (same `hmac.compare_digest`, same 401 envelope) and drop the `Depends`.

- [ ] **Step 9: Commit**

```bash
git add chart-gallery/api
git commit -m "feat: add chart gallery HTTP API"
```

---

### Task 4: `save_chart` tool in wren-mcp

**Files:**
- Create: `wren/scripts/chart_tool.py`, `wren/tests/conftest.py`
- Modify: `wren/scripts/serve_mcp.py`
- Test: `wren/tests/test_chart_tool.py`

**Interfaces:**
- Consumes: gallery `POST /internal/charts` contract (Task 3); `wren.mcp_server._query_with_limit_probe(ctx, sql, limit) -> {"columns": list[str], "rows": list[dict], "row_count": int, "truncated": bool}` from `wrenai==0.15.0`.
- Produces: `save_chart(*, query, post, title, description, chart_type, sql, x_field, y_fields) -> dict` returning `{"saved": True, "id", "url", "status"}` or `{"saved": False, "error": str}`; `make_gallery_poster(base_url, token, timeout=10.0, transport=None) -> PostFn`; `GalleryError`; `register_save_chart(server, query, post) -> None` (MCP tool named `save_chart`); `CHART_ROW_LIMIT = 200`.
- Env read by `serve_mcp.py`: `CHART_GALLERY_URL`, `CHART_GALLERY_TOKEN`.

- [ ] **Step 1: Write the failing tests**

`wren/tests/conftest.py`:

```python
import sys
from pathlib import Path

# chart_tool lives next to serve_mcp.py, which runs as a script from wren/scripts.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
```

`wren/tests/test_chart_tool.py`:

```python
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
    assert result == {"saved": False, "error": "save_chart supports line, bar, pie; the chart was not saved"}


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --no-project --with pytest --with pytest-cov --with httpx --with "mcp<2" pytest wren/tests -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chart_tool'`

- [ ] **Step 3: Implement** — `wren/scripts/chart_tool.py`

```python
"""save_chart MCP tool: re-runs a chart's SQL through Wren and stores the chart in the gallery.

The model never sends data rows. The rows come from running the SQL again through
Wren's own run_sql path (read-only role, row cap), so every stored number is real.
Failures come back as {"saved": False, "error": ...} so the chat answer is never broken.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

SUPPORTED_TYPES = ("line", "bar", "pie")
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
        return "save_chart supports line, bar, pie; the chart was not saved"
    if not 1 <= len(y_fields) <= MAX_Y_FIELDS:
        return f"y_fields needs 1 to {MAX_Y_FIELDS} column names"
    if chart_type == "pie" and len(y_fields) != 1:
        return "pie charts take exactly one y field"
    return None


def _check_result(result: dict[str, Any], x_field: str, y_fields: list[str]) -> str | None:
    columns = list(result.get("columns", []))
    rows = result.get("rows", [])
    if result.get("truncated"):
        return f"query returned more than {CHART_ROW_LIMIT} rows; aggregate further (GROUP BY) and try again"
    if not rows:
        return "query returned no rows; nothing to chart"
    missing = [field for field in (x_field, *y_fields) if field not in columns]
    if missing:
        return f"unknown field(s): {', '.join(missing)}; result columns are: {', '.join(columns)}"
    for field in y_fields:
        for row in rows:
            value = row.get(field)
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
                return f"y field '{field}' has a non-numeric value {value!r}; cast it to numeric in SQL"
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
    result_error = _check_result(result, x_field, y_fields)
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
        - chart_type: "line", "bar" or "pie"
        - x_field: result column for the x axis (pie: slice label)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --no-project --with pytest --with pytest-cov --with httpx --with "mcp<2" pytest wren/tests -q --cov=chart_tool --cov-report=term-missing`
Expected: all pass, `chart_tool` coverage ≥ 90%.

- [ ] **Step 5: Register the tool in the server** — edit `wren/scripts/serve_mcp.py`

Add to the module docstring, after the `MCP_ROW_LIMIT` paragraph:

```
It also registers save_chart (see chart_tool.py) when CHART_GALLERY_URL and
CHART_GALLERY_TOKEN are set.
```

Add after `from wren.cli import app`:

```python
from chart_tool import CHART_ROW_LIMIT, make_gallery_poster, register_save_chart
```

Add after the `mcp_server.DEFAULT_ROW_LIMIT = ...` line:

```python
GALLERY_URL = os.environ.get("CHART_GALLERY_URL", "")
GALLERY_TOKEN = os.environ.get("CHART_GALLERY_TOKEN", "")
```

Replace `build_server` with:

```python
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
```

(`serve_mcp.py` runs as a script from `/wren/scripts`, so `import chart_tool` resolves; the Dockerfile already copies `scripts/`. `httpx` ships with the `mcp` SDK. This glue is verified end to end by the smoke test in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add wren/scripts/chart_tool.py wren/scripts/serve_mcp.py wren/tests
git commit -m "feat: add save_chart MCP tool to wren-mcp"
```

---

### Task 5: Web app scaffold, API client and chart rendering

**Files:**
- Create: `chart-gallery/web/package.json` (via npm), `chart-gallery/web/tsconfig.json`, `chart-gallery/web/vite.config.ts`, `chart-gallery/web/src/styles.css`, `src/config.ts`, `src/types.ts`, `src/api.ts`, `src/useRequest.ts`, `src/charts.ts`, `src/components/chartData.ts`, `src/components/ChartView.tsx`, `src/test/setup.ts`, `src/test/fakeStore.ts`, `src/test/mockApi.ts`, `src/test/fixtures.ts`
- Test: `src/api.test.ts`, `src/components/chartData.test.ts`, `src/components/ChartView.test.tsx`

**Interfaces:**
- Consumes: HTTP contract from Task 3.
- Produces:
  - `types.ts`: `ChartType = 'line' | 'bar' | 'pie'`; `ChartSummary { id: number; title: string; description: string; chart_type: ChartType; tables: string[]; updated_at: string }`; `ChartDetail extends ChartSummary { x_field: string; y_fields: string[]; sql: string; rows: Record<string, unknown>[]; created_at: string }`.
  - `api.ts`: `class ApiError extends Error { status: number }`, `fetchCharts(): Promise<ChartSummary[]>`, `fetchChart(id: number): Promise<ChartDetail>`.
  - `useRequest.ts`: `RequestState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError }`, `useRequest<T>(load, deps)`.
  - `charts.ts`: `useChartList(): RequestState<ChartSummary[]>` (upserts the list into the semantic store), `useChart(id: number): RequestState<ChartDetail>`.
  - `components/chartData.ts`: `SERIES_COUNT = 8`, `seriesColor(index: number): string`, `foldPieRows(rows, xField, yField, max = SERIES_COUNT)`.
  - `components/ChartView.tsx`: `ChartSpec = Pick<ChartDetail, 'chart_type' | 'x_field' | 'y_fields' | 'rows'>`, `<ChartView chart height? width? />`.
  - `config.ts`: `LIBRECHAT_URL`.
  - Test utils: `createFakeStore(initial?) -> { store, update }`, `mockApi(routes)`, `ok(data)`, `fail(status, error)`, fixtures `SUMMARIES`, `DETAIL`.

- [ ] **Step 1: Create the package**

```bash
mkdir -p chart-gallery/web && cd chart-gallery/web
npm init -y
npm pkg set name=chart-gallery-web private=true type=module
npm pkg delete main scripts.test keywords author license description version
npm pkg set scripts.dev="vite" scripts.build="tsc --noEmit && vite build" scripts.typecheck="tsc --noEmit" \
  scripts.test="vitest run" scripts.coverage="vitest run --coverage" \
  scripts.fetch-model="node scripts/fetch-model.mjs public" scripts.e2e="playwright test"
npm install react react-dom react-router recharts @huggingface/transformers
npm install --save-exact semantic-state@0.1.0-experimental.1
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node \
  vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @playwright/test
```

`chart-gallery/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`chart-gallery/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3090' } },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/semantic/charts.worker.ts', 'src/semantic/store.ts', 'src/test/**', 'src/**/*.test.*'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
```

- [ ] **Step 2: Write shared types, config, styles and test utilities**

`src/types.ts`:

```ts
export type ChartType = 'line' | 'bar' | 'pie'

export interface ChartSummary {
  readonly id: number
  readonly title: string
  readonly description: string
  readonly chart_type: ChartType
  readonly tables: readonly string[]
  readonly updated_at: string
}

export interface ChartDetail extends ChartSummary {
  readonly x_field: string
  readonly y_fields: readonly string[]
  readonly sql: string
  readonly rows: readonly Record<string, unknown>[]
  readonly created_at: string
}
```

`src/config.ts`:

```ts
export const LIBRECHAT_URL: string = import.meta.env.VITE_LIBRECHAT_URL ?? 'http://localhost:3080'
```

`src/styles.css` (colour tokens from the dataviz reference palette; dark values under both the media query and the `data-theme` scope):

```css
:root {
  color-scheme: light;
  --surface-0: #f5f5f3;
  --surface-1: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --border: #e2e1dc;
  --accent: #2a78d6;
  --danger: #b42318;
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
  --series-5: #e87ba4;
  --series-6: #008300;
  --series-7: #4a3aa7;
  --series-8: #e34948;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --surface-0: #111110;
    --surface-1: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --border: #33322f;
    --accent: #3987e5;
    --danger: #f97066;
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --series-5: #d55181;
    --series-6: #008300;
    --series-7: #9085e9;
    --series-8: #e66767;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --surface-0: #111110;
  --surface-1: #1a1a19;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --border: #33322f;
  --accent: #3987e5;
  --danger: #f97066;
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --series-4: #c98500;
  --series-5: #d55181;
  --series-6: #008300;
  --series-7: #9085e9;
  --series-8: #e66767;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-0); color: var(--text-primary); font: 15px/1.5 system-ui, sans-serif; }
a { color: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--surface-1); }
.brand { font-weight: 600; color: var(--text-primary); text-decoration: none; }
.content { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.toolbar input { width: min(420px, 100%); padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-1); color: var(--text-primary); }
.count, .status { color: var(--text-secondary); }
.status.error { color: var(--danger); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.card { display: block; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-1); color: inherit; text-decoration: none; }
.card:hover, .card:focus-visible { border-color: var(--accent); }
.card-meta { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 13px; }
.card-title { font-size: 16px; margin: 6px 0 4px; }
.card-desc { margin: 0 0 8px; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.badge { text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; padding: 0; margin: 0; }
.chips code { padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; }
.detail h1 { margin: 8px 0 4px; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; color: var(--text-secondary); margin-bottom: 16px; }
.chart-frame { margin: 0 0 16px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-1); }
details { margin: 8px 0; }
pre { overflow-x: auto; padding: 12px; background: var(--surface-1); border: 1px solid var(--border); border-radius: 6px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.related { margin-top: 32px; }
.related ul { list-style: none; padding: 0; display: grid; gap: 8px; }
.related a { display: block; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-1); text-decoration: none; color: var(--text-primary); }
.related .reason { display: block; color: var(--text-secondary); font-size: 13px; }
.refining { margin-left: 8px; color: var(--text-secondary); font-size: 13px; font-weight: normal; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
```

`src/test/fakeStore.ts`:

```ts
import type { SemanticSnapshot, SemanticStore } from 'semantic-state'
import { vi } from 'vitest'
import type { ChartSummary } from '../types'

export function createFakeStore(initial: Partial<SemanticSnapshot<ChartSummary>> = {}) {
  let snapshot: SemanticSnapshot<ChartSummary> = {
    status: 'ready',
    error: null,
    model: { status: 'ready', progress: 1, error: null },
    embedding: null,
    results: {},
    similar: {},
    weights: { text: 1, tables: 0.15 },
    lastEmbedMs: null,
    ...initial,
  }
  const listeners = new Set<() => void>()
  const store = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    upsert: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    interact: vi.fn(),
    forget: vi.fn(),
    clearInterests: vi.fn(),
    watch: vi.fn(() => () => {}),
    setWeights: vi.fn(),
    requestSimilar: vi.fn(),
    onEmbedded: vi.fn(() => () => {}),
    onQueryEmbedded: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } satisfies SemanticStore<ChartSummary>
  const update = (patch: Partial<SemanticSnapshot<ChartSummary>>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  return { store, update }
}
```

`src/test/mockApi.ts`:

```ts
import { vi } from 'vitest'

type Route = { readonly status?: number; readonly body: unknown } | { readonly raw: string; readonly status: number } | 'network-error'

export const ok = <T,>(data: T): Route => ({ body: { success: true, data, error: null } })
export const fail = (status: number, error: string): Route => ({ status, body: { success: false, data: null, error } })

export function mockApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)]
    if (route === undefined) throw new Error(`unmocked request: ${String(input)}`)
    if (route === 'network-error') throw new TypeError('Failed to fetch')
    if ('raw' in route) return new Response(route.raw, { status: route.status })
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
```

`src/test/fixtures.ts`:

```ts
import type { ChartDetail, ChartSummary } from '../types'

export const SUMMARIES: ChartSummary[] = [
  { id: 1, title: 'Revenue by store', description: 'Completed revenue for each store.', chart_type: 'bar', tables: ['orders', 'stores'], updated_at: '2026-10-16T10:00:00+00:00' },
  { id: 2, title: 'Return rate by store', description: 'Share of orders returned per store.', chart_type: 'bar', tables: ['returns', 'stores'], updated_at: '2026-10-16T09:00:00+00:00' },
  { id: 3, title: 'Customers by loyalty tier', description: 'Customer count in each loyalty tier.', chart_type: 'pie', tables: ['customers'], updated_at: '2026-10-15T09:00:00+00:00' },
]

export const DETAIL: ChartDetail = {
  ...SUMMARIES[1],
  x_field: 'store_name',
  y_fields: ['return_rate'],
  sql: 'SELECT s.store_name, AVG(r.rate) AS return_rate FROM stores s JOIN returns r ON r.store_id = s.store_id GROUP BY 1',
  rows: [
    { store_name: 'Central', return_rate: 0.12 },
    { store_name: 'Kowloon', return_rate: null },
  ],
  created_at: '2026-10-16T09:00:00+00:00',
}
```

- [ ] **Step 3: Write the failing tests**

`src/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError, fetchChart, fetchCharts } from './api'
import { DETAIL, SUMMARIES } from './test/fixtures'
import { fail, mockApi, ok } from './test/mockApi'

describe('api', () => {
  it('returns the list data', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    await expect(fetchCharts()).resolves.toEqual(SUMMARIES)
  })

  it('returns one chart', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL) })
    await expect(fetchChart(2)).resolves.toEqual(DETAIL)
  })

  it('raises the envelope error with its status', async () => {
    mockApi({ '/api/charts/9': fail(404, 'chart not found') })
    await expect(fetchChart(9)).rejects.toEqual(new ApiError('chart not found', 404))
    await expect(fetchChart(9)).rejects.toMatchObject({ status: 404 })
  })

  it('explains a network failure', async () => {
    mockApi({ '/api/charts': 'network-error' })
    await expect(fetchCharts()).rejects.toMatchObject({ message: 'Chart gallery API is unreachable', status: 0 })
  })

  it('handles a non-JSON error page', async () => {
    mockApi({ '/api/charts': { raw: '<html>bad gateway</html>', status: 502 } })
    await expect(fetchCharts()).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 })
  })
})
```

`src/components/chartData.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { foldPieRows, seriesColor } from './chartData'

describe('seriesColor', () => {
  it('maps slots in fixed order', () => {
    expect(seriesColor(0)).toBe('var(--series-1)')
    expect(seriesColor(7)).toBe('var(--series-8)')
  })

  it('refuses to cycle past the palette', () => {
    expect(() => seriesColor(8)).toThrow('no colour slot 9')
  })
})

describe('foldPieRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ tier: `t${i}`, n: i + 1 }))

  it('keeps small inputs unchanged', () => {
    expect(foldPieRows(rows(8), 'tier', 'n')).toEqual(rows(8))
  })

  it('folds the smallest slices into Other', () => {
    const folded = foldPieRows(rows(10), 'tier', 'n')
    expect(folded).toHaveLength(8)
    expect(folded.slice(0, 7).map((r) => r.tier)).toEqual(['t9', 't8', 't7', 't6', 't5', 't4', 't3'])
    expect(folded[7]).toEqual({ tier: 'Other', n: 1 + 2 + 3 })
  })

  it('treats null values as zero', () => {
    const input = [...rows(8), { tier: 'none', n: null }]
    // values 1..8 plus null: keep 8..2, fold t0 (1) and the null (0)
    expect(foldPieRows(input, 'tier', 'n').at(-1)).toEqual({ tier: 'Other', n: 1 })
  })
})
```

`src/components/ChartView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartView, type ChartSpec } from './ChartView'

const months = [
  { month: '2026-01-01T00:00:00', revenue: 10, orders: 3 },
  { month: '2026-02-01T00:00:00', revenue: null, orders: 4 },
  { month: '2026-03-01T00:00:00', revenue: 12, orders: null },
]

function draw(chart: ChartSpec) {
  return render(<ChartView chart={chart} width={600} height={300} />)
}

describe('ChartView', () => {
  it('renders a line chart with null values and a legend for two series', () => {
    const { container } = draw({ chart_type: 'line', x_field: 'month', y_fields: ['revenue', 'orders'], rows: months })
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
    expect(screen.getByText('revenue')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
  })

  it('renders a single-series bar chart without a legend', () => {
    const { container } = draw({
      chart_type: 'bar',
      x_field: 'store',
      y_fields: ['revenue'],
      rows: [{ store: 'Central', revenue: 5 }, { store: 'Kowloon', revenue: 7 }],
    })
    expect(container.querySelector('.recharts-bar')).not.toBeNull()
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull()
  })

  it('renders a pie with one sector per row', () => {
    const { container } = draw({
      chart_type: 'pie',
      x_field: 'tier',
      y_fields: ['customers'],
      rows: [{ tier: 'gold', customers: 5 }, { tier: 'silver', customers: 7 }, { tier: 'bronze', customers: 9 }],
    })
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3)
  })
})
```

(If a recharts class name differs in the installed version, print `container.innerHTML` once and use the equivalent class; keep the asserted behaviour the same.)

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd chart-gallery/web && npx vitest run`
Expected: FAIL — cannot resolve `./api`, `./chartData`, `./ChartView`.

- [ ] **Step 5: Implement API client, request hook and chart hooks**

`src/api.ts`:

```ts
import type { ChartDetail, ChartSummary } from './types'

interface Envelope<T> {
  readonly success: boolean
  readonly data: T | null
  readonly error: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path)
  } catch {
    throw new ApiError('Chart gallery API is unreachable', 0)
  }
  let body: Envelope<T> | null = null
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    body = null
  }
  if (!response.ok || !body?.success || body.data === null) {
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }
  return body.data
}

export const fetchCharts = () => getJson<ChartSummary[]>('/api/charts')
export const fetchChart = (id: number) => getJson<ChartDetail>(`/api/charts/${id}`)
```

`src/useRequest.ts`:

```ts
import { type DependencyList, useEffect, useState } from 'react'
import { ApiError } from './api'

export type RequestState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: ApiError }

export function useRequest<T>(load: () => Promise<T>, deps: DependencyList): RequestState<T> {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' })
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    load().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) =>
        active && setState({ status: 'error', error: error instanceof ApiError ? error : new ApiError(String(error), 0) }),
    )
    return () => {
      active = false
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
```

`src/charts.ts`:

```ts
import { useSemanticStore } from 'semantic-state/react'
import { fetchChart, fetchCharts } from './api'
import type { ChartDetail, ChartSummary } from './types'
import { type RequestState, useRequest } from './useRequest'

/** Loads every chart summary and hands them to the semantic store before anything renders them. */
export function useChartList(): RequestState<ChartSummary[]> {
  const store = useSemanticStore<ChartSummary>()
  return useRequest(
    () =>
      fetchCharts().then((charts) => {
        store.upsert(charts)
        return charts
      }),
    [store],
  )
}

export function useChart(id: number): RequestState<ChartDetail> {
  return useRequest(() => fetchChart(id), [id])
}
```

- [ ] **Step 6: Implement chart data helpers and ChartView**

`src/components/chartData.ts`:

```ts
export const SERIES_COUNT = 8

/** Categorical colour for series/slice `index`, in the palette's fixed order. Never cycles. */
export function seriesColor(index: number): string {
  if (index < 0 || index >= SERIES_COUNT) throw new Error(`no colour slot ${index + 1}`)
  return `var(--series-${index + 1})`
}

type Row = Readonly<Record<string, unknown>>

const valueOf = (row: Row, field: string) => (typeof row[field] === 'number' ? (row[field] as number) : 0)

/** Keeps a pie to `max` slices: the largest `max - 1` plus "Other" holding the rest. */
export function foldPieRows(rows: readonly Row[], xField: string, yField: string, max = SERIES_COUNT): Row[] {
  if (rows.length <= max) return [...rows]
  const sorted = [...rows].sort((a, b) => valueOf(b, yField) - valueOf(a, yField))
  const kept = sorted.slice(0, max - 1)
  const rest = sorted.slice(max - 1).reduce((sum, row) => sum + valueOf(row, yField), 0)
  return [...kept, { [xField]: 'Other', [yField]: rest }]
}
```

`src/components/ChartView.tsx`:

```tsx
import type { ReactElement } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartDetail } from '../types'
import { foldPieRows, seriesColor } from './chartData'

export type ChartSpec = Pick<ChartDetail, 'chart_type' | 'x_field' | 'y_fields' | 'rows'>

interface Props {
  readonly chart: ChartSpec
  readonly height?: number
  /** Fixed width instead of filling the parent (used by tests). */
  readonly width?: number
}

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 12 }
const TOOLTIP_STYLE = { background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

export function ChartView({ chart, height = 320, width }: Props) {
  const plot = renderPlot(chart, width === undefined ? {} : { width, height })
  if (width !== undefined) return plot
  return (
    <ResponsiveContainer width="100%" height={height}>
      {plot}
    </ResponsiveContainer>
  )
}

function renderPlot(chart: ChartSpec, size: { width?: number; height?: number }): ReactElement {
  const { chart_type, x_field, y_fields } = chart
  const rows = chart.rows as Record<string, unknown>[]
  const showLegend = y_fields.length > 1

  if (chart_type === 'pie') {
    const data = foldPieRows(rows, x_field, y_fields[0])
    return (
      <PieChart {...size}>
        <Pie data={data} dataKey={y_fields[0]} nameKey={x_field} isAnimationActive={false} stroke="var(--surface-1)" strokeWidth={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={seriesColor(i)} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
      </PieChart>
    )
  }

  const axes = [
    <CartesianGrid key="grid" stroke="var(--border)" vertical={false} />,
    <XAxis key="x" dataKey={x_field} tick={AXIS_TICK} />,
    <YAxis key="y" tick={AXIS_TICK} />,
    <Tooltip key="tip" contentStyle={TOOLTIP_STYLE} />,
    showLegend ? <Legend key="legend" /> : null,
  ]

  if (chart_type === 'line') {
    return (
      <LineChart data={rows} {...size}>
        {axes}
        {y_fields.map((field, i) => (
          <Line key={field} dataKey={field} name={field} stroke={seriesColor(i)} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    )
  }

  return (
    <BarChart data={rows} {...size}>
      {axes}
      {y_fields.map((field, i) => (
        <Bar key={field} dataKey={field} name={field} fill={seriesColor(i)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd chart-gallery/web && npx vitest run && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add chart-gallery/web
git commit -m "feat: scaffold chart gallery web app with chart rendering"
```

---

### Task 6: Related-charts ranking with semantic-state

**Files:**
- Create: `src/semantic/model.json`, `src/semantic/features.ts`, `src/semantic/failOnce.ts`, `src/semantic/charts.worker.ts`, `src/semantic/store.ts`, `src/semantic/useRelatedCharts.ts`, `src/semantic/RelatedCharts.tsx` (all under `chart-gallery/web/`)
- Test: `src/semantic/features.test.ts`, `src/semantic/failOnce.test.ts`, `src/semantic/useRelatedCharts.test.tsx`, `src/semantic/RelatedCharts.test.tsx`

**Interfaces:**
- Consumes: `ChartSummary` (Task 5); `createFakeStore`, `SUMMARIES` (Task 5); semantic-state APIs — `createSemanticStore`, `SemanticStore`, `SemanticSnapshot`, `ModelState`, `ResultRow`, `FeatureVectors`, `Id`, `similarKey` from `semantic-state`; `SemanticProvider`, `useSemanticStore`, `useSemanticSnapshot`, `useSimilar(id, k)` from `semantic-state/react`; `defineSemanticWorker`, `Embedder` from `semantic-state/worker`; `transformersEmbedder({ model })` from `semantic-state/transformers`.
- Produces:
  - `features.ts`: `TABLE_WEIGHT = 0.15`, `RELATED_COUNT = 5`, `EMBED_MODEL: string` (from `model.json`), `chartText(c)`, `tableFeatures(items): ReadonlyMap<Id, FeatureVectors>`, `sharedTables(a, b): string[]`.
  - `failOnce(inner: Embedder): Embedder`.
  - `store.ts`: `chartStore: SemanticStore<ChartSummary>`.
  - `useRelatedCharts.ts`: `isRefining(snapshot): boolean`, `useRelatedCharts(id, k = RELATED_COUNT) -> { rows: readonly ResultRow<ChartSummary>[] | null; refining: boolean; modelStatus: ModelState['status'] }`.
  - `RelatedCharts.tsx`: `relatedReason(current, other, topicReady): string`, `<RelatedCharts current rows refining modelStatus />` rendering `<section aria-labelledby="related-heading" data-model-status=…>`.
  - `model.json` shape `{ "id": string, "files": string[] }`, also read by `scripts/fetch-model.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

`src/semantic/features.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import type { ChartSummary } from '../types'
import { chartText, sharedTables, tableFeatures } from './features'

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * b[i], 0)

describe('features', () => {
  it('embeds title and description', () => {
    expect(chartText(SUMMARIES[0])).toBe('Revenue by store. Completed revenue for each store.')
  })

  it('builds unit-length table vectors over one shared vocabulary', () => {
    const vectors = tableFeatures(SUMMARIES)
    const a = vectors.get(1)!.tables
    const b = vectors.get(2)!.tables
    expect(a).toHaveLength(4) // customers, orders, returns, stores
    expect(b).toHaveLength(4)
    expect(dot(a, a)).toBeCloseTo(1)
    expect(dot(a, b)).toBeCloseTo(0.5) // share "stores": 1 / sqrt(2 * 2)
    expect(dot(a, vectors.get(3)!.tables)).toBeCloseTo(0)
  })

  it('omits charts without tables', () => {
    const noTables: ChartSummary = { ...SUMMARIES[0], id: 9, tables: [] }
    expect(tableFeatures([noTables, SUMMARIES[0]]).has(9)).toBe(false)
  })

  it('lists shared tables in the other chart order', () => {
    expect(sharedTables(SUMMARIES[0], SUMMARIES[1])).toEqual(['stores'])
    expect(sharedTables(SUMMARIES[0], SUMMARIES[2])).toEqual([])
  })
})
```

`src/semantic/failOnce.test.ts`:

```ts
import type { Embedder } from 'semantic-state/worker'
import { describe, expect, it, vi } from 'vitest'
import { failOnce } from './failOnce'

describe('failOnce', () => {
  it('passes results through', async () => {
    const inner: Embedder = { embed: vi.fn(async () => [new Float32Array([1])]) }
    await expect(failOnce(inner).embed(['a'], () => {})).resolves.toEqual([new Float32Array([1])])
  })

  it('never calls the inner embedder again after a failure', async () => {
    const inner: Embedder = { embed: vi.fn(async () => Promise.reject(new Error('model blocked'))) }
    const embedder = failOnce(inner)
    await expect(embedder.embed(['a'], () => {})).rejects.toThrow('model blocked')
    await expect(embedder.embed(['b'], () => {})).rejects.toThrow('model blocked')
    expect(inner.embed).toHaveBeenCalledTimes(1)
  })
})
```

`src/semantic/useRelatedCharts.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SemanticProvider } from 'semantic-state/react'
import { describe, expect, it } from 'vitest'
import { createFakeStore } from '../test/fakeStore'
import { isRefining, useRelatedCharts } from './useRelatedCharts'

const model = (status: 'idle' | 'loading' | 'ready' | 'error') => ({ status, progress: 0, error: null })

describe('isRefining', () => {
  it.each([
    ['idle', null, true],
    ['loading', null, true],
    ['ready', { done: 1, total: 3 }, true],
    ['ready', null, false],
    ['error', null, false],
  ] as const)('model %s, embedding %o → %s', (status, embedding, expected) => {
    expect(isRefining({ model: model(status), embedding })).toBe(expected)
  })
})

describe('useRelatedCharts', () => {
  it('asks again for neighbours once embeddings are ready', () => {
    const { store, update } = createFakeStore({ model: model('loading'), embedding: { done: 0, total: 3 } })
    const wrapper = ({ children }: { children: ReactNode }) => <SemanticProvider store={store}>{children}</SemanticProvider>
    const { result } = renderHook(() => useRelatedCharts(2), { wrapper })
    expect(result.current.refining).toBe(true)
    const callsWhileRefining = store.requestSimilar.mock.calls.length

    act(() => update({ model: model('ready'), embedding: null }))

    expect(result.current.refining).toBe(false)
    expect(result.current.modelStatus).toBe('ready')
    expect(store.requestSimilar.mock.calls.length).toBe(callsWhileRefining + 1)
    expect(store.requestSimilar).toHaveBeenLastCalledWith(2, 5)
  })
})
```

`src/semantic/RelatedCharts.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ResultRow } from 'semantic-state'
import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import type { ChartSummary } from '../types'
import { RelatedCharts, relatedReason } from './RelatedCharts'

const row = (item: ChartSummary, score: number): ResultRow<ChartSummary> => ({
  id: item.id,
  item,
  score,
  confidence: score,
  reason: { kind: 'interest', becauseOf: 2 },
})

function show(rows: readonly ResultRow<ChartSummary>[] | null, refining = false) {
  return render(
    <MemoryRouter>
      <RelatedCharts current={SUMMARIES[1]} rows={rows} refining={refining} modelStatus={refining ? 'loading' : 'ready'} />
    </MemoryRouter>,
  )
}

describe('relatedReason', () => {
  it('combines topic and shared tables', () => {
    expect(relatedReason(SUMMARIES[1], SUMMARIES[0], true)).toBe('similar topic · shares stores')
    expect(relatedReason(SUMMARIES[1], SUMMARIES[0], false)).toBe('shares stores')
    expect(relatedReason(SUMMARIES[1], SUMMARIES[2], true)).toBe('similar topic')
  })
})

describe('RelatedCharts', () => {
  it('shows a placeholder before the first result', () => {
    show(null, true)
    expect(screen.getByText('Finding related charts…')).toBeInTheDocument()
  })

  it('shows an empty message when nothing scores above zero', () => {
    show([row(SUMMARIES[2], 0)])
    expect(screen.getByText('No related charts yet.')).toBeInTheDocument()
  })

  it('links to each related chart with its reason', () => {
    show([row(SUMMARIES[0], 0.8)])
    const region = screen.getByRole('region', { name: 'Related charts' })
    expect(region).toHaveAttribute('data-model-status', 'ready')
    const link = within(region).getByRole('link', { name: /Revenue by store/ })
    expect(link).toHaveAttribute('href', '/charts/1')
    expect(within(link).getByText('similar topic · shares stores')).toBeInTheDocument()
  })

  it('labels a table-only ranking as refining', () => {
    show([row(SUMMARIES[0], 0.5)], true)
    expect(screen.getByText('refining…')).toBeInTheDocument()
    expect(screen.getByText('shares stores')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd chart-gallery/web && npx vitest run src/semantic`
Expected: FAIL — cannot resolve `./features`, `./failOnce`, `./useRelatedCharts`, `./RelatedCharts`.

- [ ] **Step 3: Implement features and failOnce**

`src/semantic/model.json`:

```json
{
  "id": "Xenova/all-MiniLM-L6-v2",
  "files": ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
}
```

`src/semantic/features.ts`:

```ts
import type { FeatureVectors, Id } from 'semantic-state'
import type { ChartSummary } from '../types'
import model from './model.json'

/** Weight of shared warehouse tables relative to the title+description embedding (weight 1). */
export const TABLE_WEIGHT = 0.15
export const RELATED_COUNT = 5
export const EMBED_MODEL: string = model.id

export const chartText = (chart: ChartSummary) => `${chart.title}. ${chart.description}`

/** One-hot, unit-length vector of each chart's tables over every table name in the set. */
export function tableFeatures(items: readonly ChartSummary[]): ReadonlyMap<Id, FeatureVectors> {
  const vocabulary = [...new Set(items.flatMap((chart) => chart.tables))].sort()
  const position = new Map(vocabulary.map((table, i) => [table, i]))
  const out = new Map<Id, FeatureVectors>()
  for (const chart of items) {
    if (chart.tables.length === 0) continue
    const vector = new Float32Array(vocabulary.length)
    const weight = 1 / Math.sqrt(chart.tables.length)
    for (const table of chart.tables) vector[position.get(table)!] = weight
    out.set(chart.id, { tables: vector })
  }
  return out
}

export function sharedTables(current: ChartSummary, other: ChartSummary): string[] {
  const mine = new Set(current.tables)
  return other.tables.filter((table) => mine.has(table))
}
```

`src/semantic/failOnce.ts`:

```ts
import type { Embedder } from 'semantic-state/worker'

/**
 * After the first failure (e.g. model files missing), every later call fails at once.
 * semantic-state's transformers embedder would otherwise retry the download on the next batch.
 */
export function failOnce(inner: Embedder): Embedder {
  let failure: unknown = null
  return {
    async embed(texts, onProgress) {
      if (failure !== null) throw failure
      try {
        return await inner.embed(texts, onProgress)
      } catch (error) {
        failure = error
        throw error
      }
    },
  }
}
```

- [ ] **Step 4: Implement the worker and store**

`src/semantic/charts.worker.ts`:

```ts
import { env } from '@huggingface/transformers'
import { transformersEmbedder } from 'semantic-state/transformers'
import { defineSemanticWorker } from 'semantic-state/worker'
import type { ChartSummary } from '../types'
import { failOnce } from './failOnce'
import { EMBED_MODEL, TABLE_WEIGHT, chartText, tableFeatures } from './features'

// The gallery serves the model and the onnxruntime wasm itself: no request leaves for a CDN.
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
const wasm = env.backends.onnx.wasm
if (wasm) wasm.wasmPaths = '/ort/'

defineSemanticWorker<ChartSummary>({
  id: (chart) => chart.id,
  text: chartText,
  embedder: failOnce(transformersEmbedder({ model: EMBED_MODEL })),
  features: tableFeatures,
  weights: { text: 1, tables: TABLE_WEIGHT },
  interests: { mode: 'multi' },
})
```

`src/semantic/store.ts`:

```ts
import { createSemanticStore } from 'semantic-state'
import type { ChartSummary } from '../types'

export const chartStore = createSemanticStore<ChartSummary>(
  new Worker(new URL('./charts.worker.ts', import.meta.url), { type: 'module' }),
)
```

- [ ] **Step 5: Implement the hook and component**

`src/semantic/useRelatedCharts.ts`:

```ts
import { useEffect } from 'react'
import type { ModelState, ResultRow, SemanticSnapshot } from 'semantic-state'
import { useSemanticSnapshot, useSemanticStore, useSimilar } from 'semantic-state/react'
import type { ChartSummary } from '../types'
import { RELATED_COUNT } from './features'

/** True while the ranking may still change: model loading or items still being embedded. */
export function isRefining(snapshot: Pick<SemanticSnapshot<unknown>, 'model' | 'embedding'>): boolean {
  if (snapshot.model.status === 'error') return false
  return snapshot.model.status !== 'ready' || snapshot.embedding !== null
}

export interface RelatedState {
  readonly rows: readonly ResultRow<ChartSummary>[] | null
  readonly refining: boolean
  readonly modelStatus: ModelState['status']
}

/**
 * Neighbours of one chart. Until embeddings exist, items carry only the `tables` feature, so the
 * same request ranks by table overlap. useSimilar does not re-request when embedding finishes, so ask again.
 */
export function useRelatedCharts(id: number, k = RELATED_COUNT): RelatedState {
  const store = useSemanticStore<ChartSummary>()
  const snapshot = useSemanticSnapshot<ChartSummary>()
  const rows = useSimilar<ChartSummary>(id, k)
  const refining = isRefining(snapshot)
  const ready = snapshot.status === 'ready'
  useEffect(() => {
    if (ready && !refining) store.requestSimilar(id, k)
  }, [store, id, k, ready, refining])
  return { rows, refining, modelStatus: snapshot.model.status }
}
```

`src/semantic/RelatedCharts.tsx`:

```tsx
import { Link } from 'react-router'
import type { ModelState, ResultRow } from 'semantic-state'
import type { ChartSummary } from '../types'
import { sharedTables } from './features'

export function relatedReason(current: ChartSummary, other: ChartSummary, topicReady: boolean): string {
  const shared = sharedTables(current, other)
  return [topicReady ? 'similar topic' : null, shared.length > 0 ? `shares ${shared.join(', ')}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

interface Props {
  readonly current: ChartSummary
  readonly rows: readonly ResultRow<ChartSummary>[] | null
  readonly refining: boolean
  readonly modelStatus: ModelState['status']
}

export function RelatedCharts({ current, rows, refining, modelStatus }: Props) {
  const topicReady = modelStatus === 'ready' && !refining
  const visible = (rows ?? []).filter((row) => row.score > 0)
  return (
    <section className="related" aria-labelledby="related-heading" aria-busy={refining} data-model-status={modelStatus}>
      <h2 id="related-heading">
        Related charts
        {refining && <span className="refining">refining…</span>}
      </h2>
      {rows === null ? (
        <p className="status">Finding related charts…</p>
      ) : visible.length === 0 ? (
        <p className="status">No related charts yet.</p>
      ) : (
        <ul>
          {visible.map(({ item }) => (
            <li key={item.id}>
              <Link to={`/charts/${item.id}`}>
                {item.title}
                <span className="reason">{relatedReason(current, item, topicReady)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

(The heading's accessible name includes "refining…" while refining; the E2E test only queries the region once refining is done. If `getByRole('region', { name: 'Related charts' })` fails in the unit test because of that, give the `<h2>` text its own `<span id="related-heading">Related charts</span>` and point `aria-labelledby` at the span.)

- [ ] **Step 6: Run tests, coverage and typecheck**

Run: `cd chart-gallery/web && npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add chart-gallery/web/src/semantic
git commit -m "feat: rank related charts with semantic-state"
```

---

### Task 7: List and detail pages

**Files:**
- Create: `chart-gallery/web/index.html`, `src/main.tsx`, `src/App.tsx`, `src/filter.ts`, `src/time.ts`, `src/components/ChartCard.tsx`, `src/components/DataTable.tsx`, `src/pages/ListPage.tsx`, `src/pages/DetailPage.tsx`, `src/pages/NotFound.tsx`, `src/test/renderApp.tsx` (all under `chart-gallery/web/`)
- Test: `src/filter.test.ts`, `src/time.test.ts`, `src/pages/ListPage.test.tsx`, `src/pages/DetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`useChartList`, `useChart`, `ChartView`, `LIBRECHAT_URL`, test utils, fixtures); Task 6 (`useRelatedCharts`, `RelatedCharts`, `RELATED_COUNT`, `chartStore`).
- Produces: `filterCharts(charts, query)`, `relativeTime(iso, now?)`, `parseChartId(raw)`, `AppRoutes`, `App({ store })`, `renderApp(path, store?)`.

- [ ] **Step 1: Write the failing tests**

`src/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterCharts } from './filter'
import { SUMMARIES } from './test/fixtures'

describe('filterCharts', () => {
  it('returns everything for a blank query', () => {
    expect(filterCharts(SUMMARIES, '   ')).toEqual(SUMMARIES)
  })

  it('matches title or description, case-insensitively', () => {
    expect(filterCharts(SUMMARIES, 'RETURN').map((c) => c.id)).toEqual([2])
    expect(filterCharts(SUMMARIES, 'loyalty tier').map((c) => c.id)).toEqual([3])
    expect(filterCharts(SUMMARIES, 'store').map((c) => c.id)).toEqual([1, 2])
  })
})
```

`src/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { relativeTime } from './time'

const now = new Date('2026-10-16T12:00:00Z')

describe('relativeTime', () => {
  it.each([
    ['2026-10-16T11:59:40Z', 'just now'],
    ['2026-10-16T10:00:00Z', '2 hours ago'],
    ['2026-10-15T12:00:00Z', 'yesterday'],
    ['2026-08-16T12:00:00Z', '2 months ago'],
    ['not a date', ''],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected)
  })
})
```

`src/test/renderApp.tsx`:

```tsx
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SemanticProvider } from 'semantic-state/react'
import { AppRoutes } from '../App'
import { createFakeStore } from './fakeStore'

export function renderApp(path: string, store = createFakeStore().store) {
  return {
    store,
    ...render(
      <SemanticProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SemanticProvider>,
    ),
  }
}
```

`src/pages/ListPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import { fail, mockApi, ok } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

describe('ListPage', () => {
  it('lists charts and hands them to the semantic store', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    const { store } = renderApp('/')
    expect(await screen.findByRole('link', { name: /Revenue by store/ })).toHaveAttribute('href', '/charts/1')
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(store.upsert).toHaveBeenCalledWith(SUMMARIES)
  })

  it('filters by title and description', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    renderApp('/')
    await userEvent.type(await screen.findByRole('searchbox'), 'loyalty')
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Revenue by store/ })).toBeNull()
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No charts match “zzz”.')).toBeInTheDocument()
  })

  it('explains how to create the first chart', async () => {
    mockApi({ '/api/charts': ok([]) })
    renderApp('/')
    expect(await screen.findByText(/No charts yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open LibreChat' })).toHaveAttribute('href', 'http://localhost:3080')
  })

  it('shows an alert when the API is unreachable', async () => {
    mockApi({ '/api/charts': 'network-error' })
    renderApp('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load charts: Chart gallery API is unreachable')
  })

  it('shows an alert for an API error', async () => {
    mockApi({ '/api/charts': fail(503, 'database unavailable') })
    renderApp('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable')
  })

  it('renders hostile titles as text', async () => {
    const hostile = { ...SUMMARIES[0], title: '<img src=x onerror=alert(1)>', description: '<script>alert(2)</script>' }
    mockApi({ '/api/charts': ok([hostile]) })
    const { container } = renderApp('/')
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
```

`src/pages/DetailPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import { similarKey } from 'semantic-state'
import { describe, expect, it } from 'vitest'
import { DETAIL, SUMMARIES } from '../test/fixtures'
import { createFakeStore } from '../test/fakeStore'
import { fail, mockApi, ok } from '../test/mockApi'
import { renderApp } from '../test/renderApp'
import { parseChartId } from './DetailPage'

describe('parseChartId', () => {
  it.each([
    ['2', 2],
    ['abc', null],
    ['0', null],
    ['-1', null],
    ['1.5', null],
    [undefined, null],
  ])('%s → %s', (raw, expected) => {
    expect(parseChartId(raw)).toBe(expected)
  })
})

describe('DetailPage', () => {
  it('shows the chart, its SQL, data table and related charts', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL), '/api/charts': ok(SUMMARIES) })
    const { store } = createFakeStore({
      similar: {
        [similarKey(2, 5)]: [
          { id: 1, item: SUMMARIES[0], score: 0.8, confidence: 0.8, reason: { kind: 'interest', becauseOf: 2 } },
        ],
      },
    })
    renderApp('/charts/2', store)
    expect(await screen.findByRole('heading', { level: 1, name: 'Return rate by store' })).toBeInTheDocument()
    expect(screen.getByText(DETAIL.sql)).toBeInTheDocument()
    const related = await screen.findByRole('region', { name: 'Related charts' })
    expect(within(related).getByRole('link', { name: /Revenue by store/ })).toHaveAttribute('href', '/charts/1')
  })

  it('shows a dash for null cells', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL), '/api/charts': ok(SUMMARIES) })
    renderApp('/charts/2')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('—')).toBeInTheDocument()
    expect(within(table).getByText('0.12')).toBeInTheDocument()
  })

  it('shows not found for a bad id without calling the API', () => {
    const fetchMock = mockApi({})
    renderApp('/charts/abc')
    expect(screen.getByRole('heading', { name: 'Chart not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows not found for a missing chart', async () => {
    mockApi({ '/api/charts/9': fail(404, 'chart not found') })
    renderApp('/charts/9')
    expect(await screen.findByRole('heading', { name: 'Chart not found' })).toBeInTheDocument()
  })

  it('shows an alert for other errors', async () => {
    mockApi({ '/api/charts/2': fail(500, 'boom') })
    renderApp('/charts/2')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load chart: boom')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd chart-gallery/web && npx vitest run src/filter.test.ts src/time.test.ts src/pages`
Expected: FAIL — cannot resolve `./filter`, `./time`, `../App`, `./DetailPage`.

- [ ] **Step 3: Implement helpers**

`src/filter.ts`:

```ts
import type { ChartSummary } from './types'

export function filterCharts(charts: readonly ChartSummary[], query: string): ChartSummary[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...charts]
  return charts.filter((chart) => `${chart.title}\n${chart.description}`.toLowerCase().includes(needle))
}
```

`src/time.ts`:

```ts
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
const FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000)
  if (Number.isNaN(seconds)) return ''
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return FORMAT.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}
```

- [ ] **Step 4: Implement components and pages**

`src/components/ChartCard.tsx`:

```tsx
import { Link } from 'react-router'
import { relativeTime } from '../time'
import type { ChartSummary } from '../types'

export function TableChips({ tables }: { readonly tables: readonly string[] }) {
  if (tables.length === 0) return null
  return (
    <ul className="chips" aria-label="Tables">
      {tables.map((table) => (
        <li key={table}>
          <code>{table}</code>
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({ chart }: { readonly chart: ChartSummary }) {
  return (
    <Link to={`/charts/${chart.id}`} className="card">
      <span className="card-meta">
        <span className="badge">{chart.chart_type}</span>
        <time dateTime={chart.updated_at}>{relativeTime(chart.updated_at)}</time>
      </span>
      <h2 className="card-title">{chart.title}</h2>
      <p className="card-desc">{chart.description}</p>
      <TableChips tables={chart.tables} />
    </Link>
  )
}
```

`src/components/DataTable.tsx`:

```tsx
import type { ChartDetail } from '../types'

const formatCell = (value: unknown) =>
  value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('en') : String(value)

export function DataTable({ chart }: { readonly chart: Pick<ChartDetail, 'x_field' | 'y_fields' | 'rows'> }) {
  const columns = [chart.x_field, ...chart.y_fields]
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, i) => (
            <tr key={i}>
              {columns.map((column, c) => (
                <td key={column} className={c > 0 ? 'num' : undefined}>
                  {formatCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

`src/pages/NotFound.tsx`:

```tsx
import { Link } from 'react-router'

export function NotFound() {
  return (
    <div>
      <h1>Chart not found</h1>
      <p>
        <Link to="/">Back to all charts</Link>
      </p>
    </div>
  )
}
```

`src/pages/ListPage.tsx`:

```tsx
import { useState } from 'react'
import { useChartList } from '../charts'
import { ChartCard } from '../components/ChartCard'
import { LIBRECHAT_URL } from '../config'
import { filterCharts } from '../filter'

function EmptyGallery() {
  return (
    <div className="status">
      <p>
        No charts yet. Ask the Retail Analyst a question and request a chart — for example “Show revenue by store as a
        bar chart.” — and it will appear here.
      </p>
      <a href={LIBRECHAT_URL}>Open LibreChat</a>
    </div>
  )
}

export function ListPage() {
  const state = useChartList()
  const [query, setQuery] = useState('')
  if (state.status === 'loading') return <p className="status">Loading charts…</p>
  if (state.status === 'error') {
    return (
      <p className="status error" role="alert">
        Could not load charts: {state.error.message}
      </p>
    )
  }
  if (state.data.length === 0) return <EmptyGallery />
  const visible = filterCharts(state.data, query)
  return (
    <>
      <div className="toolbar">
        <label>
          <span className="visually-hidden">Filter charts</span>
          <input
            type="search"
            placeholder="Filter by title or description"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="count">
          {visible.length} of {state.data.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="status">No charts match “{query}”.</p>
      ) : (
        <div className="grid">
          {visible.map((chart) => (
            <ChartCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </>
  )
}
```

`src/pages/DetailPage.tsx`:

```tsx
import { Link, useParams } from 'react-router'
import { useChart, useChartList } from '../charts'
import { TableChips } from '../components/ChartCard'
import { ChartView } from '../components/ChartView'
import { DataTable } from '../components/DataTable'
import { LIBRECHAT_URL } from '../config'
import { RelatedCharts } from '../semantic/RelatedCharts'
import { useRelatedCharts } from '../semantic/useRelatedCharts'
import { relativeTime } from '../time'
import type { ChartSummary } from '../types'
import { NotFound } from './NotFound'

export function parseChartId(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d{0,9}$/.test(raw)) return null
  return Number(raw)
}

export function DetailPage() {
  const chartId = parseChartId(useParams().id)
  if (chartId === null) return <NotFound />
  return <ChartDetailView key={chartId} id={chartId} />
}

function ChartDetailView({ id }: { readonly id: number }) {
  const state = useChart(id)
  if (state.status === 'loading') return <p className="status">Loading chart…</p>
  if (state.status === 'error') {
    if (state.error.status === 404) return <NotFound />
    return (
      <p className="status error" role="alert">
        Could not load chart: {state.error.message}
      </p>
    )
  }
  const chart = state.data
  return (
    <article className="detail">
      <Link to="/">← All charts</Link>
      <h1>{chart.title}</h1>
      <p>{chart.description}</p>
      <div className="detail-meta">
        <span className="badge">{chart.chart_type}</span>
        <TableChips tables={chart.tables} />
        <time dateTime={chart.updated_at}>updated {relativeTime(chart.updated_at)}</time>
      </div>
      <figure className="chart-frame" aria-label={chart.title}>
        <ChartView chart={chart} />
      </figure>
      <details>
        <summary>Data table</summary>
        <DataTable chart={chart} />
      </details>
      <details>
        <summary>SQL</summary>
        <pre>
          <code>{chart.sql}</code>
        </pre>
      </details>
      <p>
        <a href={LIBRECHAT_URL}>Ask a follow-up in LibreChat</a>
      </p>
      <RelatedSection current={chart} />
    </article>
  )
}

/** Loads the list first so every chart is in the semantic store before neighbours are requested. */
function RelatedSection({ current }: { readonly current: ChartSummary }) {
  const list = useChartList()
  if (list.status !== 'ready') return null
  return <RelatedForChart current={current} />
}

function RelatedForChart({ current }: { readonly current: ChartSummary }) {
  const { rows, refining, modelStatus } = useRelatedCharts(current.id)
  return <RelatedCharts current={current} rows={rows} refining={refining} modelStatus={modelStatus} />
}
```

`src/App.tsx`:

```tsx
import type { ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import type { SemanticStore } from 'semantic-state'
import { SemanticProvider } from 'semantic-state/react'
import { LIBRECHAT_URL } from './config'
import { DetailPage } from './pages/DetailPage'
import { ListPage } from './pages/ListPage'
import { NotFound } from './pages/NotFound'
import type { ChartSummary } from './types'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ListPage />} />
      <Route path="/charts/:id" element={<DetailPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Chart Gallery
        </Link>
        <a href={LIBRECHAT_URL}>LibreChat</a>
      </header>
      <main className="content">{children}</main>
    </>
  )
}

export function App({ store }: { readonly store: SemanticStore<ChartSummary> }) {
  return (
    <SemanticProvider store={store}>
      <BrowserRouter>
        <Layout>
          <AppRoutes />
        </Layout>
      </BrowserRouter>
    </SemanticProvider>
  )
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { chartStore } from './semantic/store'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={chartStore} />
  </StrictMode>,
)
```

`chart-gallery/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chart Gallery</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Run tests, coverage, typecheck and build**

Run: `cd chart-gallery/web && npx vitest run --coverage && npm run build`
Expected: all tests pass; coverage thresholds (80%) met; `dist/` contains `index.html`, `assets/*.js` including a separate worker chunk.

- [ ] **Step 6: Commit**

```bash
git add chart-gallery/web
git commit -m "feat: add chart gallery list and detail pages"
```

---

### Task 8: Container, model serving and stack wiring

**Files:**
- Create: `chart-gallery/Dockerfile`, `chart-gallery/.dockerignore`, `chart-gallery/web/scripts/fetch-model.mjs`
- Modify: `docker-compose.yml`, `scripts/gen-env.sh`, `.env.example`, `setup.sh`

**Interfaces:**
- Consumes: `gallery.main:app` and env vars (Task 3); built SPA (Task 7); `src/semantic/model.json` (Task 6).
- Produces: compose service `chart-gallery` on `127.0.0.1:3090`; static `/models/Xenova/all-MiniLM-L6-v2/...` and `/ort/*.wasm|*.mjs`; `wren-mcp` env `CHART_GALLERY_URL=http://chart-gallery:3090`, `CHART_GALLERY_TOKEN`.

- [ ] **Step 1: Write the model fetch script** — `chart-gallery/web/scripts/fetch-model.mjs`

```js
// Downloads the embedding model and copies onnxruntime's wasm into <outDir>, so the browser
// loads both from the gallery and never contacts Hugging Face or a CDN.
// Usage: node scripts/fetch-model.mjs <outDir>   (dist for the image, public for `npm run dev`)
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const outDir = process.argv[2] ?? 'public'
const model = JSON.parse(await readFile(new URL('../src/semantic/model.json', import.meta.url), 'utf8'))

for (const file of model.files) {
  const target = join(outDir, 'models', model.id, file)
  if (await stat(target).then(() => true, () => false)) continue
  const url = `https://huggingface.co/${model.id}/resolve/main/${file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  console.log(`fetched ${model.id}/${file}`)
}

const candidates = [
  'node_modules/onnxruntime-web/dist',
  'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist',
]
const ortDir = (await Promise.all(candidates.map((dir) => stat(dir).then(() => dir, () => null)))).find(Boolean)
if (!ortDir) throw new Error('onnxruntime-web not found; run npm ci first')
await mkdir(join(outDir, 'ort'), { recursive: true })
const ortFiles = (await readdir(ortDir)).filter((name) => name.startsWith('ort-wasm') && /\.(wasm|mjs)$/.test(name))
if (ortFiles.length === 0) throw new Error(`no ort-wasm files in ${ortDir}`)
for (const name of ortFiles) await copyFile(join(ortDir, name), join(outDir, 'ort', name))
console.log(`copied ${ortFiles.length} onnxruntime files from ${ortDir}`)
```

Run: `cd chart-gallery/web && npm run fetch-model && ls public/models/Xenova/all-MiniLM-L6-v2/onnx public/ort`
Expected: `model_quantized.onnx` (~23 MB) and several `ort-wasm*.wasm` / `.mjs` files.

- [ ] **Step 2: Write the Dockerfile and .dockerignore**

`chart-gallery/.dockerignore`:

```
api/.venv
api/.coverage
**/__pycache__
web/node_modules
web/dist
web/coverage
web/public/models
web/public/ort
web/test-results
web/playwright-report
```

`chart-gallery/Dockerfile`:

```dockerfile
# ---- build the SPA and bundle the embedding model ----
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && node scripts/fetch-model.mjs dist

# ---- runtime: FastAPI serves the API and the built SPA ----
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /bin/uv
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    GALLERY_STATIC_DIR=/app/static \
    GALLERY_DB_PATH=/data/charts.db
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/gallery ./gallery
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 gallery && mkdir -p /data && chown gallery /data
USER gallery
EXPOSE 3090
CMD ["/app/.venv/bin/uvicorn", "gallery.main:app", "--host", "0.0.0.0", "--port", "3090", "--workers", "1"]
```

- [ ] **Step 3: Wire compose** — edit `docker-compose.yml`

Add this service after the `wren-mcp` service:

```yaml
  # ---------- Chart gallery (saved charts + related-chart suggestions) ----------
  chart-gallery:
    build: ./chart-gallery
    container_name: chart-gallery
    environment:
      CHART_GALLERY_TOKEN: ${CHART_GALLERY_TOKEN:?run scripts/gen-env.sh}
      GALLERY_PUBLIC_URL: http://localhost:3090
    volumes:
      - gallery_data:/data
    ports:
      - "127.0.0.1:3090:3090"
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3090/healthz', timeout=3)"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped
```

Add to `wren-mcp.environment`:

```yaml
      # save_chart posts re-run results here (internal network only)
      CHART_GALLERY_URL: http://chart-gallery:3090
      CHART_GALLERY_TOKEN: ${CHART_GALLERY_TOKEN:?run scripts/gen-env.sh}
```

Add to the `volumes:` list at the bottom:

```yaml
  gallery_data:
```

- [ ] **Step 4: Generate the token** — edit `scripts/gen-env.sh` and `.env.example`

In `scripts/gen-env.sh`, extend the loop list:

```bash
for spec in RETAIL_DB_PASSWORD:24 WREN_RO_PASSWORD:24 SEARXNG_SECRET:32 \
            CREDS_KEY:32 CREDS_IV:16 JWT_SECRET:32 JWT_REFRESH_SECRET:32 \
            CHART_GALLERY_TOKEN:32; do
```

In `.env.example`, read the file first, then add next to the other generated secrets, following its existing comment style:

```
# Shared secret between wren-mcp (save_chart) and the chart gallery. Generated by scripts/gen-env.sh.
CHART_GALLERY_TOKEN=
```

- [ ] **Step 5: Update setup.sh**

Change `PORTS=(3080 7080 8888)` to `PORTS=(3080 3090 7080 8888)`.

Replace the final heredoc with:

```bash
cat <<'EOF'

Ready: open http://localhost:3080
  1. Sign up (the first account becomes admin)
  2. Start a new chat with "Retail Analyst (GLM-4.6)"
  3. Try: "How do monthly sales revenue trends look over the past 12 months? Chart it."
  4. Saved charts and related-chart suggestions: http://localhost:3090

Stop:   docker compose down        (keeps data)
Reset:  docker compose down -v     (deletes all data, accounts and saved charts)
EOF
```

- [ ] **Step 6: Build and verify**

```bash
./scripts/gen-env.sh
docker compose up -d --build --wait chart-gallery wren-mcp
curl -sf http://localhost:3090/healthz
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3090/charts/1
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3090/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
docker compose exec chart-gallery sh -c 'ls /app/static/ort && ls -ln /data'
docker compose logs wren-mcp | tail -5
```

Expected: `{"success":true,"data":{"status":"ok"},"error":null}`; `200 text/html; charset=utf-8`; `200`; ort files listed and `/data` owned by uid 10001; wren-mcp log ends with "starting MCP server" and no traceback.

- [ ] **Step 7: Commit**

```bash
git add chart-gallery/Dockerfile chart-gallery/.dockerignore chart-gallery/web/scripts docker-compose.yml scripts/gen-env.sh .env.example setup.sh
git commit -m "feat: run chart gallery in compose with bundled embedding model"
```

---

### Task 9: Analyst prompt, smoke test, E2E and docs

**Files:**
- Modify: `librechat/librechat.yaml`, `wren/project/knowledge/rules/retail.md`, `docker-compose.yml` (librechat env), `scripts/smoke-test.sh`, `README.md`
- Create: `chart-gallery/web/playwright.config.ts`, `chart-gallery/web/e2e/gallery.spec.ts`

**Interfaces:**
- Consumes: everything above; MCP tool name `save_chart`; gallery endpoints.
- Produces: final user-facing behaviour.

- [ ] **Step 1: Tell the analyst to save charts**

In `librechat/librechat.yaml`, append rule 8 to `promptPrefix: &analyst_prompt` (after rule 7, same indentation):

```yaml
          8. After every chart artifact, call `save_chart` once with: a short title
             (under 80 characters), a one-to-two sentence description of what the
             chart shows, the chart type (line, bar or pie), the exact SQL you ran,
             the x-axis column and the y-axis column(s) exactly as named in the
             result. Then end your answer with "Saved to gallery: <url>". If
             save_chart returns an error, fix the call once; if it fails again,
             say the chart was not saved.
```

In the same file, extend `mcpServers.wren.serverInstructions`:

```yaml
    serverInstructions: |
      Before answering any data question, call `get_instructions` once for the
      business rules (metric definitions, date semantics, chart policy), then
      inspect the schema with `describe_schema` before writing SQL.
      After drawing a chart, call `save_chart` with the SQL you ran and link the
      returned gallery URL in your answer.
```

In `wren/project/knowledge/rules/retail.md`, replace rule 6 with:

```markdown
6. After answering with data, ALWAYS offer/produce a chart artifact (recharts via
   LibreChat artifacts, or Mermaid for flows). Pick: trend over time → LineChart;
   comparison across categories → BarChart; share of total → pie/donut. Then call
   `save_chart` (line, bar or pie only) so the chart lands in the shared gallery,
   and link the URL it returns.
```

In `docker-compose.yml`, add to `librechat.environment`:

```yaml
      CUSTOM_FOOTER: "[Chart gallery](http://localhost:3090)"
```

- [ ] **Step 2: Extend the smoke test** — `scripts/smoke-test.sh`

After `set -uo pipefail`, add:

```bash
cd "$(dirname "$0")/.."
# shellcheck source=lib/env.sh
. scripts/lib/env.sh
```

Before `exit $fail`, add:

```bash
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
```

Run: `./scripts/smoke-test.sh`
Expected: every line `PASS`, exit code 0.

- [ ] **Step 3: Write the E2E test**

`chart-gallery/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.GALLERY_URL ?? 'http://localhost:3090' },
})
```

`chart-gallery/web/e2e/gallery.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const token = process.env.CHART_GALLERY_TOKEN ?? ''

const SEEDS = [
  {
    title: 'Revenue by store',
    description: 'Completed-payment revenue for each physical store.',
    chart_type: 'bar',
    x_field: 'store_name',
    y_fields: ['revenue'],
    sql: 'SELECT s.store_name, SUM(o.total_amount) AS revenue FROM stores s JOIN orders o ON o.store_id = s.store_id GROUP BY 1 /* e2e seed */',
    rows: [{ store_name: 'Central', revenue: 1200.5 }, { store_name: 'Kowloon', revenue: 980 }],
  },
  {
    title: 'Return rate by store',
    description: 'Share of orders returned at each physical store.',
    chart_type: 'bar',
    x_field: 'store_name',
    y_fields: ['return_rate'],
    sql: 'SELECT s.store_name, COUNT(r.return_id)::numeric / COUNT(o.order_id) AS return_rate FROM stores s JOIN orders o ON o.store_id = s.store_id LEFT JOIN returns r ON r.order_id = o.order_id GROUP BY 1 /* e2e seed */',
    rows: [{ store_name: 'Central', return_rate: 0.04 }, { store_name: 'Kowloon', return_rate: 0.07 }],
  },
  {
    title: 'Customers by loyalty tier',
    description: 'How many customers sit in each loyalty tier.',
    chart_type: 'pie',
    x_field: 'loyalty_tier',
    y_fields: ['customers'],
    sql: 'SELECT loyalty_tier, COUNT(*) AS customers FROM customers GROUP BY 1 /* e2e seed */',
    rows: [{ loyalty_tier: 'gold', customers: 120 }, { loyalty_tier: 'silver', customers: 300 }],
  },
]

test.beforeAll(async ({ request }) => {
  expect(token.length, 'set CHART_GALLERY_TOKEN from .env').toBeGreaterThanOrEqual(32)
  for (const seed of SEEDS) {
    const response = await request.post('/internal/charts', { data: seed, headers: { Authorization: `Bearer ${token}` } })
    expect(response.ok()).toBeTruthy()
  }
})

test('list → detail → related charts, with no CDN traffic', async ({ page, context }) => {
  const external: string[] = []
  await context.route(/huggingface\.co|cdn\.jsdelivr\.net|unpkg\.com/, (route) => {
    external.push(route.request().url())
    return route.abort()
  })

  await page.goto('/')
  await page.getByRole('searchbox').fill('return rate')
  await page.getByRole('link', { name: /Return rate by store/ }).first().click()

  await expect(page.getByRole('heading', { level: 1, name: 'Return rate by store' })).toBeVisible()
  await expect(page.locator('.chart-frame svg.recharts-surface')).toBeVisible()

  const related = page.locator('section.related')
  await expect(related).toHaveAttribute('data-model-status', 'ready', { timeout: 90_000 })
  await expect(related.getByText('refining…')).toHaveCount(0)
  await expect(related).toContainText('Revenue by store')
  await expect(related).toContainText('similar topic')
  expect(external).toEqual([])
})

test('unknown chart shows not found', async ({ page }) => {
  await page.goto('/charts/999999999')
  await expect(page.getByRole('heading', { name: 'Chart not found' })).toBeVisible()
})
```

Run:

```bash
cd chart-gallery/web
npx playwright install chromium
CHART_GALLERY_TOKEN=$(grep '^CHART_GALLERY_TOKEN=' ../../.env | cut -d= -f2-) npm run e2e
```

Expected: 2 passed. If `data-model-status` ends at `error`, open the browser console in `npx playwright test --headed`: a 404 under `/ort/` means the wasm file name transformers.js asks for is not in `dist/ort` — fix `fetch-model.mjs` to copy it; a request to a CDN means an `env` setting in `charts.worker.ts` is missing.

- [ ] **Step 4: Manual end-to-end check with a real model**

```bash
docker compose up -d --build --wait
```

In http://localhost:3080, start "Retail Analyst (GLM-4.6)" and send: "Which stores have the highest return rates? Show a bar chart."
Expected: the reply ends with "Saved to gallery: http://localhost:3090/charts/<id>"; the link opens the chart; asking the same question again returns the same id ("updated"); the LibreChat footer shows "Chart gallery" (if it renders as plain text instead of a link, note it in the README section below).

- [ ] **Step 5: Document** — edit `README.md`

1. In the intro bullet list, after **Charts**, add:

```markdown
- **Chart gallery** — every chart the analyst draws is saved (http://localhost:3090) with its title, description and SQL; each chart page suggests related charts, ranked on-device by meaning
```

2. In the architecture diagram, add the gallery next to Wren MCP:

```
                  OpenRouter models   web search     MCP tools
                           │             │              │
                           ▼             ▼              ▼
                  api.openrouter.ai   SearXNG :8888   Wren MCP :7080 ──save_chart──▶ chart-gallery :3090
                       (LLMs)         (meta search)   (streamable HTTP)              (FastAPI + SQLite + SPA)
```

3. In "Data flow for a typical question", after step 4, add:

```markdown
5. It calls `save_chart`: Wren runs the SQL again (read-only, 200 rows max) and the result is stored in the chart gallery, deduplicated by normalized SQL + chart type. The reply links the gallery page.
```

(renumber the following step to 6).

4. In the repository layout, add:

```
├── chart-gallery/              # saved charts: FastAPI + SQLite API, React SPA, bundled embedding model
│   ├── api/gallery/            # normalize.py (dedup), repository.py, app.py
│   └── web/src/semantic/       # related-chart ranking with semantic-state (Web Worker)
```

and under `wren/scripts/`: `│   ├── scripts/chart_tool.py   # save_chart tool (re-runs SQL, posts to the gallery)`.

5. Add a new section before "Key design decisions":

```markdown
### Chart gallery

- **Capture** — `save_chart` is an extra tool on the Wren MCP server. The model sends the title, description, chart type, SQL and field names; Wren re-runs the SQL, so the gallery never stores numbers the model typed.
- **Dedup** — the gallery normalizes SQL with sqlglot (whitespace, casing, comments) and keys charts by `sha256(normalized SQL + chart type)`. Re-asking a question refreshes the existing chart. Different aliases or a different `LIMIT` count as a new chart.
- **Related charts** — ranked in a Web Worker with [semantic-state](https://github.com/jasonli0226/semantic-state): title + description embeddings (`Xenova/all-MiniLM-L6-v2`) plus a small boost for charts that query the same tables. The model is baked into the gallery image and served from it; chart text never leaves the browser and no CDN is contacted.
- **Security** — writes need `CHART_GALLERY_TOKEN` (generated into `.env`); the read API and page are open but bound to `127.0.0.1`.
- **Schema changes** — there are no migrations. After a breaking change to the `charts` table, wipe the volume: `docker compose down && docker volume rm librechat-wren-demo_gallery_data`.
- **Tests** — `cd chart-gallery/api && uv run pytest`, `cd chart-gallery/web && npm test`, `uv run --no-project --with pytest --with httpx --with "mcp<2" pytest wren/tests`, E2E: `npm run e2e` in `chart-gallery/web` against a running stack.
```

6. In the security posture list, add: `- The chart gallery write endpoint requires a bearer token (constant-time compare); its port binds to 127.0.0.1 only`.

- [ ] **Step 6: Run every test suite**

```bash
(cd chart-gallery/api && uv run pytest -q --cov=gallery)
(cd chart-gallery/web && npx vitest run --coverage && npm run build)
uv run --no-project --with pytest --with pytest-cov --with httpx --with "mcp<2" pytest wren/tests -q --cov=chart_tool
./scripts/smoke-test.sh
```

Expected: all green, coverage ≥ 80% everywhere, smoke test exit 0.

- [ ] **Step 7: Commit**

```bash
git add librechat/librechat.yaml wren/project/knowledge/rules/retail.md docker-compose.yml scripts/smoke-test.sh README.md chart-gallery/web/playwright.config.ts chart-gallery/web/e2e
git commit -m "feat: have the analyst save charts to the gallery; add smoke and e2e checks"
```
