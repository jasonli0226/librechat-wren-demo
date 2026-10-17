# Dashboard builder — design

Status: draft
Research: `docs/research/json-render.md`
Date: 2026-10-17

## Intent

The chart gallery collects charts the Retail Analyst saved from LibreChat chats. Today a visitor
can browse them one at a time and see three related charts on a detail page. This feature turns
one search (or one chart) into a full dashboard: the gallery picks the related charts, re-runs
each chart's SQL live, chooses a fitting tile type for each, lays them out, and then lets an LLM
regroup the tiles into named sections with a one-line summary — visibly, while the user watches.

It is a **demo**. The moment it must deliver: *one search turns into a full dashboard in
seconds.* A second motivation is to try Vercel's json-render (an LLM emits a JSON UI spec
constrained to a component catalog; the app renders it).

## Goals

- From the gallery search results, or from a chart's detail page, one click builds a dashboard.
- Related charts are chosen by the existing `semantic-state` ranking, with a minimum score and a
  maximum tile count the user can change (URL params and controls on the page).
- Gallery search becomes semantic (query embedding), with the same params.
- Every tile shows **live** data: its saved SQL is re-run through Wren when the page loads.
- Tile types are chosen by deterministic rules from the shape of the data, with variety between
  neighbours.
- An LLM arranges the tiles into sections plus a summary via json-render; tiles animate from the
  rules layout into the AI layout.
- A rules-only layout is on screen in about two seconds; the AI arrangement lands within roughly
  three to six seconds.

## Non-goals

- Saving, naming, sharing or editing dashboards. Every dashboard is built fresh.
- Filters (date range, store, …) on the dashboard. "Static" means no filters; data is still live.
- Deduplicating charts (TODO.md #1). Duplicate charts may appear as two identical tiles.
- Letting the LLM write SQL, change data, or pick which charts are included.

## Anti-goals (failure even if it technically works)

- The dashboard takes long enough that the "in seconds" moment is lost (blank page while waiting
  for the model, or tiles waiting on each other).
- The summary states a number that is not in the data.
- The browser can trigger arbitrary SQL.
- An LLM failure leaves the user with nothing; the rules layout must always stand on its own.

## Constraints and current state

- `chart-gallery/web`: Vite + React 19 SPA, react-router 8, recharts 3, `semantic-state`
  `0.1.0-experimental.1` running in a web worker with a bundled embedding model (~23 MB, served by
  the gallery; no CDN). The list page warms the model up.
- `chart-gallery/api`: Python FastAPI + SQLite. Stores each chart's `title`, `description`,
  `chart_type` (`line|bar|pie`), `x_field`, `y_fields`, `sql`, `rows` (snapshot at save time, max
  200), and the tables the SQL touches. Public read endpoints: `GET /api/charts`,
  `GET /api/charts/{id}`. Bearer-token `POST /internal/charts` for `save_chart`.
- Saved SQL is written against Wren's semantic models (MDL), so it must run through Wren, not
  directly against Postgres.
- `wren-mcp` exposes `run_sql` over MCP streamable HTTP at `http://wren-mcp:7080/mcp` on the
  compose network (read-only role `wren_ro`, `MCP_ROW_LIMIT=200`, DNS-rebinding host allowlist; no
  auth on the port, published to loopback only).
- LLM access already exists for LibreChat through OpenRouter (`OPENROUTER_KEY`).
- Gallery Host-header allowlist (`GALLERY_ALLOWED_HOSTS`) and body-size middleware stay in force.

## Decided by the user

- Start points: gallery search, or a chart. Flow: gallery → search/select → **Build dashboard** →
  dashboard.
- Inclusion: score threshold + max count, adjustable by the user via params.
- Search uses `semantic-state` and takes params.
- Live data via SQL re-run; no filters.
- Built fresh, demo only.
- Layout option **B**: rules first, then AI arrangement with Vercel json-render.
- Tiles **visibly move** into the AI's sections.
- Live SQL path: the gallery API calls `wren-mcp`'s `run_sql` as an MCP client (option A).
- Dedup skipped.

## Design

### 1. Flow and routes

- `/` (list page): the search box ranks semantically (below). When the query is non-empty, a
  **Build dashboard** button links to `/dashboard?q=<query>&min=<score>&max=<count>`.
- `/charts/:id` (detail page): a **Build dashboard** button links to
  `/dashboard?from=<id>&min=…&max=…`.
- `/dashboard`: new page. Exactly one of `q` or `from` is required; otherwise show a short message
  with a link back to the gallery. `min` and `max` are optional and clamped (below). The page
  shows the controls *Min score*, *Max tiles* and *Rebuild* (which rewrites the URL params).

### 2. Picking the charts

- `from=<id>`: `useSimilar(id, max)` from `semantic-state`; the seed chart is always tile one.
- `q=<text>`: `useSemantic(q)`; take ranked items in order.
- Keep items whose **`confidence`** ≥ `min`, cap at `max` (including the seed). `min` always
  compares against `semantic-state`'s `confidence` (0–1), never the raw `score`: `useSemantic`
  query scores are text-only while `useSimilar` scores mix text and table overlap, so raw scores
  are on different scales for the two entry points. *(Builder-check call.)* Defaults (builder's call,
  tune on real data): `min=0.5`, `max=6`; clamp `min` to `[0, 1]` and `max` to `[1, 12]`.
- While the model is still loading, wait up to ~1.5 s for it. If it is still not ready, fall
  back as the gallery already does: `rankByTables` for a seed chart, substring `filterCharts` for
  a query (fallback rows have no comparable score, so apply only `max`).
- `useSimilar` returns `null` while it is still ranking, and `useSemantic` belief order can
  shift under its commit policy. Selection code treats `null` the same as "model not ready"
  (use the fallback), and reads **one snapshot** of the ranking at build time and copies it; the
  dashboard never renders from the live beliefs stream.
- **The selection is fixed once the rules layout is built.** It does not refine when the model
  finishes loading later, so the AI request always matches what is on screen and there is never
  a second paid call or a second animation. *Rebuild* re-runs selection with the model ready.
  *(Builder-check call.)*
- Each tile shows its `confidence` in small text (e.g. on hover), so tuning *Min score* is not
  blind.
- If nothing passes the threshold: show the seed chart (or the best match) alone plus a hint to
  lower *Min score*.

Scores are cosine similarities from a small model and are not calibrated; the defaults are a
starting point, not a contract. That is why the user can change them.

### 3. Semantic search on the list page

Replace the substring-only filter with `useSemantic(query)` ranking, keeping `filterCharts` as the
instant answer until the worker has a result for the current query (`resultQuery === query`).
Only results with `confidence` ≥ `min` are shown when a `min` param is present; otherwise show the ranked
list. Exact matching rules for ties and empty queries are the builder's call.

### 4. Live data endpoint

`GET /api/charts/{id}/data` → `{ success, data: { rows, columns, truncated, ran_at } }`.

- The server loads the chart's stored `sql` by id and runs it through `wren-mcp`'s `run_sql`
  tool via the Python `mcp` client (streamable HTTP). The browser never sends SQL.
- Config: `WREN_MCP_URL` (default `http://wren-mcp:7080/mcp`); add it to compose and the
  `wren-mcp` `MCP_ALLOWED_HOSTS` already covers `wren-mcp:*`.
- Row cap: 200 (same as `save_chart`). Timeout per query: builder's call, around 10 s.
- Reuse one MCP session per process where practical; the handshake should not run per tile.
- On failure (Wren error, timeout, MCP unreachable, rate limited) return an error envelope with
  a short message; the tile then falls back to the stored snapshot `rows` with a visible
  "snapshot from <date>" note, where the date is the chart's `updated_at` (rows are rewritten on
  every update, so `updated_at` is when they were captured). Log details server-side, not in the response.
- **Required:** a per-client rate limit and a global concurrency cap on this endpoint. It is
  public and ids are enumerable, so without a limit anyone can hammer Wren with 200-row queries.
  Only the mechanism (in-process token bucket or similar) is the builder's call. Over the limit →
  HTTP 429 in the error envelope; the tile shows its snapshot.
- The browser requests all tiles in parallel; each tile renders as its own data arrives.

### 5. Tile type rules

Run on the **snapshot rows** from `GET /api/charts/{id}` (fast, already stored) plus
`x_field`/`y_fields`, so the rules layout never waits on Wren. The saved `chart_type` is a hint,
not a rule. When live rows arrive, the tile keeps its type and swaps in the live data; only if
the live data no longer fits that type (e.g. a Stat that now has several rows) does the tile fall
back to Table in place, without moving. *(Builder-check call.)* First match wins:

| Data shape | Tile |
|---|---|
| 1 row and 1 numeric y | **Stat** (big number, title) |
| x values are dates/timestamps | **Line** (one line per y, one shared axis) |
| more than ~20 rows, or several y fields with very different scales | **Table** (sorted by first y, descending) |
| category x with ≤ 7 values, one y, and saved `chart_type` is `pie` | **Stacked bar** (single horizontal bar of parts) |
| category x otherwise | **Bar** (horizontal, sorted by value) |

Part-of-a-whole cannot be detected from rows alone, so the only trigger for Stacked bar is a
saved `pie`. Line is checked before the >20-rows Table rule on purpose: a 200-point time series
reads fine as a line.

Variety pass: walk tiles in order; if a tile has the same type as the previous tile *and* another
type in the table also fits its data, switch to that alternative (Bar ↔ Table). Never pick a form
the data does not fit. No dual-axis charts. Chart styling follows the gallery's existing look.

Each rule-picked type is recorded on the tile so the AI step sees it, and so tests can assert it.

### 6. Rules layout (always rendered first)

12-column grid:

- Row 1: Stat tiles, 3 columns each (up to 4 per row; `width: "quarter"`).
- Line tiles: full width.
- Bar, Stacked bar and Table tiles: half width, packed two per row in tile order; a leftover
  single tile takes full width.
- Tile order: seed (or best match) first, then by score, with tiles that share a warehouse table
  kept adjacent (use `sharedTables`).

The rules layout is itself expressed as the same spec the AI returns (section 7), with one
untitled section. That gives one renderer and makes the AI step a spec-to-spec rewrite.

### 7. AI arrangement with json-render

Facts below come from `docs/research/json-render.md` (json-render 0.21.1, researched 2026-10-17).

**Packages.** Add `@json-render/core` and `@json-render/react`, pinned to an exact version
(`0.21.1`; pre-1.0, minor releases have broken APIs), and `zod` 4 (a hard dependency of core).
React 19.3 satisfies the `^19.2.3` peer range. Expect roughly 110 KB gzip added; load it with the
dashboard route (lazy import) so the list and detail pages do not pay for it.

**Catalog** (names indicative), each declared with a zod props schema:

| Component | Props | Children |
|---|---|---|
| `Dashboard` | `summary: string` (≤ 200 chars) | `Section`s |
| `Section` | `title: string` (≤ 60 chars) | tiles |
| `StatTile`, `LineTile`, `BarTile`, `StackedBarTile`, `TableTile` | `chartId: number`, `width: "quarter" \| "half" \| "full"` | none (`children: []`) |

Length caps on `summary` and `title` are **truncated** (with an ellipsis) before validation, not
rejected, so an over-long string does not throw away the whole layout. Structure, type and
chart-id violations are still hard failures.

Every element carries `children` (json-render requires the key, even when empty). No `state`,
`on`, `watch`, `repeat` or actions: the dashboard has no interactivity in the spec and no data.
Tiles look up their rows from the live-data cache by `chartId`.

**Spec format.** json-render's flat form, `{ root, elements: { key: { type, props, children } } }`,
emitted by the model as JSONL patch lines. The rules layout (section 6) is built in the same form,
with one untitled `Section`.

**Prompt.** Do **not** use the default `catalog.prompt()` output: it instructs the model to invent
"realistic sample data", which contradicts the rule that the model never writes data, and it is
~16k characters. Use a hand-written compact system prompt that:

- lists the catalog components, their props and allowed children;
- shows one complete JSONL example;
- states the rules: use each given chart id exactly once; a tile may only use a type from that
  tile's `allowed_types`; at most ~4 sections; the summary may only cite values from the given
  headline data; output JSONL only.

Keep the prompt as a text file **in the web package next to the catalog** (e.g.
`web/src/dashboard/arrange-prompt.md`), so one package owns both and a web unit test can fail if
the prompt does not mention every catalog component and prop. The Dockerfile copies that file into
the runtime image (the build context already includes `web/`), and the API reads it from a path
in settings (`GALLERY_PROMPT_PATH`). The prompt is always server-side; the browser never sends
prompt text. (Builder may instead use `defineSchema(..., { promptTemplate })` if it
yields the same compact prompt.)

**Endpoint.** `POST /api/dashboards/arrange`, body validated with pydantic:

```json
{ "tiles": [ { "chart_id": 12, "type": "bar", "allowed_types": ["bar", "table"] } ] }
```

- 1–12 tiles, unique chart ids that exist. Titles, descriptions, tables **and headline values**
  are computed server-side from the database row for each id (snapshot rows), not taken from the
  request, so the request carries no free text the model would read.
- The server calls OpenRouter's OpenAI-compatible chat completions with `OPENROUTER_KEY`, model
  `GALLERY_LLM_MODEL`, low temperature, a server-side timeout (~8 s) and a max-token cap.
- Response: `{ "spec": "<the model's raw JSONL text>", "headlines": { "<chart_id>": {…} } }` in
  the success envelope, so the browser can run the summary check against exactly the values the
  model saw (one-shot, not streamed — the
  page validates the whole spec before animating once, so streaming would not show sooner).
- Missing `OPENROUTER_KEY` → the endpoint returns a clear "AI arrangement disabled" error and the
  page stays on the rules layout. The gallery must still start without the key.
- **Required:** a per-client rate limit and a global cap on calls per minute, because it is
  public and spends a paid API key. Only the mechanism is the builder's call. Over the limit →
  HTTP 429; the page stays on the rules layout. Log failures server-side without the key or the
  full prompt.

**Validation in the browser**, all of which must pass before rendering:

1. `compileSpecStream(text)` → spec; then `validateSpec` for structure.
2. Our own per-element check: known `type`, then that component's zod `props.safeParse`
   (`catalog.validate()` skips per-component props in multi-component catalogs, json-render issue
   #378).
3. App checks: root is a `Dashboard`; every tile chart id appears exactly once; no unknown ids;
   each tile's type is in its `allowed_types`; sections hold only tiles.

4. Summary check: extract the numbers in `summary` and match each against the headline values
   sent, tolerant of formatting (`1823000` ≈ "$1.8M" ≈ "1.82 million": compare after parsing
   suffixes, within the rounding the text shows). Years and small counts that equal a tile count
   are allowed. If a number does not match, **drop only the summary** and keep the sections.
   Derived numbers ("revenue grew 12%") would not match a raw value, so the server-computed headline
   includes the derived values a summary is likely to cite — for line tiles the first value, last
   value and percent change; for bars the top item's share of the total — and the prompt says to
   cite only numbers from the headline. Expect occasional over-drops anyway; this is visible in
   the demo (the summary silently disappears) and acceptable.
   *(Builder-check call.)*

Any failure in steps 1–3 → keep the rules layout and show "Arranged by rules". No repair round-trip to the
model (it would blow the time budget). `autoFixSpec` may be used for lossless fixes only.

**Rendering.** `defineRegistry(catalog, { components })` maps catalog types to our React tiles;
`<Renderer>` sits inside `JSONUIProvider`. The same renderer draws both the rules layout and the
AI layout, so the swap in section 8 is a spec change, not a different component tree.

**Summary text** is shown with a small "AI summary" label.

### 8. "Watch it organize itself"

- When the AI spec passes validation, swap layouts inside `document.startViewTransition`, with a
  `view-transition-name` per tile derived from the chart id, so each tile glides to its new
  section. Section headings and the summary fade in.
- Tile data is fetched once and cached by chart id; the swap never refetches or shows skeletons.
- Browsers without the View Transitions API jump to the final layout. Respect
  `prefers-reduced-motion` by skipping the animation.

### 9. Speed budget

- Rules layout visible within ~2 s on a warm page (model loaded, data requests in parallel).
- Before a demo, open the gallery once so the browser caches the embedding model.
- The AI request starts as soon as the rules layout is built. Headline values come from the
  snapshot rows, so it does not wait for live queries. The summary therefore describes the
  snapshot; that is acceptable for the demo. *(Builder-check call.)*

## Testing (expectations, not a plan)

- Unit: selection (threshold, cap, seed first, fallback), tile type rules and variety pass, rules
  layout packing, spec validation (duplicate/missing/unknown ids, disallowed types).
- API: `/api/charts/{id}/data` with a fake MCP client — success, Wren error, timeout, unknown id,
  row cap; arrange endpoint with a fake LLM — valid spec, invalid output, timeout, missing key.
- E2E (existing Playwright setup, throwaway gallery): search → Build dashboard → tiles render;
  AI step stubbed for determinism. E2E runs without Wren, so stub the MCP call too, and have one
  test assert the snapshot fallback note when the data call fails.

## Left to the builder

- Exact defaults for `min`/`max` after trying real data; query timeouts; rate-limit mechanism.
- Component and file names; styling within the gallery's existing look.
- Headline-value extraction details per tile type.
- The LLM model id default.
