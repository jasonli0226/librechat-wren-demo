# Dashboard Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search (or one chart) in the chart gallery builds a live dashboard: related charts picked by `semantic-state`, tiles typed by rules, then regrouped by an LLM via json-render while the tiles visibly move.

**Architecture:** The FastAPI gallery API gains two public endpoints: `GET /api/charts/{id}/data` (re-runs a saved chart's SQL through `wren-mcp`'s `run_sql` over MCP) and `POST /api/dashboards/arrange` (computes headline values from stored rows, calls OpenRouter with a fixed server-side prompt, returns the model's JSONL). The React SPA gains a lazy `/dashboard` route: it freezes a chart selection, types tiles from snapshot rows, renders a rules layout as a json-render spec, fetches live rows per tile, validates the AI spec, and swaps to it inside a View Transition.

**Tech Stack:** Python 3.11, FastAPI, pydantic, `mcp` client (<2), httpx; React 19, react-router 8, recharts 3, `semantic-state` 0.1.0-experimental.1, `@json-render/core` + `@json-render/react` 0.21.1, zod 4.6.7; vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-dashboard-builder-design.md` (research: `docs/research/json-render.md`)

## Global Constraints

- Pin `@json-render/core` and `@json-render/react` to exactly `0.21.1` and `zod` to exactly `4.6.7` (the combination tested in the research; core carries its own `zod ^4.3.6`, so a different minor risks two copies — check `npm ls zod` shows one).
- The browser never sends SQL or prompt text. Data and arrange endpoints take chart ids only; titles, descriptions, tables and headlines are read from the database.
- Both new endpoints are public and **must** be rate-limited (per client and global); over the limit → HTTP 429 in the standard envelope `{success, data, error}`.
- Live query row cap: 200. Per-query timeout: 10 s. LLM timeout: 8 s.
- `min` compares against `semantic-state` `confidence` (0–1), never raw `score`. Defaults `min=0.5`, `max=6`; clamp `min` to `[0, 1]`, `max` to `[1, 12]`.
- Selection waits at most 1.5 s for the model, then is frozen for the page's life (Rebuild re-runs it).
- Tile types come from snapshot rows; live rows only swap data (or degrade a tile to Table in place).
- Any failure in AI spec structure/type/id checks → keep the rules layout and show "Arranged by rules". A failed summary-number check drops only the summary.
- The gallery must start and work without `OPENROUTER_KEY` (rules layout only) and without Wren reachable (snapshot fallback).
- Commit messages: `<type>: <description>` (feat, fix, refactor, docs, test, chore). No co-author or AI attribution lines.

## Review Focus

1. **Model wraps its JSONL in a Markdown code fence or adds a prose line** → fences and non-JSON lines are ignored and the spec still validates. Test in Task 10.
2. **One page load of a 12-tile dashboard plus one Rebuild** must not trip the per-client data rate limit. Test in Task 3.
3. **Live rows that lack `x_field`/`y_fields` columns, or come back empty** → the tile shows the snapshot with its note instead of breaking. Test in Task 11.
4. **`from=<id>` for a chart that does not exist, or a `q` that matches nothing** → a short message with a link back to the gallery, not a blank page or a crash. Test in Task 13.
5. **`null`, string or non-finite y values in rows** → type rules treat them as non-numeric; a Stat with no numeric value renders "—". Test in Task 7.

---

## File map

API (`chart-gallery/api/gallery/`):
- `config.py` — modify: new settings.
- `ratelimit.py` — create: sliding-window limiter.
- `wren.py` — create: MCP `run_sql` client.
- `headline.py` — create: headline values per tile.
- `llm.py` — create: OpenRouter chat-completions client.
- `arrange.py` — create: request model + user-message builder.
- `app.py` — modify: two endpoints, injected `query`/`llm`.

Web (`chart-gallery/web/src/dashboard/`, all new unless noted):
- `types.ts` — shared dashboard types.
- `catalog.ts` — json-render catalog + `TILE_COMPONENT` map.
- `arrange-prompt.md` — system prompt (server reads it).
- `tileTypes.ts` — type rules + variety.
- `selection.ts` — params parsing + chart selection.
- `rulesLayout.ts` — rules spec builder.
- `arrangement.ts` — AI spec validation + summary check.
- `tileData.ts` — live data hook + fallback resolution.
- `tiles.tsx`, `registry.tsx`, `DashboardView.tsx`, `transition.ts` — rendering.
- `useDashboard.ts` — page orchestration hook.
- `../pages/DashboardPage.tsx` — page; `../App.tsx`, `../api.ts`, `../pages/ListPage.tsx`, `../pages/DetailPage.tsx`, `../components/ChartView.tsx`, `../styles.css` — modify.

Infra: `chart-gallery/Dockerfile`, `docker-compose.yml`, `chart-gallery/web/scripts/e2e-gallery.sh`, `chart-gallery/web/e2e/dashboard.spec.ts`, `README.md`.

---

### Task 1: Settings and rate limiter

**Files:**
- Modify: `chart-gallery/api/gallery/config.py`
- Create: `chart-gallery/api/gallery/ratelimit.py`
- Test: `chart-gallery/api/tests/test_config.py`, `chart-gallery/api/tests/test_ratelimit.py`

**Interfaces:**
- Produces: `Settings` fields `wren_mcp_url: str = "http://wren-mcp:7080/mcp"`, `openrouter_key: str | None = None`, `llm_model: str = "z-ai/glm-4.5-air"`, `prompt_path: str | None = None`, read from `WREN_MCP_URL`, `OPENROUTER_KEY`, `GALLERY_LLM_MODEL`, `GALLERY_PROMPT_PATH` (empty string → default/None).
- Produces: `class RateLimiter(per_client: int, total: int, window_s: float, clock: Callable[[], float] = time.monotonic)` with `allow(client: str) -> bool` (sliding window; a denied call is not counted).

- [ ] **Step 1: Write failing tests**

```python
# test_config.py
def test_dashboard_settings_defaults():
    s = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32})
    assert s.wren_mcp_url == "http://wren-mcp:7080/mcp"
    assert s.openrouter_key is None and s.prompt_path is None
    assert s.llm_model == "z-ai/glm-4.5-air"

def test_dashboard_settings_from_env():
    s = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "WREN_MCP_URL": "http://w/mcp",
                           "OPENROUTER_KEY": "sk-or-1", "GALLERY_LLM_MODEL": "m/x", "GALLERY_PROMPT_PATH": "/p.md"})
    assert (s.wren_mcp_url, s.openrouter_key, s.llm_model, s.prompt_path) == ("http://w/mcp", "sk-or-1", "m/x", "/p.md")

def test_empty_openrouter_key_means_disabled():
    assert Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "OPENROUTER_KEY": ""}).openrouter_key is None

# test_ratelimit.py
def test_per_client_limit_and_window_expiry():
    now = [0.0]
    rl = RateLimiter(per_client=2, total=100, window_s=60, clock=lambda: now[0])
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")
    now[0] = 60.1
    assert rl.allow("a")

def test_total_limit_across_clients():
    rl = RateLimiter(per_client=10, total=3, window_s=60, clock=lambda: 0.0)
    assert [rl.allow(c) for c in "abcd"] == [True, True, True, False]

def test_denied_calls_do_not_extend_the_window():
    now = [0.0]
    rl = RateLimiter(per_client=1, total=10, window_s=10, clock=lambda: now[0])
    rl.allow("a"); now[0] = 5; assert not rl.allow("a"); now[0] = 10.1
    assert rl.allow("a")
```

- [ ] **Step 2: Run** `cd chart-gallery/api && uv run pytest tests/test_config.py tests/test_ratelimit.py -v` → FAIL (missing fields / module).
- [ ] **Step 3: Implement** the four `Settings` fields in `config.py` and `RateLimiter` in `ratelimit.py` (per-client and total `collections.deque` of timestamps; prune entries older than `window_s` on each call; keep it synchronous — the app runs one worker). Add a module comment: clients are keyed by the socket peer address, which is correct only while nothing proxies the gallery; a reverse proxy in front would collapse every visitor into one bucket and needs trusted `X-Forwarded-For` handling.
- [ ] **Step 4: Run** the same command → PASS; then `uv run pytest` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add dashboard settings and a sliding-window rate limiter"`

---

### Task 2: Wren MCP query client

**Files:**
- Modify: `chart-gallery/api/pyproject.toml` (`uv add "mcp<2" httpx`)
- Create: `chart-gallery/api/gallery/wren.py`
- Test: `chart-gallery/api/tests/test_wren.py`

**Interfaces:**
- Produces: `class QueryResult(TypedDict): columns: list[str]; rows: list[dict[str, Any]]; truncated: bool`
- Produces: `class WrenError(Exception)` (message is safe to log, not to return).
- Produces: `QueryFn = Callable[[str], Awaitable[QueryResult]]`
- Produces: `async def run_sql_with_session(session: ClientSession, sql: str, limit: int) -> QueryResult` — calls tool `run_sql` with `{"sql": sql, "limit": limit}`; reads `result.structuredContent` (wrenai 0.15.0 returns `{"columns", "rows", "row_count", "truncated"}`), falling back to `json.loads` of the first text content; `result.isError` or a malformed shape → `WrenError`.
- Produces: `def make_wren_query(url: str, limit: int = 200, timeout: float = 10.0) -> QueryFn` — opens `streamablehttp_client(url)` + `ClientSession`, `initialize()`, then `run_sql_with_session`, all inside `asyncio.timeout(timeout)`. One session per call (handshake is cheap on the compose network; concurrency is capped in Task 3). This deliberately departs from the design's "reuse one session" (the design doc now records it): the 10 s timeout covers handshake + query, and a 12-tile dashboard costs 12 handshakes. Transport/HTTP errors → `WrenError`; timeout propagates as `TimeoutError`.

- [ ] **Step 1: Write failing tests** using an in-memory server (`mcp.shared.memory.create_connected_server_and_client_session` with a `FastMCP` whose `run_sql` tool is a fake), run via `asyncio.run` like `wren/tests/test_chart_tool.py`:
  - `test_returns_columns_rows_truncated` — fake returns `{"columns": ["store", "revenue"], "rows": [{"store": "A", "revenue": 1.5}], "row_count": 1, "truncated": False}` → result equals `{"columns": ["store", "revenue"], "rows": [{"store": "A", "revenue": 1.5}], "truncated": False}`.
  - `test_passes_sql_and_limit` — fake records its args; assert `("SELECT 1", 200)`.
  - `test_tool_error_raises_wren_error` — fake raises `ValueError("bad column")` → `pytest.raises(WrenError, match="bad column")`.
  - `test_malformed_result_raises_wren_error` — fake returns `{"rows": "nope"}` → `WrenError`.
  - `test_unreachable_url_raises_wren_error` — `asyncio.run(make_wren_query("http://127.0.0.1:9/mcp", timeout=2)("SELECT 1"))` → `WrenError`.
- [ ] **Step 2: Run** `uv run pytest tests/test_wren.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** `wren.py` per the interface.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add an MCP client for Wren run_sql"`

---

### Task 3: Live data endpoint

**Files:**
- Modify: `chart-gallery/api/gallery/app.py`, `docker-compose.yml` (chart-gallery env `WREN_MCP_URL: http://wren-mcp:7080/mcp`)
- Test: `chart-gallery/api/tests/test_data.py`

**Interfaces:**
- Consumes: `QueryFn`, `WrenError`, `make_wren_query` (Task 2); `RateLimiter`, `Settings.wren_mcp_url` (Task 1).
- Produces: `create_app(settings, repo=None, query: QueryFn | None = None, llm: LlmFn | None = None)` (the `llm` param is added in Task 5; add only `query` now). Default `query = make_wren_query(settings.wren_mcp_url)`.
- Produces: `GET /api/charts/{chart_id}/data` → `envelope({"rows", "columns", "truncated", "ran_at"})` where `ran_at` is ISO-8601 UTC.
- Produces constants in `app.py`: `DATA_PER_CLIENT = 60`, `DATA_TOTAL = 300` (per 60 s), `DATA_CONCURRENCY = 4` (an `asyncio.Semaphore` around `query`).

Errors: unknown id → 404 `"chart not found"`; rate limited → 429 `"too many requests"`; `WrenError` → 502 `"live query failed"`; `TimeoutError` → 504 `"live query timed out"`. Log the `WrenError` message and chart id with `logger.warning`; never put it in the response. Client key: `request.client.host`.

- [ ] **Step 1: Write failing tests** (fixture like `test_app.py`'s `client`, plus a recording fake `async def query(sql)`; seed one chart via `/internal/charts`):
  - `test_returns_live_rows_for_saved_sql` — fake returns `{"columns": ["store_name", "revenue"], "rows": [{"store_name": "Central", "revenue": 11.0}], "truncated": False}`; response data has those rows/columns, `truncated` false, `ran_at` parseable by `datetime.fromisoformat`; the fake received the chart's stored SQL.
  - `test_unknown_chart_is_404_and_runs_nothing` — `/api/charts/99/data` → 404, fake not called.
  - `test_wren_error_is_502_without_details` — fake raises `WrenError("password=secret")`; status 502, error `"live query failed"`, `"secret" not in response.text`.
  - `test_timeout_is_504` — fake raises `TimeoutError` → 504.
  - `test_rate_limit_allows_a_dashboard_and_a_rebuild_then_429` — 24 requests from one client all 200 (12 tiles × 2 loads); requests 25–60 → 200; request 61 → 429 `"too many requests"`. (Review Focus 2)
  - `test_concurrency_is_capped` — fake awaits an `asyncio.Event` and tracks max in-flight; fire 8 concurrent requests via `httpx.AsyncClient(transport=httpx.ASGITransport(app))`; assert max in-flight == 4.
- [ ] **Step 2: Run** `uv run pytest tests/test_data.py -v` → FAIL (404 route missing).
- [ ] **Step 3: Implement** the endpoint (`async def`) and the `query` parameter in `create_app`; add `WREN_MCP_URL` to the chart-gallery service in `docker-compose.yml`.
- [ ] **Step 4: Run** `uv run pytest` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: serve live chart data through Wren with rate limits"`

---

### Task 4: Headline values

**Files:**
- Create: `chart-gallery/api/gallery/headline.py`
- Test: `chart-gallery/api/tests/test_headline.py`

**Interfaces:**
- Produces: `TileType = Literal["stat", "line", "bar", "stackedBar", "table"]`
- Produces: `def headline_for(chart: Mapping[str, Any], tile_type: TileType) -> dict[str, float | int | str]` — uses `chart["rows"]`, `chart["x_field"]`, first of `chart["y_fields"]`; ignores non-numeric (`bool`, `None`, `str`, non-finite) y values; numbers rounded to 4 significant digits, percentages to 1 decimal.
  - `stat`: `{"value"}`
  - `line`: `{"first", "last", "points", "pct_change"}` (`pct_change` omitted when `first == 0`)
  - `bar` / `stackedBar`: `{"top", "top_value", "total", "top_share_pct", "rows"}`
  - `table`: `{"rows", "top", "top_value"}`
  - No numeric values → `{"rows": len(rows)}` only.

- [ ] **Step 1: Write failing tests**
  - `test_stat` — rows `[{"k": "all", "v": 8_212_345.67}]`, type stat → `{"value": 8_212_000}`.
  - `test_line_pct_change` — v series 100, 90, 112 → `{"first": 100, "last": 112, "points": 3, "pct_change": 12.0}`.
  - `test_line_zero_first_omits_pct` — first 0 → `"pct_change" not in result`.
  - `test_bar_top_and_share` — `[("A", 30), ("B", 50), ("C", 20)]` → `{"top": "B", "top_value": 50, "total": 100, "top_share_pct": 50.0, "rows": 3}`.
  - `test_ignores_null_and_string_values` — `[("A", None), ("B", "12"), ("C", 5)]` bar → `top == "C"`, `total == 5`.
  - `test_no_numeric_values` — all `None` → `{"rows": 2}`.
- [ ] **Step 2: Run** `uv run pytest tests/test_headline.py -v` → FAIL.
- [ ] **Step 3: Implement** `headline_for`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: compute headline values for dashboard tiles"`

---

### Task 5: OpenRouter client and arrange endpoint

**Files:**
- Create: `chart-gallery/api/gallery/llm.py`, `chart-gallery/api/gallery/arrange.py`
- Modify: `chart-gallery/api/gallery/app.py`, `docker-compose.yml` (chart-gallery env `OPENROUTER_KEY: ${OPENROUTER_KEY:-}`, `GALLERY_LLM_MODEL: ${GALLERY_LLM_MODEL:-z-ai/glm-4.5-air}`)
- Test: `chart-gallery/api/tests/test_llm.py`, `chart-gallery/api/tests/test_arrange.py`

**Interfaces:**
- Consumes: `headline_for`, `TileType` (Task 4); `RateLimiter`, settings (Task 1).
- Produces (`llm.py`): `LlmFn = Callable[[str, str], Awaitable[str]]` (system prompt, user message → text); `class LlmError(Exception)`; `def make_openrouter_llm(key: str, model: str, timeout: float = 8.0, transport: httpx.AsyncBaseTransport | None = None) -> LlmFn` — POST `https://openrouter.ai/api/v1/chat/completions` with `{"model", "temperature": 0.2, "max_tokens": 1500, "messages": [system, user]}` and `Authorization: Bearer <key>`; returns `choices[0].message.content`; non-200 or bad body → `LlmError` (message without the key); httpx timeout → `TimeoutError`.
- Produces (`arrange.py`): pydantic `TileIn(chart_id: int, type: TileType, allowed_types: list[TileType] (1–5, contains type))`, `ArrangeIn(tiles: list[TileIn] (1–12, unique chart_id))`, `extra="forbid"`; `def build_user_message(charts: list[Mapping], tiles: list[TileIn], headlines: dict[int, dict]) -> str` — JSON array of `{chart_id, title, description, tables, type, allowed_types, columns, headline}` in tile order.
- Produces: `create_app(..., llm: LlmFn | None = None)`; default built from settings only when `openrouter_key` is set. `POST /api/dashboards/arrange` → `envelope({"spec": <model text>, "headlines": {"<id>": {...}}})`.
- Constants: `ARRANGE_PER_CLIENT = 6`, `ARRANGE_TOTAL = 30` (per 60 s).

Errors: no `llm` or no readable prompt file → 503 `"AI arrangement disabled"`; unknown chart id → 422 `"unknown chart id <id>"`; 429 `"too many requests"`; `LlmError` → 502 `"AI arrangement failed"`; `TimeoutError` → 504 `"AI arrangement timed out"`. The prompt file is read per request from `settings.prompt_path`. The rate limit is checked **first**, before body validation and the chart lookup, so rejected or id-probing requests still spend budget (the endpoint takes the raw `Request`, checks the limiter, then parses `ArrangeIn` itself and maps pydantic errors to 422). The request's `type` is untrusted: it only selects which headline shape is computed from the real stored rows, which is harmless.

- [ ] **Step 1: Write failing tests**
  - `test_llm.py` with `httpx.MockTransport`: `test_sends_model_messages_and_auth` (assert URL, bearer header, model, two messages, temperature 0.2), `test_returns_message_content`, `test_non_200_raises_without_key` (`"sk-or-secret" not in str(exc)`), `test_timeout_raises_timeout_error`.
  - `test_arrange.py` (app fixture with `prompt_path` to a tmp file containing `"PROMPT"`, recording fake `llm`, two seeded charts):
    - `test_returns_spec_and_headlines` — fake returns `'{"op":"add"}'`; data `== {"spec": '{"op":"add"}', "headlines": {"1": {...}, "2": {...}}}`; fake's system arg is `"PROMPT"`; user message JSON has the DB titles.
    - `test_request_cannot_inject_titles` — body with extra `"title"` on a tile → 422.
    - `test_rejects_duplicate_and_too_many_tiles` — duplicate ids → 422; 13 tiles → 422.
    - `test_rejects_type_not_in_allowed` — `type: "bar", allowed_types: ["table"]` → 422.
    - `test_unknown_chart_id_is_422` — id 99 → 422 `"unknown chart id 99"`, fake not called.
    - `test_disabled_without_llm_or_prompt` — app with `llm=None` → 503 `"AI arrangement disabled"`; app with missing prompt file → same.
    - `test_llm_failure_and_timeout` — `LlmError` → 502; `TimeoutError` → 504.
    - `test_rate_limit` — 6 calls OK, 7th → 429.
    - `test_invalid_requests_count_against_the_limit` — 6 calls with unknown id 99 (422 each), then a valid call → 429.
    - `test_app_starts_without_openrouter_key` — `create_app(settings_without_key)` succeeds and `/healthz` is 200.
- [ ] **Step 2: Run** `uv run pytest tests/test_llm.py tests/test_arrange.py -v` → FAIL.
- [ ] **Step 3: Implement** `llm.py`, `arrange.py`, the endpoint (`async def`), the `llm` param; add the two env vars to `docker-compose.yml`.
- [ ] **Step 4: Run** `uv run pytest` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add the AI dashboard arrange endpoint via OpenRouter"`

---

### Task 6: json-render catalog and prompt

**Files:**
- Modify: `chart-gallery/web/package.json` (`npm i -E @json-render/core@0.21.1 @json-render/react@0.21.1 zod@4.6.7`; `npm ls zod` must show a single deduped copy), `chart-gallery/Dockerfile`
- Create: `chart-gallery/web/src/dashboard/types.ts`, `chart-gallery/web/src/dashboard/catalog.ts`, `chart-gallery/web/src/dashboard/arrange-prompt.md`
- Test: `chart-gallery/web/src/dashboard/catalog.test.ts`

**Interfaces:**
- Produces (`types.ts`): `TileType = 'stat' | 'line' | 'bar' | 'stackedBar' | 'table'`; `TileWidth = 'quarter' | 'half' | 'full'`; `TilePlan { chart: ChartDetail; type: TileType; allowed: readonly TileType[]; confidence: number | null }`; `Headlines = Readonly<Record<string, Readonly<Record<string, number | string>>>>`.
- Produces (`catalog.ts`): `catalog = defineCatalog(schema, { components, actions: {} })` with `Dashboard` (`summary: z.string().max(200)`, slots `["default"]`), `Section` (`title: z.string().max(60)`, slots `["default"]`), and `StatTile`, `LineTile`, `BarTile`, `StackedBarTile`, `TableTile` (`chartId: z.number().int().positive()`, `width: z.enum(['quarter','half','full'])`, no slots); `TILE_COMPONENT: Record<TileType, string>` (`stat → 'StatTile'`, …); `SUMMARY_MAX = 200`, `TITLE_MAX = 60`.
- Produces: `arrange-prompt.md` — compact system prompt (target < 3 000 characters). Must contain: every component name and prop name; that output is JSONL patch lines only (`{"op":"add","path":"/root",...}` / `{"op":"add","path":"/elements/<key>",...}`), every element with `children`; one complete example for two tiles; rules — use each given `chart_id` exactly once, a tile's component must come from its `allowed_types`, at most 4 sections, summary ≤ 200 characters citing only numbers that appear in `headline`, no `state`, `on`, `watch`, `repeat`, `visible` or `$` expressions, never invent data.
- Dockerfile runtime stage: `COPY web/src/dashboard/arrange-prompt.md /app/prompts/arrange-prompt.md` and `ENV GALLERY_PROMPT_PATH=/app/prompts/arrange-prompt.md`.

- [ ] **Step 1: Write failing tests** (`catalog.test.ts`; read the prompt with `fs.readFileSync(new URL('./arrange-prompt.md', import.meta.url))`):
  - `prompt mentions every catalog component and prop` — for each key in `catalog.data.components` and each key of its zod `props.shape`, `expect(prompt).toContain(name)`.
  - `prompt forbids state and invented data` — contains `state`, `exactly once`, `allowed_types`.
  - `prompt stays compact` — `prompt.length < 3000`.
  - `tile props reject a string chartId and an unknown width` — `catalog.data.components.BarTile.props.safeParse({chartId: '1', width: 'half'}).success === false`; same for `width: 'third'`.
  - `TILE_COMPONENT maps every tile type to a catalog component`.
- [ ] **Step 2: Run** `cd chart-gallery/web && npx vitest run src/dashboard/catalog.test.ts` → FAIL.
- [ ] **Step 3: Implement** `types.ts`, `catalog.ts`, `arrange-prompt.md`; edit the Dockerfile.
- [ ] **Step 4: Run** the test → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat: add the json-render dashboard catalog and arrange prompt"`

---

### Task 7: Tile type rules

**Files:**
- Create: `chart-gallery/web/src/dashboard/tileTypes.ts`
- Test: `chart-gallery/web/src/dashboard/tileTypes.test.ts`

**Interfaces:**
- Consumes: `TileType`, `TilePlan` (Task 6).
- Produces: `fittingTypes(chart: Pick<ChartDetail,'chart_type'|'x_field'|'y_fields'>, rows: readonly Row[]): TileType[]` — in priority order `stat, line, stackedBar, bar, table`; `planTiles(charts: readonly {chart: ChartDetail; confidence: number | null}[]): TilePlan[]` — `type = fittingTypes(...)[0]` on snapshot rows, `allowed = fittingTypes(...)`, then the variety pass; `isNumeric(v: unknown): boolean` (finite `number` only).

Fit rules (rows = given rows; y = `y_fields`):
- `stat`: 1 row, 1 y, numeric.
- `line`: ≥ 2 rows and every x value matches `/^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}.*)?$/`.
- `stackedBar`: not line-shaped, 2–7 rows, 1 y, `chart_type === 'pie'`.
- `bar`: not line-shaped, 1–20 rows, and the y fields' max absolute values are within 100× of each other.
- `table`: always.
- Variety: walking in order, if a tile's type equals the previous tile's and it is `bar` with `table` allowed (or `table` with `bar` allowed), switch to the other.

- [ ] **Step 1: Write failing tests**
  - `one numeric row is a stat` → `['stat', 'table']` … (assert `fittingTypes` first element and that `table` is always last).
  - `date x is a line, even with 200 rows`.
  - `saved pie with ≤7 categories is a stacked bar; 8 is a bar`.
  - `more than 20 categories is a table`.
  - `y fields 1000× apart are a table`.
  - `null, string and NaN y values are not numeric` — `[{k:'a', v:null}]` → not stat; `isNumeric('12') === false`, `isNumeric(NaN) === false`. (Review Focus 5)
  - `zero rows fit only table`.
  - `variety switches the second of two bars to a table` and `leaves a bar alone when table is the previous type but bar is not allowed`.
- [ ] **Step 2: Run** `npx vitest run src/dashboard/tileTypes.test.ts` → FAIL.
- [ ] **Step 3: Implement** `tileTypes.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: pick dashboard tile types from data shape"`

---

### Task 8: Dashboard params and chart selection

**Files:**
- Create: `chart-gallery/web/src/dashboard/selection.ts`
- Test: `chart-gallery/web/src/dashboard/selection.test.ts`

**Interfaces:**
- Produces: `DEFAULT_MIN = 0.5`, `DEFAULT_MAX = 6`, `MODEL_WAIT_MS = 1500`.
- Produces: `type DashboardSource = { kind: 'chart'; id: number } | { kind: 'query'; q: string }`; `interface DashboardParams { source: DashboardSource | null; min: number; max: number }`; `parseDashboardParams(search: URLSearchParams): DashboardParams` — exactly one of `from` (via existing `parseChartId`) / non-blank `q` (trimmed, ≤ 200 chars) else `source: null`; `min`/`max` parsed, clamped, non-numeric → default; `max` rounded down. `dashboardHref(source: DashboardSource, min?: number, max?: number): string`.
- Produces: `interface Ranked { item: ChartSummary; confidence: number }`; `interface Selection { picked: { id: number; confidence: number | null }[]; usedFallback: boolean; belowThreshold: boolean }`; `selectCharts(input: { seed: ChartSummary | null; ranked: readonly Ranked[] | null; fallback: readonly ChartSummary[]; min: number; max: number }): Selection`.

Rules: `ranked === null` → use `fallback` (seed first, then fallback minus seed), apply only `max`, confidences `null`, `usedFallback: true`. Otherwise keep `confidence >= min`, seed first with `confidence: null`, cap at `max` total. Nothing passes → seed alone, or the best-ranked item alone when there is no seed, `belowThreshold: true`. No ranked items and no seed → `picked: []`.

- [ ] **Step 1: Write failing tests**
  - `parses from, min, max with clamping` — `?from=3&min=2&max=40` → `{source: {kind:'chart', id:3}, min: 1, max: 12}`.
  - `rejects both or neither source` — `?from=3&q=x` → `source: null`; `?` → `source: null`; `?q=%20` → `null`.
  - `bad numbers fall back to defaults` — `?q=x&min=abc&max=-1` → `min 0.5`, `max 1`.
  - `dashboardHref encodes the query` — `{kind:'query', q:'a&b'}` → `'/dashboard?q=a%26b'`.
  - `keeps confidence >= min, seed first, caps at max including seed`.
  - `falls back when ranked is null and ignores min`.
  - `below threshold keeps the seed alone` / `keeps the best match alone without a seed`.
- [ ] **Step 2: Run** `npx vitest run src/dashboard/selection.test.ts` → FAIL.
- [ ] **Step 3: Implement** `selection.ts` (import `parseChartId` from `../pages/DetailPage` or move it to a shared module if the import is circular).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: parse dashboard params and select charts"`

---

### Task 9: Rules layout spec

**Files:**
- Create: `chart-gallery/web/src/dashboard/rulesLayout.ts`
- Test: `chart-gallery/web/src/dashboard/rulesLayout.test.ts`

**Interfaces:**
- Consumes: `TilePlan`, `TILE_COMPONENT` (Task 6); `sharedTables` (`src/semantic/features.ts`).
- Produces: `tileKey(chartId: number): string` → `` `tile-${chartId}` ``; `orderTiles(plans: readonly TilePlan[]): TilePlan[]` — greedy cluster: take the first remaining plan, then every remaining plan sharing a table with it (rank order), repeat; `buildRulesSpec(plans: readonly TilePlan[]): Spec` (json-render `Spec`) — root `dashboard` (`Dashboard`, `summary: ''`) → one `section-1` (`Section`, `title: ''`) → tiles: all stat tiles first (`quarter`), then the rest in cluster order: every `line` → `full`; all other (non-stat, non-line) tiles form **one list** in cluster order, paired consecutively as `half`, and an odd leftover → `full`. To keep rows gap-free, walk in cluster order holding at most one unpaired half tile: the next non-line tile completes the pair; a line met while a tile is held is emitted right after that pair completes; a tile still held at the end becomes `full`.

- [ ] **Step 1: Write failing tests**
  - `stats come first at quarter width`.
  - `lines are full width; three mixed non-line tiles (bar, table, bar) are half, half, full`.
  - `a line between two bars does not split their pair` — cluster order bar, line, bar → spec order bar(half), bar(half), line(full).
  - `tiles sharing a table stay adjacent` — plans A(tables orders), B(inventory), C(orders) → order A, C, B.
  - `every element has children and the spec passes validateSpec` — `validateSpec(spec).valid === true`.
  - `tile element props are {chartId, width}` and each passes the catalog component's `props.safeParse`.
- [ ] **Step 2: Run** `npx vitest run src/dashboard/rulesLayout.test.ts` → FAIL.
- [ ] **Step 3: Implement** `rulesLayout.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: build the rules dashboard layout as a json-render spec"`

---

### Task 10: AI arrangement validation

**Files:**
- Create: `chart-gallery/web/src/dashboard/arrangement.ts`
- Test: `chart-gallery/web/src/dashboard/arrangement.test.ts`

**Interfaces:**
- Consumes: `catalog`, `TILE_COMPONENT`, `SUMMARY_MAX`, `TITLE_MAX`, `TilePlan`, `Headlines`.
- Produces: `type ArrangeResult = { ok: true; spec: Spec; summaryDropped: boolean } | { ok: false; reason: string }`; `validateArrangement(text: string, plans: readonly TilePlan[], headlines: Headlines): ArrangeResult`; `summaryNumbersMatch(summary: string, headlines: Headlines, counts: { tiles: number; sections: number }): boolean`.

Pipeline: drop lines that are code fences (```` ``` ````/```` ```jsonl ````); `compileSpecStream`; truncate `Dashboard.summary` to `SUMMARY_MAX` and `Section.title` to `TITLE_MAX` with a trailing `…`; `validateSpec` must be valid; reject a spec with `state` or any element with `on`, `watch`, `repeat`, `visible`; every element type known and `catalog.data.components[type].props.safeParse(props)` succeeds; root is `Dashboard`; root children are all `Section`; section children are all tiles; the multiset of tile `chartId`s equals the plan ids exactly once each; each tile's type is in `TILE_COMPONENT` of its plan's `allowed`. Then the summary check: on mismatch set summary to `''` and `summaryDropped: true`.

Summary numbers: match `/[-+]?\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|b|thousand|million|billion)?/gi`; value × suffix multiplier; tolerance `0.5 × 10^-decimals × multiplier`; a number matches if within tolerance of any numeric headline value; always allowed: integers 1900–2100, and integers equal to the tile count or the section count (not any small integer). Strip thousands separators before parsing.

- [ ] **Step 1: Write failing tests** (build valid JSONL from a helper that turns a `Spec` into patch lines)
  - `accepts a valid two-section arrangement`.
  - `ignores code fences and prose lines` — wrap valid JSONL in ```` ```jsonl ```` … ```` ``` ```` plus a `Here is your dashboard:` line → `ok: true`. (Review Focus 1)
  - `truncates an over-long summary and title instead of rejecting`.
  - `rejects a missing chart id`, `a duplicated chart id`, `an unknown chart id`.
  - `rejects a tile type outside allowed` (plan allowed `['bar','table']`, spec uses `LineTile`).
  - `rejects a string chartId` (per-component props check, json-render #378).
  - `rejects state and on`.
  - `rejects unparseable text` — `'not json'` → `ok: false`.
  - `drops only the summary when it cites an unknown number` — `summaryDropped: true`, sections intact.
  - `summaryNumbersMatch` cases: `"$8.2M"` vs value `8_212_000` → true; `"12%"` vs `pct_change 12.0` → true; `"1.82 million"` vs `1_823_000` → true; `"$9M"` vs `8_212_000` → false; `"in 2025"` → true; `"6 charts"` with 6 tiles → true; `"3 charts"` with 6 tiles and 2 sections → false; `"$8,200,000"` vs `8_212_000` → false and vs `8_200_000` → true (comma stripping).
- [ ] **Step 2: Run** `npx vitest run src/dashboard/arrangement.test.ts` → FAIL.
- [ ] **Step 3: Implement** `arrangement.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: validate AI dashboard arrangements"`

---

### Task 11: API client and live tile data

**Files:**
- Modify: `chart-gallery/web/src/api.ts`, `chart-gallery/web/src/test/mockApi.ts` (allow keying routes by `"POST /path"` in addition to the bare path)
- Create: `chart-gallery/web/src/dashboard/tileData.ts`
- Test: `chart-gallery/web/src/api.test.ts`, `chart-gallery/web/src/dashboard/tileData.test.tsx`

**Interfaces:**
- Produces (`api.ts`): `interface LiveData { rows: Row[]; columns: string[]; truncated: boolean; ran_at: string }`; `fetchChartData(id: number): Promise<LiveData>`; `interface ArrangeTile { chart_id: number; type: TileType; allowed_types: TileType[] }`; `arrangeDashboard(tiles: ArrangeTile[], signal?: AbortSignal): Promise<{ spec: string; headlines: Headlines }>` (POST JSON, same envelope/`ApiError` handling as `getJson`).
- Produces (`tileData.ts`): `type TileData = { status: 'loading' } | { status: 'live'; rows: readonly Row[] } | { status: 'snapshot'; rows: readonly Row[]; since: string }`; `resolveLiveRows(plan: TilePlan, live: LiveData): TileData` — `snapshot` (with `since = plan.chart.updated_at`) when live rows are empty or any row lacks `x_field` or a y field, else `live`; `effectiveType(plan: TilePlan, data: TileData): TileType` — `plan.type` unless the data is `live` and `fittingTypes(chart, rows)` excludes it → `'table'`; `useTileData(plans: readonly TilePlan[]): ReadonlyMap<number, TileData>` — one `fetchChartData` per chart id, all in parallel, never refetched for the same id while mounted; errors → `snapshot`.

- [ ] **Step 1: Write failing tests**
  - `api.test.ts`: `arrangeDashboard posts tiles as JSON and returns spec and headlines`; `fetchChartData surfaces a 429 as ApiError with status 429`.
  - `tileData.test.tsx`:
    - `live rows replace loading`.
    - `a failed request shows the snapshot with its date`.
    - `live rows missing the y column fall back to the snapshot` and `empty live rows fall back to the snapshot`. (Review Focus 3)
    - `a stat whose live data has several rows degrades to table` (`effectiveType`).
    - `requests run in parallel and are not repeated on rerender` (fetch mock call count == plan count after two renders).
- [ ] **Step 2: Run** `npx vitest run src/api.test.ts src/dashboard/tileData.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the `api.ts` additions, `mockApi` method keys, `tileData.ts`.
- [ ] **Step 4: Run** → PASS; `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: fetch live tile data with snapshot fallback"`

---

### Task 12: Tiles, registry and the animated view

**Files:**
- Modify: `chart-gallery/web/src/components/ChartView.tsx` (optional `horizontal?: boolean` for bar charts), `chart-gallery/web/src/styles.css`
- Create: `chart-gallery/web/src/dashboard/tiles.tsx`, `chart-gallery/web/src/dashboard/registry.tsx`, `chart-gallery/web/src/dashboard/transition.ts`, `chart-gallery/web/src/dashboard/DashboardView.tsx`
- Test: `chart-gallery/web/src/dashboard/DashboardView.test.tsx`, `chart-gallery/web/src/dashboard/transition.test.ts`

**Interfaces:**
- Consumes: `catalog`, `TilePlan`, `TileData`, `effectiveType`, `tileKey`.
- Produces (`tiles.tsx`): `TileContext` providing `{ plans: ReadonlyMap<number, TilePlan>; data: ReadonlyMap<number, TileData> }`; components `StatTile`, `LineTile`, `BarTile`, `StackedBarTile`, `TableTile` that read their plan/data by `chartId`, render title, small confidence text (`title` attribute and visible `aria-hidden` text, e.g. `0.72`), a skeleton while `loading`, `snapshot from <relativeTime(since)>` for snapshots, and the body for `effectiveType` (Stat: big formatted number or `—`; Line: `ChartView` line; Bar: `ChartView` bar `horizontal`, rows sorted by first y desc; StackedBar: one horizontal stacked recharts bar with `seriesColor` order and a legend; Table: `DataTable` sorted by first y desc). Each tile root sets `style={{ viewTransitionName: tileKey(chartId) }}` and a CSS grid span from `width` (`quarter` 3, `half` 6, `full` 12).
- Produces (`registry.tsx`): `registry` from `defineRegistry(catalog, { components })` incl. `Dashboard` (renders summary with an `AI summary` label when non-empty) and `Section` (renders an `h2` when `title` is non-empty, and a 12-column grid).
- Produces (`transition.ts`): `swapLayout(update: () => void): void` — `document.startViewTransition(() => flushSync(update))` when available and `matchMedia('(prefers-reduced-motion: reduce)')` does not match; otherwise `update()`.
- Produces (`DashboardView.tsx`): `DashboardView({ spec, plans, data, note }: { spec: Spec; plans: readonly TilePlan[]; data: ReadonlyMap<number, TileData>; note: string | null })` — `JSONUIProvider` + `Renderer`; shows `note` (e.g. `Arranged by rules`) in small text.

- [ ] **Step 1: Write failing tests**
  - `DashboardView.test.tsx` (use `ChartView`'s fixed `width` path or mock `ResponsiveContainer` as `ChartView.test.tsx` does):
    - `renders a rules spec with every tile title in plan order`.
    - `shows a skeleton while loading and the snapshot note on fallback`.
    - `a stat without a numeric value shows —`. (Review Focus 5)
    - `renders section headings and the AI summary label for an AI spec`.
    - `each tile has a view-transition-name from its chart id`.
  - `transition.test.ts`: `uses startViewTransition when available`; `calls update directly with reduced motion`; `calls update directly without the API`.
- [ ] **Step 2: Run** `npx vitest run src/dashboard/DashboardView.test.tsx src/dashboard/transition.test.ts` → FAIL.
- [ ] **Step 3: Implement** the files and the `horizontal` prop; add grid/tile/skeleton styles using existing CSS variables, and a short fade-in (`@keyframes`, disabled under `prefers-reduced-motion`) for section headings and the summary.
- [ ] **Step 4: Run** → PASS; `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: render dashboards with json-render and animate layout swaps"`

---

### Task 13: Dashboard page and route

**Files:**
- Create: `chart-gallery/web/src/dashboard/useDashboard.ts`, `chart-gallery/web/src/pages/DashboardPage.tsx`
- Modify: `chart-gallery/web/src/App.tsx` (lazy route `/dashboard` with `React.lazy` + `Suspense`)
- Test: `chart-gallery/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: everything above; `useChartList`, `useSemantic`, `useSimilar`, `useSemanticSnapshot`, `rankByTables`, `filterCharts`, `fetchChart`.
- Produces (`useDashboard.ts`): `useDashboard(params: DashboardParams, buildId: number): DashboardState` where `DashboardState = { status: 'invalid' } | { status: 'missing'; message: string } | { status: 'selecting' } | { status: 'ready'; plans: TilePlan[]; spec: Spec; note: string | null; belowThreshold: boolean; data: ReadonlyMap<number, TileData> }`.

Behaviour: wait until the ranking is usable (model `ready`, `useSimilar` non-null / `useSemantic` `resultQuery === q`) or `MODEL_WAIT_MS` passes, then call `selectCharts` **once** for this `buildId`, with `ranked = null` if not usable (fallback: `rankByTables` for a seed, `filterCharts` for a query); store the result in state and never recompute it from later ranking updates. `from=<id>` not in the chart list → `missing` `"Chart <id> was not found."`; empty selection → `missing` `"No charts match “<q>”."`. Fetch `ChartDetail` for picked ids in parallel, `planTiles`, `buildRulesSpec`, then call `arrangeDashboard` once per `buildId`; on success run `validateArrangement` and, if `ok`, `swapLayout` to the AI spec (note `null`); on any failure keep the rules spec with note `Arranged by rules`. Stop waiting after 8 s. **Late results are ignored:** when the arrange promise settles, drop it if `buildId` has changed, the 8 s timeout already fired, or the layout was already swapped (track with a per-build ref; also abort the fetch via `AbortController` on timeout/rebuild/unmount — add an optional `signal` param to `arrangeDashboard`).

Page: no source → message with link back to `/`. The page is never blank: the shell (heading, controls) renders immediately; during `selecting` it shows `Finding related charts…`; once plans exist, tiles render as skeletons until rows arrive. Controls: *Min score* (number, step 0.05), *Max tiles* (number), *Rebuild* (writes params via `setSearchParams` and bumps `buildId`). When `belowThreshold`, show `Lower Min score to see more charts.`.

- [ ] **Step 1: Write failing tests** (`renderApp('/dashboard?…')` with `mockApi` and the fake store; fake timers for the 1.5 s wait)
  - `builds a rules dashboard then swaps to the AI arrangement` — store `similar` answered; arrange returns valid JSONL for the picked ids → section heading visible, no `Arranged by rules`.
  - `keeps the rules layout when the AI call fails` — arrange 503 → `Arranged by rules` visible, all tile titles visible.
  - `falls back to table-overlap ranking after 1.5 s without the model`.
  - `does not change the selection when the model becomes ready later` — after the fallback build, update the store with a different `similar` answer → same tile titles, arrange called once.
  - `unknown from id shows a message with a link back` and `a query with no matches shows a message`. (Review Focus 4)
  - `missing source shows a link back to the gallery`.
  - `an AI result arriving after the 8 s timeout is ignored` — arrange resolves at 8.1 s (fake timers) → layout stays rules, `Arranged by rules` visible.
  - `shows the shell and Finding related charts… while selecting`.
  - `Rebuild writes min and max to the URL and rebuilds`.
- [ ] **Step 2: Run** `npx vitest run src/pages/DashboardPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `useDashboard.ts`, `DashboardPage.tsx`, the lazy route.
- [ ] **Step 4: Run** → PASS; `npx vitest run` and `npm run build` → PASS (check the build output puts json-render in a separate chunk).
- [ ] **Step 5: Commit** `git commit -m "feat: add the dashboard page"`

---

### Task 14: Semantic search and Build dashboard buttons

**Files:**
- Modify: `chart-gallery/web/src/pages/ListPage.tsx`, `chart-gallery/web/src/pages/DetailPage.tsx`
- Test: `chart-gallery/web/src/pages/ListPage.test.tsx`, `chart-gallery/web/src/pages/DetailPage.test.tsx`

**Interfaces:**
- Consumes: `useSemantic`, `filterCharts`, `dashboardHref`, `parseDashboardParams` (for an optional `min` on the list URL).

Behaviour: list page shows `filterCharts(charts, query)` until `useSemantic(query)` has `resultQuery === query.trim()`, then the beliefs' values in ranked order (filtered by `confidence >= min` only when the URL has `min`). Empty query → all charts as today. A non-empty query shows a **Build dashboard** link to `dashboardHref({kind:'query', q})`. The detail page shows a **Build dashboard** link to `dashboardHref({kind:'chart', id})`.

- [ ] **Step 1: Write failing tests**
  - `ListPage`: `shows substring matches until the semantic result arrives, then the ranked order` (fake store `results` for the query); `links Build dashboard to the query` (`href === '/dashboard?q=loyalty'`); `hides Build dashboard for an empty query`. Existing ListPage tests must still pass.
  - `DetailPage`: `links Build dashboard from this chart` (`href === '/dashboard?from=2'`).
- [ ] **Step 2: Run** `npx vitest run src/pages` → FAIL.
- [ ] **Step 3: Implement** both changes (inspect `semantic-state`'s `results` key format in `dist/` to build the fake store fixture).
- [ ] **Step 4: Run** `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: semantic gallery search with Build dashboard links"`

---

### Task 15: End-to-end test and docs

**Files:**
- Modify: `chart-gallery/web/scripts/e2e-gallery.sh` (export `WREN_MCP_URL=http://127.0.0.1:9/mcp`, unset `OPENROUTER_KEY`, set `GALLERY_PROMPT_PATH` to `../web/src/dashboard/arrange-prompt.md`), `README.md` (dashboard section: flow, params, `OPENROUTER_KEY`/`GALLERY_LLM_MODEL`, warm the model before a demo, rate limits and that they key on the peer address, so a reverse proxy needs `X-Forwarded-For` handling)
- Create: `chart-gallery/web/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: the seeded throwaway gallery from `e2e/gallery.spec.ts` (reuse its `SEEDS`/seeding by moving them to `e2e/seeds.ts`).

- [ ] **Step 1: Write the tests**
  - `search builds a rules dashboard with snapshot tiles` — go to `/`, type `store`, click **Build dashboard**, expect both store chart titles, `snapshot from` on each tile (Wren unreachable), and `Arranged by rules` (no key).
  - `AI arrangement moves tiles into sections` — `page.route('**/api/dashboards/arrange', …)` reads the request's `tiles` and fulfills with a valid JSONL spec putting them in a `Stores` section with summary `"Store performance at a glance."` (no numbers, so the summary check cannot make the test fragile) and `headlines: {}`; open `/dashboard?from=1`; expect heading `Stores`, the `AI summary` label, and no `Arranged by rules`.
- [ ] **Step 2: Run** `cd chart-gallery/web && npm run e2e` → PASS (both new and existing specs).
- [ ] **Step 3: Write the README section.**
- [ ] **Step 4: Smoke-test the real model** (research marked OpenRouter behaviour unverified): with `OPENROUTER_KEY` set, `docker compose up -d --build chart-gallery`, open a dashboard, and confirm in the browser that the AI layout lands (no `Arranged by rules`). If the model wraps or garbles JSONL, record what it did in the README and adjust the prompt or `GALLERY_LLM_MODEL`.
- [ ] **Step 5: Full verification** — `cd chart-gallery/api && uv run pytest`; `cd ../web && npx vitest run && npm run build && npm run e2e`; `docker compose config -q` → all PASS / no output.
- [ ] **Step 6: Commit** `git commit -m "test: add dashboard e2e tests and document the dashboard builder"`
