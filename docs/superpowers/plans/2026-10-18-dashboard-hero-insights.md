# Dashboard Hero, Insights and Scatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the most relevant chart the dashboard's two-thirds-width hero with an AI insights sidebar, and add scatter as both a saved chart type and a dashboard tile type.

**Architecture:** Shape rules (line-shaped, scatter axes) are defined once in TypeScript and once in Python, and both are pinned by one shared JSON fixture file. The json-render tree becomes Dashboard → [Hero(tile, Insights?), Section…]. The browser validator enforces hero placement and drops each insight bullet whose numbers are not headline facts. The server sends headline facts merged across every allowed type.

**Tech Stack:** React 19 + Recharts 3 + `@json-render/core|react` 0.21.1 + zod, with vitest and Playwright (`chart-gallery/web`). FastAPI + pydantic + SQLite, with pytest (`chart-gallery/api`). MCP tool in `wren/scripts/chart_tool.py`, with pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-dashboard-hero-insights-design.md`

## Global Constraints

- No new dependencies.
- AI output is never trusted for data. No number may reach the screen in an insight unless `summaryNumbersMatch` accepts it.
- The rules layout must work with no AI at all (AI disabled, timed out, or rejected).
- `MIN_SCATTER_ROWS = 5`. `INSIGHT_MAX = 120` characters per bullet, with 1–5 bullets.
- Years: integers 1900–2100 (same as `YEAR_MIN`/`YEAR_MAX` in `arrangement.ts`).
- `r` is rounded to 2 decimals. Other scatter headline values use `_sig` (4 significant digits).
- `arrange-prompt.md` must stay under 3000 characters (`catalog.test.ts`).
- Commit messages follow `<type>: <description>`, with no co-author trailer.
- Test commands:
  - Web, from `chart-gallery/web`: `npx vitest run <file>`
  - API, from `chart-gallery/api`: `uv run pytest <file> -v`
  - Wren, from the repo root: `uv run --no-project --with pytest --with httpx --with "mcp<2" pytest wren/tests -v`

## Review Focus

1. **The main chart fails to load.** `useRulesBuild` drops it, so `plans[0]` is the next chart. That chart becomes the hero, and the validator checks against `plans[0]`, not the URL seed. Pinned in Task 7 (`buildRulesSpec` uses `plans[0]`, and the validator hero check uses `plans[0]`).
2. **A dashboard with only one chart** (seed only, below threshold). It renders the hero alone with no empty `Section` element. Pinned in Task 7.
3. **Every insight bullet fails the number check.** The `Insights` element is removed, the Hero has one child, and the CSS makes the hero full width. Pinned in Task 7.
4. **Live rows no longer fit scatter** (for example a text x value arrives live). `effectiveType` turns the tile into a table rather than crashing Recharts. Pinned in Task 6.
5. **Migrating an existing gallery DB:** rows and ids survive, running it twice is a no-op, and a scatter insert works afterwards. Pinned in Task 1.

---

### Task 1: Scatter as a stored chart type (API)

**Files:**
- Modify: `chart-gallery/api/gallery/models.py` (`ChartType`)
- Modify: `chart-gallery/api/gallery/repository.py` (`SCHEMA`, `init_schema`)
- Test: `chart-gallery/api/tests/test_repository.py`, `chart-gallery/api/tests/test_app.py`

**Interfaces:**
- Produces: `ChartType = Literal["line", "bar", "pie", "scatter"]`. `ChartRepository.init_schema()` now also migrates an old-CHECK table.

- [ ] **Step 1: Write failing tests**

In `test_repository.py`:
- `test_init_schema_migrates_old_check(tmp_path)`:
  1. Create `charts.db` by hand with the old `CREATE TABLE` (CHECK `('line', 'bar', 'pie')`) and insert one row with `id = 7`.
  2. Call `make_repo(tmp_path)`.
  3. Assert `repo.get(7)` returns the row unchanged.
  4. Assert `repo.upsert(chart(dedup_key="k2", chart_type="scatter"))` returns `(8, "created")`.
- `test_init_schema_twice_is_noop(tmp_path)`: call `init_schema()` twice on a migrated DB. The row count and the `sqlite_master` SQL are unchanged.

In `test_app.py`: a `scatter` chart POSTed to `/internal/charts` returns 2xx.

- [ ] **Step 2: Run the tests and see them fail**

Run: `uv run pytest tests/test_repository.py tests/test_app.py -v`
Expected: FAIL. The CHECK constraint fails on scatter, and pydantic rejects `scatter`.

- [ ] **Step 3: Implement**

- Add `'scatter'` to the `SCHEMA` CHECK and to `ChartType`.
- In `init_schema`, read `SELECT sql FROM sqlite_master WHERE name = 'charts'`. If it exists and lacks `'scatter'`, rebuild the table inside one `BEGIN IMMEDIATE … COMMIT`:
  1. `CREATE TABLE charts_new` (the new SCHEMA with the table renamed)
  2. `INSERT INTO charts_new SELECT * FROM charts`
  3. `DROP TABLE charts`
  4. `ALTER TABLE charts_new RENAME TO charts`

  Roll back on error.

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit** — `feat: store scatter charts and migrate the chart type check`

---

### Task 2: The analyst can save scatter charts

**Files:**
- Modify: `wren/scripts/chart_tool.py` (`SUPPORTED_TYPES`, `_check_spec` message, `_check_result`, `save_chart_tool` docstring)
- Modify: `librechat/librechat.yaml` (the step-8 text "the chart type (line, bar or pie)", and add a scatter mention to the visualise step)
- Test: `wren/tests/test_chart_tool.py`

**Interfaces:**
- Consumes: Task 1 (the gallery accepts `scatter`).
- Produces: `_check_result(result, x_field, y_fields, chart_type)`, which gains the `chart_type` parameter. The only call site is `save_chart`.

- [ ] **Step 1: Write failing tests** (follow the existing fakes in `test_chart_tool.py`)

- `test_scatter_saves_with_numeric_x`: `chart_type="scatter"` with rows `{"price": 1.5, "units": 3}` posts the payload with `chart_type == "scatter"`.
- `test_scatter_rejects_non_numeric_x`: x value `"cheap"` returns `saved: False`, with an error containing `"x field 'price' has a non-numeric value 'cheap'; cast it to numeric in SQL"`. Nothing is posted.
- `test_scatter_x_rejects_bool`: x value `True` is rejected.
- `test_unsupported_type_message_lists_scatter`: `chart_type="area"` gives an error containing `"line, bar, pie, scatter"`.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

- Add `"scatter"` to `SUPPORTED_TYPES`.
- Update the message to `"save_chart supports line, bar, pie, scatter; the chart was not saved"`.
- For scatter, `_check_result` checks x values with the same rule used for y: `None` is allowed, bools and non-numbers are rejected.
- Docstring: `chart_type: "line", "bar", "pie" or "scatter"`, and `x_field: … (scatter: numeric column)`.

- [ ] **Step 4: Run the tests and see them pass**

Run: the wren command above.
Expected: all PASS.

- [ ] **Step 5: Commit** — `feat: let the analyst save scatter charts`

---

### Task 3: Shared shape rules (TS + Python twin + fixtures)

**Files:**
- Create: `chart-gallery/fixtures/chart-shapes.json`
- Create: `chart-gallery/web/src/chartShape.ts`
- Create: `chart-gallery/web/src/chartShape.test.ts`
- Create: `chart-gallery/api/gallery/shape.py`
- Create: `chart-gallery/api/tests/test_shape.py`
- Modify: `chart-gallery/web/src/dashboard/tileTypes.ts`. Move `isNumeric` and `isLineShaped` out, then import them and re-export `isNumeric` so the current importers keep working.

**Interfaces:**
- Produces (TS, `chartShape.ts`):
  - `isNumeric(v: unknown): v is number`
  - `isLineShaped(chart: Pick<ChartDetail,'x_field'>, rows: readonly Row[]): boolean`
  - `type ScatterAxes = { mode: 'x'; x: string; ys: string[] } | { mode: 'pair'; x: string; ys: [string]; label: string }`
  - `scatterAxes(chart: Pick<ChartDetail,'x_field'|'y_fields'>, rows: readonly Row[]): ScatterAxes | null`
  - `MIN_SCATTER_ROWS = 5`
- Produces (Python, `gallery/shape.py`):
  - `is_number(v) -> bool`
  - `is_line_shaped(x_field: str, rows) -> bool`
  - `scatter_axes(x_field: str, y_fields: Sequence[str], rows) -> dict | None`, returning the same dict shape as the TS type
  - `MIN_SCATTER_ROWS = 5`

**Rules** (identical on both sides):
- **line-shaped:** at least 2 rows, and every x value is either a `DATE_LIKE` string, or an integer (not bool, and float values must be integral) in 1900–2100.
- **x mode:** not line-shaped, at least 5 rows, every x value numeric, and `ys` = the y fields that have at least one numeric value. If `ys` is empty, x mode does not apply.
- **pair mode:** not line-shaped, at least 5 rows, and at least 2 y fields that each have at least one numeric value. Result: `x = y_fields[0]`, `ys = [y_fields[1]]`, `label = x_field`.
- Try x mode first, then pair mode. Otherwise the result is `null`/`None`.

- [ ] **Step 1: Write the fixture file**

It is a JSON array of `{ "name", "chart": {"x_field","y_fields"}, "rows", "line_shaped": bool, "scatter": null | {...} }`. Include at least these cases:

| Case | Expected |
|---|---|
| 3 date strings | line, null |
| integer years 2019–2024 | line, null |
| years with one value 1899 | not line |
| 2020.5 among years | not line |
| numeric x, 5 rows, 1 y | x mode |
| numeric x, 4 rows | null |
| numeric x, 5 rows, y all null | null |
| numeric x where one y field is all null | x mode with only the numeric field in `ys` |
| text x, 2 numeric y, 5 rows | pair |
| text x, 1 y, 5 rows | null |
| date x, 2 y, 6 rows | line, null |
| one string among numeric x, 2 y, 5 rows | pair |
| `true` as an x value | not numeric |

- [ ] **Step 2: Write failing tests on both sides**

- `chartShape.test.ts`: read the fixture with `readFileSync(new URL('../../fixtures/chart-shapes.json', import.meta.url))`. For each case, `expect(isLineShaped(...)).toBe(case.line_shaped)` and `expect(scatterAxes(...)).toEqual(case.scatter)`. Also assert that no case has `line_shaped && scatter !== null`.
- `test_shape.py`: load `Path(__file__).parents[2] / "fixtures" / "chart-shapes.json"` and run the same assertions with `pytest.mark.parametrize` over the cases, using `ids=name`.

- [ ] **Step 3: Run the tests and see them fail.** Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 4: Implement both modules.** In `tileTypes.ts`, replace the local `isNumeric`/`isLineShaped` with the imports, so `tileTypes.test.ts` still passes unchanged.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run src/chartShape.test.ts src/dashboard/tileTypes.test.ts` and `uv run pytest tests/test_shape.py -v`
Expected: PASS.

- [ ] **Step 6: Commit** — `feat: share line and scatter shape rules between web and api`

---

### Task 4: Dashboard fit rules and variety know scatter

**Files:**
- Modify: `chart-gallery/web/src/types.ts` (`ChartType` adds `'scatter'`)
- Modify: `chart-gallery/web/src/dashboard/types.ts` (`TileType` adds `'scatter'`)
- Modify: `chart-gallery/web/src/dashboard/tileTypes.ts` (`fittingTypes`, `SWAP`)
- Test: `chart-gallery/web/src/dashboard/tileTypes.test.ts`

**Interfaces:**
- Consumes: Task 3 (`scatterAxes`, `isLineShaped`).
- Produces: `TileType = 'stat' | 'line' | 'bar' | 'stackedBar' | 'scatter' | 'table'`. `fittingTypes` order: `stat`, `line`, `scatter` (if saved as scatter and it fits), `stackedBar`, `bar`, `scatter` (if not saved as scatter and it fits), `table`.

- [ ] **Step 1: Write failing tests**

- `'saved scatter with numeric x lists scatter first'`: `fittingTypes(shape('scatter'), numericX(6))[0] === 'scatter'`.
- `'bar with two numeric y over 25 text rows allows scatter but not bar'`: the result is `['scatter', 'table']`.
- `'integer-year x is a line, not a bar'`: `fittingTypes(shape('bar'), years(2019, 2024))` gives `['line', 'table']`. This is the behaviour change.
- `'never both line and scatter'`: loop over the `chart-shapes.json` fixtures and assert this for `fittingTypes`.
- `planTiles`: two adjacent scatter-first plans whose allowed types include `bar` give `['scatter', 'bar']`. If bar is not allowed, the result is `['scatter', 'scatter']`.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Allow scatter when `hasNumbers && scatterAxes(chart, rows) !== null`, using the order above. Add `scatter: 'bar'` to `SWAP`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/dashboard`
Expected: PASS. Fix any older test that assumed year-int x fits bar, and note each fix in the commit body.

- [ ] **Step 5: Commit** — `feat: fit dashboard tiles to scatter shapes`

---

### Task 5: Scatter headline facts, merged across allowed types

**Files:**
- Modify: `chart-gallery/api/gallery/headline.py` (`TileType`, the scatter branch, and new `headlines_for`)
- Modify: `chart-gallery/api/gallery/app.py`. The `arrange` endpoint uses `headlines_for(chart, tile.allowed_types)`.
- Test: `chart-gallery/api/tests/test_headline.py`, `chart-gallery/api/tests/test_arrange.py`

**Interfaces:**
- Consumes: Task 3 (`scatter_axes`).
- Produces:
  - `headline_for(chart, "scatter")` returns `{"scatter_points": int, "r"?: float, "x_min", "x_max", "y_min", "y_max"}`. It returns `{"rows": n}` when `scatter_axes` is `None`.
  - `headlines_for(chart, types: Sequence[TileType]) -> dict[str, float | int | str]`
  - The API response shape is unchanged.

- [ ] **Step 1: Write failing tests**

- `test_scatter_x_mode`: x `[1, 2, 3, 4, 5]`, y `[2, 4, 6, 8, 10]` gives `{"scatter_points": 5, "r": 1.0, "x_min": 1, "x_max": 5, "y_min": 2, "y_max": 10}`.
- `test_scatter_pair_mode_uses_first_two_y`: text x with y fields `a`, `b` uses `a` as x and `b` as y.
- `test_scatter_constant_axis_omits_r`: all x values equal, so `"r" not in result`.
- `test_scatter_counts_only_rows_with_both_axes`: one y is `None`, so `scatter_points == 4`.
- `test_headlines_for_merges_without_conflict`: for `["bar", "table"]` the result is the union, and for each shared key the value equals the one from each single `headline_for` call.
- In `test_arrange.py`: the endpoint's returned `headlines` for a tile with `allowed_types=["bar","scatter","table"]` contains both `top_value` and `scatter_points`.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Use Pearson r. Omit it when there are fewer than 2 points or either axis has zero variance. Add `"scatter"` to `TileType` so `TileIn` accepts it.

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit** — `feat: compute scatter headline facts and merge facts across allowed types`

---

### Task 6: Draw scatter in the gallery and on the dashboard

**Files:**
- Modify: `chart-gallery/web/src/components/ChartView.tsx` (a `scatter` branch)
- Modify: `chart-gallery/web/src/dashboard/tiles.tsx` (`ScatterBody`, `BODY.scatter`, `ScatterTile`)
- Modify: `chart-gallery/web/src/dashboard/catalog.ts` (`ScatterTile` component, `TILE_COMPONENT.scatter`)
- Modify: `chart-gallery/web/src/dashboard/registry.tsx` (`ScatterTile`)
- Modify: `chart-gallery/web/src/dashboard/arrange-prompt.md` (add `scatter -> ScatterTile` to the tile mapping line)
- Test: `chart-gallery/web/src/components/ChartView.test.tsx`, `chart-gallery/web/src/dashboard/DashboardView.test.tsx`, `chart-gallery/web/src/dashboard/catalog.test.ts`

**Interfaces:**
- Consumes: Task 3 (`scatterAxes`), Task 4 (`TileType` has `'scatter'`).
- Produces: `ScatterTile` (props `TileProps`) and the catalog component `ScatterTile`.

- [ ] **Step 1: Write failing tests**

- `ChartView`:
  - `chart_type: 'scatter'` with numeric x renders a `.recharts-scatter` element.
  - With a text x value and 1 y field, it renders the `DataTable` (a `table` role) instead.
- `catalog.test.ts`: the `TILE_COMPONENT` keys equal `['bar','line','scatter','stackedBar','stat','table']`.
- `DashboardView`:
  - A `ScatterTile` for a pair-mode plan renders a `.recharts-scatter`.
  - With live rows that no longer fit scatter (`effectiveType` returns `'table'`), it renders a table. This is Review Focus 4.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

- `ChartView` `scatter`: call `scatterAxes(chart, rows)`. If it is null, return `<DataTable chart={chart} />`. Otherwise build a `ScatterChart` with numeric `XAxis dataKey={axes.x}`, numeric `YAxis`, and one `<Scatter>` per `axes.ys` using `seriesColor(i)`. In pair mode, the tooltip shows the `label` field.
- `ScatterBody` returns `<ChartView chart={{ ...plan.chart, chart_type: 'scatter', rows }} height={CHART_HEIGHT} />`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: draw scatter charts in the gallery and dashboard`

---

### Task 7: Hero row, insights sidebar and the validator

**Files:**
- Modify: `chart-gallery/web/src/dashboard/catalog.ts`. `Dashboard` props become `z.object({})`. Add `Hero` (props `{}`, slot `default`) and `Insights` (props `{ bullets: z.array(z.string().max(INSIGHT_MAX)).min(1).max(MAX_BULLETS) }`). Export `INSIGHT_MAX = 120` and `MAX_BULLETS = 5`. Remove `SUMMARY_MAX`.
- Modify: `chart-gallery/web/src/dashboard/registry.tsx`. Drop the summary rendering. `Hero` renders `<div className="tile-grid dashboard-hero">{children}</div>`. `Insights` renders `<aside className="insights"><span className="ai-label">AI insights</span><ul>…</ul></aside>`.
- Modify: `chart-gallery/web/src/styles.css`:
  - `.dashboard-hero > .tile { grid-column: span 8 !important }`
  - `.dashboard-hero:not(:has(.insights)) > .tile { grid-column: span 12 !important }`
  - `.insights { grid-column: span 4 }`
  - The mobile rule becomes `.tile-grid > * { grid-column: span 12 !important; }`
  - Remove the `.dashboard-summary` rules.
- Modify: `chart-gallery/web/src/dashboard/rulesLayout.ts`. Remove `orderTiles`. Rewrite `buildRulesSpec` and `widen`.
- Modify: `chart-gallery/web/src/dashboard/arrangement.ts`:
  - `checkLayout` handles the Hero.
  - `truncateTexts` truncates bullets instead of the summary.
  - Bullets are filtered one by one.
  - `ArrangeResult.ok` carries `bulletsDropped: number` instead of `summaryDropped`.
- Modify: `chart-gallery/web/src/dashboard/arrange-prompt.md`. Replace the Dashboard summary with the Hero and Insights components and an updated example.
- Test: `rulesLayout.test.ts`, `arrangement.test.ts`, `DashboardView.test.tsx`, `catalog.test.ts`

**Interfaces:**
- Consumes: Task 6 catalog.
- Produces:
  - `buildRulesSpec(plans): Spec` returns a root `Dashboard` with children `['hero', 'section-1'?]` and `hero.children = [tileKey(plans[0].chart.id)]`.
  - `HERO_KEY = 'hero'`.
  - `validateArrangement(text, plans, headlines)` returns `{ ok: true; spec; bulletsDropped } | { ok: false; reason }`.

**Rules layout:**
- The hero is `plans[0]`, with `width: 'full'`.
- `section-1` (title `''`) holds the other stat plans as `quarter` tiles, then the rest in input (score) order through `widen`. In `widen`, tiles pair up as `half` and a lone leftover is `full`. Lines are no longer special-cased.
- If there are no other plans, there is no `section-1`.

**Validator:**
- `root.children[0]` must be a `Hero`.
- The Hero's children are one tile followed by at most one `Insights`.
- The hero tile's `chartId` must equal `plans[0].chart.id`, its type must be allowed, and any valid `width` is accepted.
- The remaining root children must be `Section`s.
- The element count must equal 1 (root) + 1 (hero) + (0 or 1 insights) + sections + tiles.
- Each bullet is kept only if `summaryNumbersMatch(bullet, headlines, { tiles: plans.length, sections: <number of Section elements> })`.
- If no bullets survive, remove the `Insights` element and its key from `hero.children`.

- [ ] **Step 1: Write failing tests**

`rulesLayout.test.ts`:
- `'hero is the first plan even when it is a stat'`
- `'single plan gives a hero and no section'` (Review Focus 2)
- `'supporting tiles keep score order'`: plans `[1,2,3,4]` sharing tables in a `1,3 | 2,4` pattern give section children `[t2,t3,t4]` in that order.
- `'pairs halves and makes a lone leftover full'`: widths `['half','half','full']`.

`arrangement.test.ts`: replace `twoSections` with a hero-based fixture, then add:
- `'rejects a spec whose hero tile is not plans[0]'` (Review Focus 1)
- `'rejects a Section as the first root child'`
- `'rejects two Insights in the hero'`
- `'drops only the bullet with an unknown number'`: `bulletsDropped === 1`, and the others are kept verbatim.
- `'removes Insights when every bullet fails'`: the hero has 1 child (Review Focus 3).
- `'counts sections without the hero'`: the bullet `"4 charts in 2 groups"` passes with 4 plans and 2 Sections.
- `'truncates a 200-char bullet to 120 with an ellipsis'`.

`DashboardView.test.tsx`:
- `'renders AI insights beside the hero'`: the `AI insights` text and the bullets are present inside `.dashboard-hero`.

`catalog.test.ts`:
- The prompt mentions `Hero`, `Insights` and `bullets`. The existing every-component/prop test covers this.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** as specified above. In the prompt:
  - The first root child is a `Hero` whose first child is the tile of the first chart in the input, followed by an optional `Insights`.
  - Hero tile `width` is `"full"`.
  - 1–5 bullets of at most 120 characters, citing only headline numbers.
  - "tiles" counts every tile; "sections" counts Sections only.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, and the prompt stays under 3000 characters. The e2e `storesSpec` still uses the old summary shape until Task 8, so do not run e2e here.

- [ ] **Step 5: Commit** — `feat: show the main chart as a hero with AI insights`

---

### Task 8: Tell the AI about relevance and variety; e2e; docs

**Files:**
- Modify: `chart-gallery/web/src/api.ts`. `ArrangeTile` adds `rank: number` and `confidence: number | null`.
- Modify: `chart-gallery/web/src/dashboard/useDashboard.ts`. `toArrangeTiles` sends `rank` (index, 0 = main item) and `confidence` from the plan.
- Modify: `chart-gallery/api/gallery/arrange.py`:
  - `TileIn` adds `rank: int = Field(ge=0)` and `confidence: float | None = Field(default=None, ge=0, le=1)`.
  - `ArrangeIn` validates that the ranks are exactly `0..n-1`.
  - `build_user_message` includes `rank` and `confidence`.
- Modify: `chart-gallery/web/src/dashboard/arrange-prompt.md`. Add these rules:
  - Input is in relevance order and `rank` 0 is the main item.
  - Supporting tiles go most relevant first, grouping related charts.
  - Prefer `line` or `scatter` over `bar` when allowed.
  - Avoid more than two tiles of the same type in a row.
- Modify: `chart-gallery/web/e2e/seeds.ts`. Add a `scatter` seed: "Basket size vs items", x `avg_items` (numeric), y `avg_basket`, with 5 rows.
- Modify: `chart-gallery/web/e2e/dashboard.spec.ts`:
  - `storesSpec` builds Hero (first tile plus `Insights` with one bullet and no numbers) and a "Stores" section.
  - `TILE_COMPONENT` adds scatter.
  - Assert the `AI insights` text, that the bullet is visible, and that the seed chart's title is inside `.dashboard-hero`.
  - Add a test that `/dashboard?from=<scatter id>` shows a `.recharts-scatter` in the hero.
- Modify: `README.md` (dashboard section). Mention the hero, insights, scatter, and the chart types `save_chart` supports.
- Test: `chart-gallery/api/tests/test_arrange.py`, `chart-gallery/web/src/dashboard/useDashboard`-level test if one exists (otherwise `DashboardPage.test.tsx`).

**Interfaces:**
- Consumes: Tasks 5 and 7.
- Produces: the final request shape `{chart_id, type, allowed_types, rank, confidence}`.

- [ ] **Step 1: Write failing tests**

- `test_arrange.py`:
  - `test_user_message_includes_rank_and_confidence`
  - `test_rejects_ranks_not_0_to_n_minus_1` (for example `[0, 2]` gives 422)
  - `test_confidence_out_of_range_rejected`
- `DashboardPage.test.tsx`: the mocked `arrangeDashboard` receives `rank` values `[0, 1, …]`, and the seed is at `rank` 0 with `confidence: null`.

- [ ] **Step 2: Run the tests and see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the full checks**

Run:
- `cd chart-gallery/api && uv run pytest --cov=gallery`
- `cd chart-gallery/web && npm test && npm run build && npm run e2e`
- the wren command

Expected: all PASS. The prompt is under 3000 characters.

- [ ] **Step 5: Commit** — `feat: send relevance to the AI arranger and cover hero and scatter in e2e`
