# json-render (vercel-labs) — research notes

Researched 2026-10-17 against **v0.21.1** (all `@json-render/*` packages). Primary sources only:

- Repo: <https://github.com/vercel-labs/json-render>. Source links below are pinned to commit
  `72568f9` ("Prepare v0.21.1 release", 2026-10-13). Abbreviation: `GH/` =
  `https://github.com/vercel-labs/json-render/blob/72568f990e5502c4d3115691facb8ca928a5c9fc/`
- Docs: <https://json-render.dev/docs> (sources for the site are in the repo at `apps/web/content/docs/*.mdx`. The live pages
  checked returned HTTP 200 and match the repo text.)
- npm registry: `npm view @json-render/<pkg>` (run 2026-10-17)
- GitHub API / issues: `gh api repos/vercel-labs/json-render`, `gh issue view`
- **Local empirical checks**: I installed `@json-render/core@0.21.1`, `@json-render/react@0.21.1`, `zod@4.6.7`, and
  `react@19.3.1` in a scratch dir and ran Node scripts against them. These checks are marked **[tested]**.

---

## TL;DR

**Feasible. Recommended setup: "Python backend makes the LLM call, browser validates and renders."** json-render's
LLM-facing contract is just text: a system prompt string and JSONL (RFC 6902 patch) output. The React side has
no dependency on the Vercel AI SDK or on a Node server.

- `catalog.prompt()` returns a plain `string` (GH/packages/core/src/schema.ts L95-96, L452-454). You can generate it
  at build time in Node and ship it to FastAPI as a text file. **[tested]**
- The browser parses model output with `compileSpecStream` (one-shot) or `createSpecStreamCompiler` (incremental)
  from `@json-render/core`. Another option is `useUIStream` from `@json-render/react`, which is a plain `fetch` POST that
  reads the response body line by line (GH/packages/react/src/hooks.ts L241-352). A FastAPI `StreamingResponse` of
  raw model text works with it. The official dashboard example's server does nothing more than
  `streamText(...).toTextStreamResponse()` (GH/examples/dashboard/app/api/generate/route.ts L45-52).
- **Caveats you must design around (all verified):**
  1. `catalog.validate()` does **not** validate per-component props when the catalog has more than one component
     (open issue #378). It also **strips** `state`/`on`/`watch`/`repeat` from its returned `data` (open issue #222).
     You need your own per-element `props.safeParse` pass. **[tested]**
  2. The default generated prompt (~15.7k chars for a 3-component catalog) **tells the model to invent "realistic
     sample data" in `/state`**. That contradicts our rule that the LLM never writes data
     (GH/packages/core/src/schema.ts L770, GH/packages/react/src/schema.ts L92, L98). `customRules` only appends
     to these instructions and cannot remove them. Use a hand-written compact prompt, or a custom schema with a `promptTemplate`.
  3. Pre-1.0, "Vercel Labs" product, ~monthly minor releases with occasional breaking changes. Pin exact versions.
  4. It adds zod 4 to the web bundle (`@json-render/core` has a hard `zod ^4.3.6` dependency). Measured ≈112 KB
     gzip for core+react+zod with React external, or ≈22 KB without zod. **[tested]**
- For our narrow use case (Dashboard → Section → ChartTile plus a summary), the library mainly gives us a renderer
  and structural validation/autofix. It is worth adopting if we want streaming/progressive layout or expect the
  vocabulary to grow. A 40-line hand-rolled zod schema would also cover today's needs. Either way, keep the spec
  format json-render-compatible (flat `root` + `elements`).

---

## 1. Versions and maturity

| Fact | Source |
|---|---|
| Every published `@json-render/*` package is at **0.21.1** (latest dist-tag), published 2026-10-13. Packages: core, react, vue, svelte, solid, shadcn, shadcn-svelte, react-native, react-pdf, react-email, remotion, image, ink, next, tanstack-start, react-three-fiber, mcp, yaml, codegen, directives, devtools(+react/vue/svelte/solid), zustand, redux, jotai, xstate. | `npm view @json-render/<pkg> version`. `npm search @json-render`. Workspace `packages/*/package.json` (all `0.21.1`; `react-state`, `ui`, `eslint-config`, `typescript-config` are private `@internal/*`). |
| Release cadence: core has 32 versions since 0.0.1 on 2026-01-14. Recent ones: 0.17.0 (04-11), 0.18.0 (04-17), 0.19.0 (05-07), 0.20.0 (08-16), 0.21.0 (09-18), 0.21.1 (10-13). Roughly weekly early in the year, monthly lately. | `npm view @json-render/core time --json`. GitHub releases (`gh api repos/vercel-labs/json-render/releases`). |
| License: **Apache-2.0** (repo and npm). | GH/LICENSE. `npm view @json-render/core license`. README L10. |
| Stability: still 0.x. README carries a "Vercel Labs Product" badge (README L8, added in 0.21.0 per CHANGELOG L38). Minor releases contain breaking changes (e.g., 0.20.0 "Breaking Changes": `executeAction` bridge signature, CHANGELOG L63-65). Some core APIs are explicitly `experimental_*` and "may change in any release" (GH/packages/core/src/index.ts L233). | GH/README.md, GH/CHANGELOG.md |
| Activity: 18.7k stars, 139 open issues, not archived, last push 2026-10-13. | `gh api repos/vercel-labs/json-render` |
| **React 19**: `@json-render/react@0.21.1` peer dep is `react ^19.2.3`. The install docs say `react ^19.0.0`, which is a doc/package mismatch, so trust the package. React 18 is not supported (open issue #329 asks to widen). Our app's `react ^19.3.1` satisfies it. **[tested with react 19.3.1]** | `npm view @json-render/react peerDependencies`. apps/web/content/docs/installation.mdx L11. Issue #329. |

## 2. Catalog definition

- Components and actions are declared with **`defineCatalog(schema, { components, actions })`** from
  `@json-render/core`. `schema` comes from the renderer package (`@json-render/react/schema`)
  (docs: <https://json-render.dev/docs/catalog>, catalog.mdx L17-63).
- Props and action params are **zod schemas** (`props: z.object(...)`, `params: z.object(...)`). The React schema
  declares this as `props: s.zod()`, `slots: s.array(s.string())`, `description: s.string()`, `example: s.any()`.
  For actions it declares `params: s.zod()` and `description` (GH/packages/react/src/schema.ts L35-54).
- **Zod version: zod 4 required.** `@json-render/core` has `peerDependencies: { zod: "^4.0.0" }` *and*
  `dependencies: { zod: "^4.3.6" }` (GH/packages/core/package.json; `npm view`). Docs: "Peer dependencies:
  `react ^19.0.0` and `zod ^4.0.0`" (installation.mdx L11). Zod 3 is not supported. **zod is not currently a dependency of
  `chart-gallery/web`** (checked `chart-gallery/web/package.json` and `package-lock.json`).
- Optional props: docs say "use `.nullable()` for optional" (catalog.mdx L71). Every official example uses
  `.nullable()` rather than `.optional()`.
- Children/layout: a component accepts children if `slots` includes `"default"`. Named slots (`["default","header"]`)
  have been supported in React since 0.20.0 (catalog.mdx L77-87; CHANGELOG L49). In the spec, children are
  **key references**, not nested objects (see Q4).
- Typed props in components: `defineRegistry(catalog, { components })` infers each component's `props` type from
  its zod schema (GH/packages/react/src/renderer.tsx L1092 and `catalog-types.ts`).

Minimal example (verbatim from README L55-86, trimmed):

```ts
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const catalog = defineCatalog(schema, {
  components: {
    Card: { props: z.object({ title: z.string() }), description: "A card container" },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        format: z.enum(["currency", "percent", "number"]).nullable(),
      }),
      description: "Display a metric value",
    },
  },
  actions: {
    refresh_data: { description: "Refresh all metrics" },
  },
});
```

A catalog for our case (this is what I ran **[tested]**):

```ts
const catalog = defineCatalog(schema, {
  components: {
    Dashboard: { props: z.object({ summary: z.string().max(200) }), slots: ["default"], description: "Dashboard root with one-line summary" },
    Section:   { props: z.object({ title: z.string() }), slots: ["default"], description: "Named section of tiles" },
    ChartTile: { props: z.object({ chartId: z.enum(["c1","c2","c3"]) }), description: "Renders an existing chart by id" },
  },
  actions: {},
});
```

## 3. Prompt generation

- **`catalog.prompt(options?: PromptOptions): string`** (GH/packages/core/src/schema.ts L95-96; implementation
  `generatePrompt` L588-1153). Options: `system` (intro line), `customRules: string[]`,
  `mode: "standalone" | "inline"` (default standalone = JSONL only; inline = prose plus a ```` ```spec ```` fenced JSONL),
  `editModes`, `directives` (schema.ts L132-157; docs api/core.mdx L162-167).
- **Output** is a single plain string with these sections: OUTPUT FORMAT (JSONL RFC 6902 patches, with an example built
  from *your* component names), INITIAL STATE, DYNAMIC LISTS (repeat), ARRAY STATE ACTIONS, AVAILABLE COMPONENTS (one line
  each, e.g. `- ChartTile: { chartId: "c1" | "c2" | "c3" } - Renders an existing chart by id`), AVAILABLE ACTIONS
  (including built-ins `setState`/`pushState`/`removeState`/`validateForm`), EVENTS, VISIBILITY CONDITIONS, DYNAMIC
  PROPS, STATE WATCHERS, and RULES (base rules, then the schema's `defaultRules`, then your `customRules`;
  schema.ts L1123-1151). For the 3-component catalog above it is **15,673 characters**. **[tested]** Open issue #324
  reports ~4,300 tokens for 18 components and asks for a smaller mode. Issue #271 asks for component filtering.
- **Build-time in Node, consumed by Python: yes.** The function is a pure string builder over the catalog data.
  There are no runtime/browser dependencies, so `node scripts/gen-prompt.mjs > api/prompts/dashboard.txt` works. **[tested
  in plain Node ESM]** The official dashboard example computes it once at module load:
  `const SYSTEM_PROMPT = dashboardCatalog.prompt();` (GH/examples/dashboard/app/api/generate/route.ts L9).
- **Problem for our use case:** the default prompt instructs the model to invent data. The core prompt body says
  *"Include realistic sample data in state … Never leave arrays empty."* (schema.ts L770, emitted unconditionally).
  The React schema's `defaultRules` add *"ALWAYS include a state field with realistic sample data"* and
  *"Always include realistic, professional-looking sample data"* (GH/packages/react/src/schema.ts L92, L98).
  `customRules` are appended after these and cannot remove them (schema.ts L1147). Options:
  (a) write a compact prompt by hand that documents only the flat `root/elements` format and our three components;
  (b) `defineSchema(builder, { promptTemplate })` with your own template. When a schema has `promptTemplate`,
  `generatePrompt` returns its output instead of the default (schema.ts L592-602), and the template gets
  `componentNames` and a `formatZodType` helper (`PromptContext`, L161-172). Option (b) still runs at build time in Node.
- Companion helper: `buildUserPrompt({ prompt, currentSpec?, state?, ... })` builds the user turn. Without a
  `currentSpec` it appends "Remember: Output /root first, then interleave /elements and /state patches…"
  (GH/packages/core/src/prompt.ts L45-98). It is trivial to reproduce in Python.

## 4. Spec format

Two layers:

1. **Final spec (what the renderer consumes)** is a **flat element map**, not a nested tree
   (GH/packages/core/src/types.ts L175-183; GH/packages/react/src/schema.ts L13-31):

   ```ts
   interface Spec { root: string; elements: Record<string, UIElement>; state?: Record<string, unknown> }
   // element: { type, props, children: string[], slots?, visible?, repeat?, on?, watch? }
   ```

   Example for us:

   ```json
   {
     "root": "dash",
     "elements": {
       "dash":   { "type": "Dashboard", "props": { "summary": "Revenue up, churn flat." }, "children": ["sec-rev"] },
       "sec-rev":{ "type": "Section",   "props": { "title": "Revenue" }, "children": ["t-c1", "t-c2"] },
       "t-c1":   { "type": "ChartTile", "props": { "chartId": "c1" }, "children": [] },
       "t-c2":   { "type": "ChartTile", "props": { "chartId": "c2" }, "children": [] }
     }
   }
   ```

   `children` is **required** on every element (the React schema has `children: s.array(s.string())` with no optional
   marker). An element without `children` fails `catalog.validate()` **[tested]**. Note that some doc examples omit it
   (e.g. streaming.mdx L14-15, generation-modes.mdx L241-243), so they would not pass validation as written.
2. **Wire format the default prompt asks for ("SpecStream")** is **JSONL of RFC 6902 patches**, one per line
   (docs <https://json-render.dev/docs/streaming>, streaming.mdx L7-38):

   ```
   {"op":"add","path":"/root","value":"dash"}
   {"op":"add","path":"/elements/dash","value":{"type":"Dashboard","props":{"summary":"…"},"children":["sec-rev"]}}
   {"op":"add","path":"/elements/sec-rev","value":{"type":"Section","props":{"title":"Revenue"},"children":["t-c1"]}}
   {"op":"add","path":"/elements/t-c1","value":{"type":"ChartTile","props":{"chartId":"c1"},"children":[]}}
   ```

   All six RFC 6902 ops are supported (`applySpecStreamPatch`, types.ts L610-660).

Alternatives: the model may emit the whole flat spec as one JSON object, which is fine for non-streaming (just
`JSON.parse`). `nestedToFlat()` converts a nested `{type, props, children:[{…}]}` tree to the flat form
(types.ts L720). `@json-render/yaml` provides a YAML wire format (README L159).

## 5. Validation

Validation tools in `@json-render/core`:

| API | What it does | Source |
|---|---|---|
| `catalog.validate(spec)` → `{ success, data?, error?: ZodError }` | `safeParse` against a zod schema built from the spec definition. `type` becomes a `z.enum` of catalog component names. | schema.ts L460-470, L490-545 |
| `catalog.zodSchema()` | The same zod schema, for your own use. | schema.ts L471-473 |
| `validateSpec(spec, { checkOrphans? })` → `{ valid, issues[] }` | Structural checks with codes: `missing_root`, `root_not_found`, `empty_spec`, `missing_child`, `invalid_visible`, `visible_in_props`, `on_in_props`, `repeat_*`, `watch_in_props`, `orphaned_element`. | GH/packages/core/src/spec-validator.ts L21-43, L84 |
| `autoFixSpec(spec, { lossy? })` → `{ spec, fixes, fixDetails[{message, lossy}] }` | Lossless: moves `visible`/`on`/`repeat`/`watch` out of `props`. Lossy (default on): prunes dangling child/slot refs. The doc comment recommends re-prompting while retries remain and using lossy fixes as a last resort. | spec-validator.ts L355-524 |
| `formatSpecIssues(issues)` | Formats errors as text "suitable for inclusion in a repair prompt sent back to the AI". | spec-validator.ts L523-536 |
| `catalog.jsonSchema({ strict })` | JSON Schema export for structured outputs. In strict mode, record types (i.e. `elements`) become an opaque `{properties:{}, additionalProperties:false}` (schema.ts L110-127). | **[tested]**: output is `elements: {"type":"object","properties":{},"required":[],"additionalProperties":false}`, so it is useless for constraining our elements via OpenRouter structured outputs. |

**Known gaps (verified):**

- **Props are not validated per component when the catalog has more than one component.** `propsOf` falls back to
  `z.record(z.string(), z.unknown())` "since type determines which props apply" (schema.ts L533-545). I validated a spec with
  `chartId: "NOPE"` and a missing required `summary`, and it returned `success: true` **[tested]**. Open issue
  [#378](https://github.com/vercel-labs/json-render/issues/378).
  Workaround **[tested]**: `catalog.data.components[el.type].props.safeParse(el.props)` per element.
- **`catalog.validate().data` drops `state`, `on`, `watch`, `repeat`** (zod `z.object` strips unknown keys,
  schema.ts L505-515). In my run, `"state" in result.data === false` **[tested]**. Open issue
  [#222](https://github.com/vercel-labs/json-render/issues/222). Render the original spec, not `result.data`, if
  you rely on those fields. We don't plan to use them.
- Unknown component `type` → `catalog.validate` fails with
  `Invalid option: expected one of "Dashboard"|"Section"|"ChartTile"` at `["elements","t","type"]` **[tested]**.

**Runtime (renderer) behavior with invalid elements**, from GH/packages/react/src/renderer.tsx:

- Unknown type: uses `fallback` if provided, else `console.warn("No renderer for component type: …")` and renders
  `null` (L675-680) **[tested]**.
- Missing child key: logs `[json-render] Missing element "ghost" … will not render.` and skips it **[tested]**.
- A component that throws during render is caught by a per-element `ElementErrorBoundary` and renders `null`
  (L113-160).
- The renderer does **not** zod-validate props at render time. The only runtime `safeParse` calls on props are in
  `experimental-compose.ts`.

Suggested browser pipeline: parse, then `catalog.validate`, then per-element `props.safeParse`, then `validateSpec`,
then app checks (every chosen chart id appears exactly once, no unknown ids). On failure, either `autoFixSpec(..., {lossy:true})`
or send `formatSpecIssues(...)` back to the API for one repair attempt. A final fallback is the deterministic "one section, all
tiles" layout.

## 6. React renderer

Exports (GH/packages/react/src/index.ts):

- **`defineRegistry(catalog, { components, actions? })`** → `{ registry, handlers, executeAction }`. Components
  receive `{ props, children, slots, emit, on, bindings, loading }` (renderer.tsx L1092-1125; README L91-113).
- **`<Renderer spec registry loading? fallback? />`** (renderer.tsx L101-110, L908).
- **`<JSONUIProvider registry store? initialState? handlers? navigate? validationFunctions? functions? directives?
  onStateChange?>`** wraps `StateProvider`, `VisibilityProvider`, `ValidationProvider`, `ActionProvider`
  (L935-1006). **Renderer must be inside the providers.** A bare `<Renderer>` throws `useVisibility must be used
  within a VisibilityProvider` **[tested]** (contexts/visibility.tsx L72). The specs.mdx example wraps only
  State+Visibility. Use `JSONUIProvider` to be safe.
- **`createRenderer(catalog, componentMap)`** returns a single component that includes the providers and takes
  `spec`, `state`/`store`, `onAction`, `loading`, `fallback` (L1180-1327).
- Hooks: `useUIStream`, `useChatUI`, `useJsonRenderMessage`, `useStateStore`, `useStateValue`, `useStateBinding`,
  `useBoundProp`, plus `createStateStore` (index.ts).

**Data binding.** Any prop can be an expression: `{ "$state": "/json/pointer" }`, `$cond/$then/$else`, `$template`,
`$computed` (calls a function you pass via `functions`), `$bindState`/`$bindItem` (two-way), `$item`/`$index`
inside `repeat` (README L727-754; <https://json-render.dev/docs/data-binding>). State comes from the spec's `state`
**or from the app** via `JSONUIProvider initialState` or a controlled `store` (`createStateStore`, or Redux/Zustand/Jotai/
XState adapters) (data-binding.mdx L27; api/react.mdx L9-61). **[tested]**: `{"$state":"/titles/a"}` resolved
from `initialState` supplied by the app.

**For us:** the simplest design is for `ChartTile` to receive only `chartId` and fetch or look up the chart data
itself, using the existing gallery data layer, in app code. Then the LLM never touches `$state` and we can reject any spec that
contains `state` or `$`-expressions. An alternative is to put fetched chart data in the store at `/charts/<id>` and let
the component read it. I found no built-in "fetch on mount" action. Open issue
[#245](https://github.com/vercel-labs/json-render/issues/245) asks for one, so data loading stays in app code either way.

## 7. Streaming and server side

- **No Vercel AI SDK or Node server is required on the client path.**
  - `useUIStream({ api })` does `fetch(api, { method: "POST", body: JSON.stringify({ prompt, context, currentSpec }) })`,
    then reads `response.body` with a `TextDecoder`. It splits on `\n`, `JSON.parse`s each line as a patch, and also
    accepts `{"__meta":"usage",...}` lines (GH/packages/react/src/hooks.ts L41-66, L241-352). Any HTTP server that
    streams raw JSONL text works, including FastAPI `StreamingResponse(media_type="text/plain")` forwarding
    OpenRouter delta content. *Not run end-to-end against FastAPI.* The logic is plain fetch/ReadableStream,
    but treat a live FastAPI+OpenRouter run as **UNVERIFIED** until we build it.
  - AI SDK helpers are optional extras: `createJsonRenderTransform` / `pipeJsonRender` operate on AI SDK
    `UIMessageChunk`s for *inline/chat* mode. Core defines a minimal chunk type "so that `@json-render/core` has no
    dependency on the `ai` package" (types.ts L1040-1048). Neither `core` nor `react` lists `ai` as a dependency
    (`npm view`).
- **Client-side functions that parse/compile raw model output** (all in `@json-render/core`):
  - `parseSpecStreamLine(line)` parses one line into a patch, or returns `null` for blank, non-`{`, or invalid JSON (types.ts L587-603).
    Malformed lines are silently dropped (issue #196) **[tested: a "not json" line was skipped]**.
  - `compileSpecStream(text, initial?)` compiles a whole JSONL string in one shot. Use it for a **non-streaming** FastAPI
    response (types.ts L802-818; streaming.mdx L94-106) **[tested]**.
  - `createSpecStreamCompiler()` gives `.push(chunk)` → `{ result, newPatches }`, plus `.getResult()`, `.getPatches()`,
    `.reset()`. It handles chunk boundaries mid-line (types.ts L834-937).
  - `applySpecPatch(spec, patch)` / `applySpecStreamPatch(obj, patch)` apply a single patch (types.ts L610, L665).
  - `createMixedStreamParser({ onText, onPatch })` handles prose plus JSONL, including ```` ```spec ```` fences, for inline
    mode (types.ts L978-1037).
- Python side: OpenRouter's OpenAI-compatible chat completions with `stream=True`. Forward each
  `choices[0].delta.content` to the browser as-is. For non-streaming, return the full text and let the browser
  `compileSpecStream` it, or ask for one JSON object and `JSON.parse` it. Python needs no json-render code. There are
  no Python bindings (open issue [#7](https://github.com/vercel-labs/json-render/issues/7); the maintainer replied
  "we'll definitely consider it"). OpenRouter-specific behavior (e.g. `response_format` support per model) was
  not researched: **UNVERIFIED**.
- SSR: the React renderer is marked `"use client"` (renderer.tsx L1, hooks.ts L1) and uses hooks/context, so it cannot
  run as a React Server Component (open issue [#369](https://github.com/vercel-labs/json-render/issues/369)).
  Classic `renderToString` inside `JSONUIProvider` works **[tested]**. Irrelevant for our Vite SPA.

## 8. Charts and component packs

- **No built-in chart components in any published package.** `@json-render/shadcn` ships 36 components (Card,
  Stack, Grid, Separator, Tabs, Accordion, Collapsible, Dialog, Drawer, Carousel, Table, Heading, Text, Image,
  Avatar, Badge, Alert, Progress, Skeleton, Spinner, Tooltip, Popover, Input, Textarea, Select, Checkbox, Radio,
  Switch, Slider, Button, Link, DropdownMenu, Toggle, ToggleGroup, ButtonGroup, Pagination) with no charts
  (GH/packages/shadcn/src/catalog.ts). It requires **Tailwind CSS v4**, Radix, lucide etc. (`npm view
  @json-render/shadcn peerDependencies`: `tailwindcss ^4.0.0`, `react ^19.0.0`, `zod ^4.0.0`). Our app does not use
  Tailwind, so this pack is not a fit. Open issue #355 also notes its Grid/Stack are not responsive.
- **Recharts appears only in examples**: `examples/dashboard` and `examples/chat` define `BarChart`/`LineChart` catalog
  entries whose `data` prop is fed by `{ "$state": ... }`, and render them with Recharts plus a shadcn `chart.tsx` wrapper
  (GH/examples/dashboard/lib/render/catalog.ts L351-378; GH/examples/dashboard/lib/render/registry.tsx L8, L506-565).
  The dashboard example is Next.js plus Postgres/Drizzle, and streams widgets via `useUIStream`
  (GH/examples/dashboard/README.md). Unlike our design, that example lets the LLM write the chart data
  into state. For us, the pattern to copy is "registry maps a catalog name to a Recharts component". The data flow is not.

## 9. Gotchas relevant to us

1. **Prop validation hole** (#378) and **validate() stripping fields** (#222). Do per-element `safeParse`. See Q5.
2. **The default prompt pushes the model to fabricate data.** See Q3. Don't ship `catalog.prompt()` unmodified.
3. **zod 4 only.** core depends on `zod ^4.3.6` directly as well as a peer. If the web app adds a different zod 4
   minor, npm may install two copies. History of zod-minor breakages: #287 (`visible` became required under zod 4.4,
   fixed in 0.20.0 per CHANGELOG L56) and #297 (Solid types pinned to zod 4.3, still open). With zod 4.6.7 + core 0.21.1,
   validation behaved correctly in my run **[tested]**. Pin `zod` and the `@json-render/*` versions exactly.
4. **Bundle size** **[tested, esbuild --minify, react/react-dom external, importing defineCatalog, schema,
   defineRegistry, Renderer, JSONUIProvider, validateSpec, autoFixSpec, compileSpecStream, z]**: ≈112 KB gzip
   including zod, ≈22 KB gzip excluding zod. The actual Vite production delta for our app is **UNVERIFIED**. A
   non-maintainer commenter on #369 reports "60 to 125 KB gzip … (the renderer plus zod)". Issue #49 raises
   registry/bundle scaling.
5. **Provider requirement**: `<Renderer>` must be inside `JSONUIProvider` (or the four providers). See Q6.
6. **Doc examples omit `children`**, which fails validation. See Q4.
7. **Malformed JSONL lines are silently dropped** (#196). Count expected vs. received tiles after parsing.
8. **Pre-1.0 churn and Labs status.** Breaking changes ship in minors (0.20.0). Pin versions and expect to re-check on upgrade.
9. **Prompt size** (~15.7k chars for 3 components) and no built-in "small prompt" option (#324). That is another
   reason to hand-write a compact prompt for our tiny vocabulary.
10. Built-in actions (`setState`, `pushState`, ...) are always advertised in the default prompt
    (GH/packages/react/src/schema.ts L57-78). If we don't want any interactivity, reject specs containing `on`/`watch`/`visible`
    and keep the prompt free of them.

## Unverified items

- End-to-end FastAPI → OpenRouter → `useUIStream`/`compileSpecStream` run (the design is supported by source reading; not executed).
- OpenRouter structured-output (`response_format: json_schema`) support for the models we'd use.
- Exact bundle delta in our Vite build. The figures above come from a standalone esbuild bundle.
