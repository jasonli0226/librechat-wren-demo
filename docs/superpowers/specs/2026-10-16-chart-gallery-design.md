# Chart Gallery — Design

Date: 2026-10-16
Branch: `feat/chart-gallery`
Status: approved in brainstorming, pending written-spec review

## 1. Goal

When a user asks the Retail Analyst a data question and it produces a chart, the chart is
stored with a title and a description. A separate gallery web app lists every stored chart.
Clicking a chart opens a detail page that renders it and suggests related charts, ranked by
meaning of title + description (via [`semantic-state`](https://github.com/jasonli0226/semantic-state))
plus overlap of the warehouse tables the charts query.

### Success criteria

- Asking a chart question in LibreChat stores the chart in the gallery with no manual step,
  and the analyst's reply links to the gallery detail page.
- Re-asking the same question (SQL differing only in whitespace, keyword/identifier casing,
  comments or formatting) updates the
  existing chart instead of creating a duplicate. SQL using different alias names or a different
  `LIMIT` counts as a different chart.
- Every stored number comes from SQL executed by Wren, never from model-supplied data.
- The detail page shows up to 5 related charts that a person would agree are related.
- `./setup.sh` still brings up the whole demo in one command.

### Out of scope

Editing or deleting charts in the UI, per-user galleries, auth on the read API, semantic
(meaning-level) dedup, forking LibreChat, chart types beyond line/bar/pie.

## 2. Decisions

| Question | Decision | Reason |
|---|---|---|
| How charts are captured | New MCP tool `save_chart` the analyst calls after each chart | Automatic, structured, no LibreChat fork |
| Where the gallery lives | Separate app/container on `127.0.0.1:3090` | LibreChat is a stock image; a fork is heavy to maintain |
| Where rows come from | Wren re-runs the SQL; the model never sends data | Numbers are guaranteed real; fewer tokens |
| Where `save_chart` lives | Added to the existing `wren-mcp` server (`serve_mcp.py`) | Same SQL dialect, row cap and read-only role as `run_sql` |
| Who owns chart storage | `chart-gallery` service (FastAPI + SQLite) | One owner; warehouse stays read-only; wren-mcp needs no write creds |
| Dedup key | `sha256(normalized_sql + chart_type)`, upsert on conflict | Raw SQL text is too brittle; bar vs pie of one query are different charts |
| Ranking signal | Embedding of title + description, plus a small shared-tables boost | Raw SQL embeds poorly (every query shares SELECT/SUM/GROUP BY) |
| Rendering | Declarative spec rendered by the gallery with recharts | Never execute model-generated JSX (XSS / code execution) |

## 3. Architecture

```
LibreChat ──MCP──▶ wren-mcp
                    ├─ existing tools (run_sql, dry_run, ...)
                    └─ save_chart ── run SQL via Wren (wren_ro, ≤200 rows)
                                  └─ POST /internal/charts (Bearer token) ──▶ chart-gallery :3090
                                                                                ├─ FastAPI + SQLite (volume)
                                                                                ├─ GET /api/charts, /api/charts/{id}
                                                                                └─ React SPA (list, detail, related)
```

### Data flow

1. User asks a question; the analyst runs SQL and draws a recharts artifact as today.
2. Prompt rule: after each chart, call
   `save_chart(title, description, chart_type, sql, x_field, y_fields)`.
3. `save_chart` executes the SQL through Wren's execution path (same as `run_sql`: read-only
   `wren_ro` role, 200-row cap), checks that `x_field` and every `y_fields` entry are result
   columns and that y values are numeric, then POSTs spec + rows to the gallery.
4. The gallery normalizes the SQL, extracts tables, computes `dedup_key`, upserts, and returns
   `{id, url, status: "created" | "updated"}`.
5. The tool returns the URL; the analyst links it in the reply.
6. The browser loads the gallery SPA, which fetches charts, renders them from the spec and
   ranks related charts client-side.

### Chart types

`line | bar | pie`, matching the analyst prompt. Line/bar: `x_field` on the x-axis, one series
per `y_fields` entry (1–5). Pie: `x_field` is the slice label, `y_fields[0]` the value
(exactly one y field allowed).

## 4. Components

### 4.1 `save_chart` tool (wren-mcp)

- Registered inside the `build_server` wrapper in `wren/scripts/serve_mcp.py`; the tool logic
  lives in its own module (e.g. `wren/scripts/chart_tool.py`) so it can be unit-tested without
  starting the server.
- Inputs: `title` (≤120), `description` (≤500), `chart_type`, `sql`, `x_field`, `y_fields`.
- Executes the **original** SQL (never the normalized form) with the same call `run_sql`
  uses: `wren.mcp_server._query_with_limit_probe(ctx, sql, 200)` in `wrenai==0.15.0`. It
  returns `{columns, rows, truncated}`; `columns` are the result-set column names and values
  have already passed Wren's `_normalize_value` (`Decimal` → float, dates → ISO strings,
  NaN/inf → `None`).
- Runs as the SELECT-only `wren_ro` role (`retail-db/02-readonly-role.sh`), so re-execution
  cannot change warehouse state.
- Re-execution means the gallery stores the result at save time. If the warehouse changed
  between the analyst's `run_sql` and `save_chart`, the gallery shows the newer numbers. The
  demo warehouse is static, so this is accepted; "numbers are real" outranks "numbers match
  the chat byte for byte".
- Validation, all against the **result set**, not the SQL text:
  - `chart_type` must be `line`, `bar` or `pie`. Anything else (area, scatter, …) is rejected
    with "save_chart supports line, bar, pie; the chart was not saved". The chat answer and
    its artifact are unaffected.
  - `x_field` and every `y_fields` entry must be in `columns` (exact match, as Postgres
    returns them); otherwise the message lists the available columns.
  - Numeric y: every non-null value is a Python `int` or `float` and not `bool`. No string
    coercion: `money` or formatted text (`'$1,234.56'`) is rejected with a hint to cast to
    `numeric` in SQL. `None` is allowed (gap in the series).
  - `truncated` must be false; otherwise the message asks to aggregate further.
- Env: `CHART_GALLERY_URL` (internal, e.g. `http://chart-gallery:3090`) and
  `CHART_GALLERY_TOKEN`. The public link comes back from the gallery, which builds it from
  its own `GALLERY_PUBLIC_URL` (e.g. `http://localhost:3090`).
- Errors returned as a clear tool message, never an exception that breaks the chat: SQL error,
  any validation failure above, wrong y count for pie, gallery unreachable or rejecting the
  request.
- New dependency: `httpx` (or stdlib `urllib`) in `wren/Dockerfile`.

### 4.2 `chart-gallery` service

New directory `chart-gallery/`:

- `api/` — FastAPI app, Pydantic models, SQLite repository, SQL normalizer.
- `web/` — Vite + React + TypeScript SPA.
- `Dockerfile` — multi-stage: Node builds `web/`, Python image runs FastAPI and serves the
  built static files with SPA fallback for `/charts/:id`.

#### SQLite table `charts`

| column | type / rule |
|---|---|
| `id` | INTEGER PRIMARY KEY |
| `dedup_key` | TEXT UNIQUE NOT NULL |
| `title` | TEXT NOT NULL, 1–120 chars |
| `description` | TEXT NOT NULL, 1–500 chars |
| `chart_type` | TEXT CHECK IN (`line`,`bar`,`pie`) |
| `x_field` | TEXT NOT NULL |
| `y_fields` | TEXT (JSON array, 1–5 entries; exactly 1 for pie) |
| `sql` | TEXT NOT NULL (original, shown on detail page) |
| `normalized_sql` | TEXT NOT NULL |
| `tables` | TEXT (JSON array, sorted, lowercased, unique) |
| `rows` | TEXT (JSON array of objects, ≤200) |
| `created_at`, `updated_at` | TEXT (ISO 8601 UTC) |

Database file on Docker volume `gallery_data`; schema created on startup if missing. There
are no migrations: a breaking schema change means wiping the volume
(`docker compose down` then `docker volume rm <project>_gallery_data`), noted in the README.

Concurrency: Uvicorn runs with **one worker**, and the connection enables
`PRAGMA journal_mode=WAL` and `busy_timeout=5000` on open. Writes are rare (one per saved
chart), so one writer is enough.

`normalized_sql` is used only for the dedup key. It is never executed and never compared with
`x_field`/`y_fields`.

#### SQL normalization and dedup

- `sqlglot.parse_one(sql, read="postgres")` then re-emit with `normalize=True`, comments
  stripped, standard formatting. Trailing `LIMIT` is kept (it changes the result).
- Tables: every `exp.Table` name in the parsed tree, lowercased, deduplicated, sorted;
  CTE names excluded.
- If parsing fails: fallback normalization = strip comments, collapse whitespace, lowercase;
  `tables = []`. The save still succeeds.
- `dedup_key = sha256(normalized_sql + "|" + chart_type)`.
- On conflict: update `title`, `description`, `x_field`, `y_fields`, `sql`, `rows`,
  `updated_at`; keep `id` and `created_at`.

#### HTTP API

All responses use the envelope `{ "success": bool, "data": ..., "error": string | null }`.

| Method & path | Auth | Behaviour |
|---|---|---|
| `POST /internal/charts` | `Authorization: Bearer <CHART_GALLERY_TOKEN>`, constant-time compare | Validate, normalize, upsert. 200 `{id, url, status}`. 401 on missing/wrong token, 422 on invalid body |
| `GET /api/charts` | none | All charts, newest `updated_at` first, **without** `rows` and `sql`: `id, title, description, chart_type, tables, updated_at`. No pagination: about 300 bytes per chart, and related-chart ranking needs the whole set on the client anyway. Revisit past ~5,000 charts |
| `GET /api/charts/{id}` | none | Full record incl. `rows`, `sql`, fields. 404 if missing |
| `GET /healthz` | none | 200 when the DB is reachable |

The service refuses to start if `CHART_GALLERY_TOKEN` is unset or shorter than 32 chars.
Request bodies are capped (e.g. 1 MB). Logs record chart id and status only — never rows,
SQL or the token.

### 4.3 Gallery SPA

Stack: Vite, React, TypeScript, `react-router`, `recharts`, `semantic-state` pinned to the
exact version `0.1.0-experimental.1`, `@huggingface/transformers` for the embedding worker.

- **List `/`** — card grid: title, clamped description, chart-type badge, table chips, relative
  updated time. Client-side substring filter on title + description. Empty state explains how
  to create a chart from LibreChat.
- **Detail `/charts/:id`** — chart rendered from the spec, title, description, SQL in a
  collapsible code block, link back to LibreChat (`http://localhost:3080`). Unknown id → not
  found view.
- **Related charts** — top 5 on the detail page, each card showing why it matched
  ("similar topic", "shares `orders`, `stores`").

#### Ranking

- Embedding text per chart: `title + ". " + description`, embedded in a Web Worker
  (semantic-state's transformers.js worker setup, default English model; exact model id
  confirmed while planning).
- **Model served locally.** The Docker build downloads the model weights (~23 MB) into the
  image, and the gallery serves them under `/models/`. The worker sets transformers.js
  `env.allowRemoteModels = false` and `env.localModelPath = "/models/"`, so the browser never
  contacts Hugging Face. Only the image build needs internet, as it already does for pip/npm.
- Implemented with semantic-state's `useSimilar(id, k)`. Its worker scores neighbours as a
  weighted average of per-feature cosines (custom scorers do not apply to `useSimilar`), so
  the table boost is a second feature: `tables` = a unit-length one-hot vector over all table
  names. Weights `{ text: 1, tables: TABLE_WEIGHT }` with `TABLE_WEIGHT = 0.15` in one module.
  Effective score: `(cos_text + 0.15 × cos_tables) / 1.15`, where `cos_tables` is the Ochiai
  overlap of the two table sets (same ordering effect as the Jaccard boost first proposed).
  The current chart is excluded by `useSimilar`.
- `useSimilar` only re-requests on id/status/weights changes, so the app's
  `useRelatedCharts` hook calls `store.requestSimilar` again once embedding finishes.
- Before the model is ready (first load fetches ~23 MB from the gallery, then browser-cached):
  items have only the `tables` feature, so the same `useSimilar` call ranks by table overlap.
  The list is labelled "refining…" and re-requested when embeddings are ready.
- If the model fails to load, the worker posts one error message and stops. There is no retry:
  the embedder is wrapped so that after the first load failure every later call fails at
  once (semantic-state's transformers embedder would otherwise retry on the next batch).
  The table-overlap list stays (the "refining…" label is removed) and no error wall is shown.
  Model loading and embedding run only in the worker, so a failure never blocks the main
  thread.

## 5. Config and docs changes

- `docker-compose.yml`: new `chart-gallery` service (`127.0.0.1:3090:3090`, volume
  `gallery_data`, healthcheck on `/healthz`, `restart: unless-stopped`); `wren-mcp` gets
  `CHART_GALLERY_URL`, `CHART_GALLERY_TOKEN`, `CHART_GALLERY_PUBLIC_URL`.
- `scripts/gen-env.sh`, `.env.example`: generate `CHART_GALLERY_TOKEN`.
- `librechat/librechat.yaml`: analyst prompt rule 8 — after creating a chart, call
  `save_chart` with a concise title and a one-to-two sentence description, then include the
  returned link. Same hint in the `wren` `serverInstructions`.
- `wren/project/knowledge/rules/retail.md`: chart policy mentions saving to the gallery.
- `setup.sh`: wait for gallery health; print the gallery URL.
- `librechat` service env: `CUSTOM_FOOTER` with a link to the gallery. Confirmed in
  `librechat/librechat:v0.8.8`: `api/server/routes/config.js` passes `CUSTOM_FOOTER` to the
  client. Whether the footer renders it as a clickable Markdown link is checked during
  implementation; if not, it shows the plain URL.
- README: gallery section, updated architecture diagram and repo layout, privacy note (chart
  text is ranked in the browser; model weights are served by the gallery itself), and the
  volume-wipe note for schema changes.

## 6. Testing

TDD, 80%+ coverage for new code.

- **Gallery API (pytest)** — normalization: whitespace/case/comment variants share one key; bar
  vs pie of the same SQL get different keys; table extraction ignores CTE names; parse-failure
  fallback; upsert keeps `id`/`created_at` and refreshes the rest; Pydantic limits (lengths,
  y count, pie rule, 200 rows); missing/wrong token → 401; list omits `rows`/`sql`; unknown
  id → 404; startup refuses a short token.
- **`save_chart` (pytest)** — Wren execution and gallery HTTP mocked: unsupported chart type,
  unknown field, non-numeric y (string, `bool`), `None` y allowed, truncated result, SQL
  error, gallery down/401 → clear tool message; happy path posts the expected payload and
  returns the public URL.
- **SPA (vitest + Testing Library)** — scorer (weighting, self excluded, table-only fallback
  order), worker failure keeps the fallback list and clears "refining…", list filter, detail
  renders line/bar/pie from a spec, not-found view.
- **E2E (Playwright)** — against the compose stack: seed charts through
  `POST /internal/charts`, open the list, click a card, detail shows the chart and a related
  list.
- **`scripts/smoke-test.sh`** — gallery healthy; `GET /api/charts` succeeds; POST without
  token → 401; POST with token and an empty body → 422 (proves the token is accepted without
  adding a chart to the demo gallery); Wren MCP `tools/list` includes `save_chart`.

## 7. Risks

- **Model forgets to call `save_chart`.** Mitigated by explicit prompt rules in both the
  preset and `serverInstructions`; observable in smoke testing with real prompts.
- **`semantic-state` is experimental.** Exact version pinned; ranking isolated behind one
  hook/module so it can be swapped.
- **Wren internal API.** `save_chart` depends on wrenai internals the same way `serve_mcp.py`
  already does; pinned `wrenai==0.15.0`.
- **First detail-page load is slow** (model fetched from the gallery once). Table-overlap
  fallback keeps the page useful meanwhile.
