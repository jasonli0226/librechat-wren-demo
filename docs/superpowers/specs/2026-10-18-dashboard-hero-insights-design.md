# Dashboard hero tile, insights sidebar and scatter charts

## Why

A dashboard built from the chart gallery today often fails at its one job:
showing the chart you came for. The main chart ends up as a small half tile
beside a less relevant one, and almost every tile is a bar or a table. The
ranking already knows which chart matters most, but the layout ignores it.
`widen()` in `rulesLayout.ts` sizes tiles by type only, and the AI arrange
step never sees a score. Tile types come from fixed data-shape rules
(`fittingTypes`) that only know stat, line, bar, stackedBar and table.

This work makes the most relevant item the visual focus, adds short
AI-written insights beside it, and adds scatter charts, both as a type the
analyst can save and as a way the dashboard can redraw existing data.

## Goals

1. **The main item is the visual focus.** The main item is the seed chart
   (`?from=<id>`) or, for a query dashboard (`?q=`), the highest-scoring
   chart. It sits top left at two-thirds width. It can be any tile type
   (chart, big headline number, or table) and is never shrunk to a half or
   quarter tile.
2. **Insights sidebar.** The top right third holds 3–5 short AI-written bullet
   points about the charts on the dashboard. They replace the current
   one-line `Dashboard.summary`.
3. **Supporting tiles below, in halves, most relevant first.** The tiles
   below the hero row are mostly half width and ordered by score.
4. **More visual variety.** Supporting tiles use lines, scatter and bars,
   not mostly bars and tables. The AI chooses each tile's type, but only
   from the types the data actually fits.
5. **Scatter is a saved chart type.** The LibreChat analyst can save
   `scatter` charts to the gallery, and the gallery list, detail page and
   dashboard all draw them.
6. **Dashboard-side scatter.** The dashboard may redraw a chart as a scatter
   when its data fits, even if it was saved as something else.

## Non-goals

- New visual types beyond line, scatter and text insights (no area, no pie
  tile, no KPI notes) in this round.
- Giving the AI raw rows. It keeps seeing only computed headline facts.
- Checking the words of an insight (category names, "peak" vs "dip"). Only
  numbers are verified.

## Anti-goals (failure even if it technically works)

- **An insight cites a number that is not in the data.** This is the user's
  stated top concern. No unverified number may ever reach the screen.
- The main item is squeezed into a half or quarter tile, or placed anywhere
  but the hero slot.
- The dashboard breaks or stays empty when the AI is slow, down or returns
  bad output. The rules layout must still work on its own.

## Layout

Desktop, 12-column grid (existing `.tile-grid`):

```
+---------------------------+-------------+
|  MAIN ITEM (span 8)       |  INSIGHTS   |
|                           |  (span 4)   |
+---------------------------+-------------+
| stat | stat | stat | stat |   <- non-hero stat tiles, quarter width (only if any)
+-------------+-------------+
| supporting  | supporting  |   <- half width, score order
+-------------+-------------+
| supporting (full: lone leftover) |
+----------------------------------+
```

- Phone width (existing breakpoint that forces `span 12`): everything
  stacks, with the main item first, then insights, stats and supporting
  tiles.
- **When there are no insights** (the AI timed out, failed, or every bullet
  was rejected), the main item expands to full width (span 12) instead of
  leaving an empty third. *(My call; see "Calls made".)*
- Non-hero stat tiles form a quarter-width strip between the hero row and
  the supporting tiles. *(My call.)*
- Supporting tiles keep today's gap-free pairing (halves, with a lone
  leftover going full width). Line tiles no longer force full width, because
  the hero row now carries the visual weight. *(My call.)*

## Ordering

- `selectCharts` already returns the seed or top hit first, then the rest
  in score order. That order is the relevance order for everything below.
- **Rules layout:** the main item is `picked[0]`. Supporting tiles keep
  score order. `orderTiles` clustering by shared table is dropped from the
  supporting tiles, because it lets a low-score chart jump ahead.
  *(My call.)*
- **AI layout:** the AI receives the tiles in score order, each with its
  rank (and score where one exists), and is told the first one is the main
  item. The validator **enforces** that the main item's chart sits in the
  hero slot. Supporting order is a prompt instruction ("most relevant first,
  group related charts"), not enforced. *(My call: enforcing exact order
  would reject most AI answers. Hero placement is the property the user
  cares about.)*

## json-render catalog changes

The structure stays Dashboard → children. Suggested shape (the builder may
refine names):

- `Dashboard` loses `summary`. Its children are one `Hero` element followed
  by zero or more `Section`s.
- `Hero`: props `{}`. Children are exactly one tile (the main item) plus at
  most one `Insights`.
- `Insights`: props `{ bullets: string[] }`, 1–5 bullets, each at most
  `INSIGHT_MAX` characters (my call: 120). No children.
- Tiles add `ScatterTile`. The tile prop schema is unchanged: `width` stays
  a required `quarter | half | full`. Inside `Hero`, the tile's `width` prop
  must still be valid, but it is **ignored**. The `Hero` container's CSS
  sets the span (8, or 12 when there is no `Insights`). The rules layout
  emits `full` for the hero tile, and the prompt tells the AI to do the same,
  but the validator accepts any valid width there.
- `Section` is unchanged.

`arrangement.ts` / `checkLayout` must check that:

- the root is a `Dashboard` whose first child is a `Hero`;
- the hero's tile is the main item's chart, with an allowed type;
- each chart appears exactly once across the hero and the sections;
- the existing rules (no state/on/watch/repeat/visible, no `$` expressions,
  props valid against the catalog, tile type within `allowed`) still hold.

Code that goes away with `Dashboard.summary`: the Dashboard branch of
`truncateTexts` (it now truncates `Insights` bullets and Section titles),
`summaryDropped` in `ArrangeResult` (replaced by a count of dropped
bullets, or removed if nothing reads it), the summary rendering in
`registry.tsx`, and the `summary` prop in the rules spec.

`arrange-prompt.md` is updated to match. The existing `catalog.test.ts`
checks (every component and prop named, stays under 3000 chars) still
apply.

## Insights: the number check

- Each bullet goes through the existing `summaryNumbersMatch` logic on its
  own (headline values to stated precision, years, tile/section counts).
  The counts are defined as: `tiles` is every tile on the dashboard,
  including the hero tile; `sections` is the number of `Section` elements,
  not counting `Hero`. The prompt states both definitions, so a bullet like
  "4 charts in 2 groups" is not dropped by surprise.
- **A failing bullet is dropped, and the rest are kept.** If none survive,
  the `Insights` element is removed and the hero goes full width.
- Text is still truncated to the limit before checking, as summaries are
  today.
- Headline facts are computed from the snapshot rows, as today. Insights
  may therefore cite snapshot numbers while a tile shows live rows. This is
  unchanged behaviour and acceptable for now.

## Scatter

### Saved type (analyst → gallery)

- `chart_type` gains `"scatter"` in:
  - `api/gallery/models.py` (`ChartType`)
  - `wren/scripts/chart_tool.py` (`SUPPORTED_TYPES`, `_check_spec`, the
    tool docstring the analyst reads)
  - `web/src/types.ts`
  - anywhere else the `line | bar | pie` set is hard-coded (e.g. the
    `librechat/librechat.yaml` analyst instructions, if they list types)
- Validation for scatter: `x_field` and 1–5 `y_fields`. `save_chart`
  already runs the SQL and checks values in `_check_result`, which rejects
  non-numeric y values. For scatter it also **rejects any non-numeric x
  value** with the same kind of message ("cast it to numeric in SQL"), so
  bad scatters are never saved. *(My call.)* `ChartView` still guards
  against non-numeric x in live or stale rows by falling back to a table,
  but that is a guard, not a main path.
- **DB migration:** `repository.py` has
  `CHECK (chart_type IN ('line', 'bar', 'pie'))`, and SQLite cannot alter a
  CHECK constraint. On startup, detect the old constraint and rebuild the
  table (create new, copy, drop, rename) inside one transaction. Existing
  rows and ids must survive. This needs a test against a DB file created
  with the old schema.
- `ChartView` renders `scatter` with Recharts `ScatterChart`, numeric
  X and Y axes, and colours from `seriesColor`. It takes its axes from the
  shared `scatterAxes` function (below). A saved scatter always has a
  numeric x, so in the gallery it is always drawn in **x mode**. The gallery list card badge and detail page work without
  special cases.
- `dedup_key` includes `chart_type`, so the same SQL saved as bar and as
  scatter are two charts. This is existing behaviour; keep it.

### Dashboard fit rules (`fittingTypes`)

There are two scatter geometries. One function, `scatterAxes(chart, rows)`,
decides which one applies (if any), and **rule 1 is tried before rule 2**:

1. **x mode:** every row's x value is numeric, the chart is not line-shaped,
   and there are at least `MIN_SCATTER_ROWS` rows (my call: 5). It plots
   `x_field` on the X axis, with one series per numeric y field.
2. **pair mode:** the chart is not line-shaped, it has at least 2 y fields
   with numeric values, and it has at least `MIN_SCATTER_ROWS` rows. It plots
   `y_fields[0]` on the X axis against `y_fields[1]` on the Y axis, one dot
   per row, with the `x_field` value as the tooltip label. Any further y
   fields are ignored.

`scatterAxes` returns `null` or `{ mode, x, ys, label? }`. `fittingTypes`
allows `scatter` exactly when it is non-null. `ScatterTile` and `ChartView`
draw from its result. The server has a Python twin with the same rules,
used by `headline_for`. **Both are tested against one shared JSON fixture
file** of row sets with their expected result (null / x mode / pair mode,
and which axes), read by both vitest and pytest. That way `r` always
describes the pairing that is actually drawn.

**Line and scatter are mutually exclusive.** Both rules require "not
line-shaped", so a chart never has both `line` and `scatter` in
`allowed_types`. A test asserts this over the shared fixtures.

**Year-like numeric x is a line, not a scatter.** `isLineShaped` in
`tileTypes.ts` is extended: besides `DATE_LIKE` strings, it also accepts
every x value being an integer between 1900 and 2100 (the same range as
`YEAR_MIN`/`YEAR_MAX` in `arrangement.ts`), with at least `MIN_LINE_ROWS`
rows. **This changes existing behaviour:** charts with integer-year x
values, which fit `bar` today, become line-shaped, so they fit `line` and no
longer fit `bar`. It stops a "revenue by year" chart being drawn as
scattered dots. *(My call.)* Other numeric category-like x values (ids,
ranks) are not detected, which is accepted for now.

A chart saved as `scatter` lists `scatter` first in its allowed types when
it fits. Like every other type, the type is re-checked against live rows
in `effectiveType`.

### Headline facts for scatter (`headline.py`)

`TileType` gains `"scatter"`. For a scatter tile, using the axes from the
Python `scatterAxes` twin (in pair mode, or the first y series in x mode),
return `scatter_points` (count of rows where both axes are numeric), `r`
(Pearson correlation, rounded to 2 decimals, omitted when undefined), and
`x_min`, `x_max`, `y_min`, `y_max`, rounded like other headlines. Key
names are distinct from the line and bar keys, so merging (below) never
overwrites a fact. These
are the only numbers the AI may cite about a scatter.

**Facts across all allowed types.** The AI now chooses each tile's type, so
the type the rules layout picked is no longer the type that gets drawn.
The server therefore computes each chart's headline as the **merge of
`headline_for(chart, t)` over every type in its `allowed_types`**. It is
still one flat object per chart, so the API response shape and `Headlines`
type are unchanged. Keys shared across types (`rows`, `top`, `top_value`)
come from the same rows and the same formula, so their values are equal.
Scatter keys are distinct, and line and scatter never both apply. A test
asserts that merging never changes a key's value. Every merged value is a true fact about the
chart's snapshot rows, so the number check stays as safe as before, and
insights about a redrawn tile (for example `r` for a bar redrawn as
scatter) can survive the check. *(My call.)*

## Variety

- `applyVariety` stays as the rules-layout fallback. Its `SWAP` map gains
  `scatter: 'bar'`. The second of two adjacent scatters becomes a bar when
  bar is allowed, and otherwise stays a scatter.
- The AI prompt asks for variety ("prefer line or scatter over bar when
  allowed; avoid more than two tiles of the same type in a row"), always
  within `allowed_types`.

## Fallback behaviour (no AI)

When the AI is disabled, slow (`ARRANGE_TIMEOUT_MS`), failing or rejected,
the rules layout shows:

- the hero row with the main item at full width (no insights);
- the non-hero stat strip;
- supporting tiles in score order, in halves.

The existing `RULES_NOTE` behaviour stays.

## Constraints

- Existing stack only: React + Recharts + `@json-render/core|react` + zod in
  `chart-gallery/web`; FastAPI + pydantic in `chart-gallery/api`; OpenRouter
  via `llm.py`. No new dependencies.
- Keep the existing safety properties: the AI output is validated in the
  browser, is never trusted for data, and can never introduce charts or
  numbers.
- Tests: vitest for web units, pytest for API and `chart_tool.py`, and the
  existing Playwright `e2e/dashboard.spec.ts`, extended for the hero row,
  insights and a scatter tile.

## Left to the builder

- Exact component and prop names, CSS, and hero/insights styling (follow
  the existing tokens in `styles.css`).
- Whether `Hero` is a new catalog component or `Section` gains a variant,
  as long as the validator can enforce hero placement.
- Prompt wording and the exact per-chart fields sent to the AI (rank and
  score must be included).
- Scatter dot size, axis formatting and tooltip details.

## Calls made (not explicitly decided by the user)

1. With no insights, the hero goes full width rather than keeping two-thirds
   beside an empty third.
2. Non-hero stat tiles form a quarter-width strip below the hero row.
3. Line tiles no longer force full width.
4. Shared-table clustering is dropped from the rules layout in favour of
   strict score order.
5. Only hero placement is enforced on the AI. Supporting order is a prompt
   instruction.
6. Insight limits: 1–5 bullets, at most 120 characters each. Insights
   replace the one-line summary.
7. Scatter thresholds: at least 5 rows. Headline facts are points, r and the
   axis min/max.
8. Headline facts are merged across every allowed type, so insights about
   AI-chosen types can pass the number check.
9. `save_chart` rejects a scatter with non-numeric x values.
10. Integer x values between 1900 and 2100 count as years and make a line,
    not a scatter. Such charts no longer fit bar.
11. Two scatter modes (x mode, pair mode), defined once by `scatterAxes`
    with a Python twin, and tested against shared fixtures.
12. The hero tile's `width` prop is required but ignored. `Hero` CSS sets
    the span.
13. Insights fully replace the summary. There is no extra summary bullet.
