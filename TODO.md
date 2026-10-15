# TODO

## Chart gallery

### 1. Same chart saved more than once (priority)

**Seen:** asking the same question in two chats saves two cards with the same meaning, e.g. two
"Total Revenue by Store" charts with identical rows (see `docs/screencap-3.png`).

**Cause:** dedup keys on `sha256(normalized SQL + chart type)`. sqlglot normalization only merges
whitespace, casing and comments. The model writes different SQL for the same question (other
aliases, join order, `GROUP BY 1` vs a column name, an extra `ORDER BY`), so each run gets a new key.

**Options to evaluate:**
- **Result fingerprint:** also key on the result itself (`chart_type` + `x_field` + `y_fields` +
  a hash of the sorted rows). Same question, same data → same chart, whatever the SQL looks like.
  Cheap and deterministic; misses a re-ask after the data changed.
- **Semantic near-duplicate check:** compare the new title + description with existing charts
  (embedding similarity above a threshold, plus overlapping tables) and update the existing chart
  instead of creating one. Catches more, but needs an embedder on the server and a tuned threshold.
- **Tell the model:** have `save_chart` return the closest existing chart, and let the analyst
  decide whether to update it (pass its id) or save a new one.
- **Display only:** fold near-identical titles in the list and related charts. Hides the symptom;
  storage still duplicates.

**Done when:** re-asking a question in a new chat updates the existing chart (status `updated`) in
a test with two differently written but equivalent SQL queries, and the existing dedup tests still
pass. Existing duplicates in a running gallery need a one-off merge or a volume reset.

### 2. Smaller follow-ups from the branch review

- [ ] Untrack compiled files: `git rm --cached -r wren/tests/__pycache__`
- [ ] Malformed JSON without a token gets 422 before 401 (FastAPI parses the body before the auth
      dependency) — check the token in the `limit_body` middleware for `/internal/`
- [ ] Gallery API checks fields only on `rows[0]` and not y value types — validate every row
      (defence in depth; `save_chart` already validates)
- [ ] `save_chart` accepts a y field whose values are all `null` → empty plot; reject it
- [ ] "refining…" never clears if the worker never boots — add a timeout
- [ ] Pin `httpx` in `wren/Dockerfile` (today it only arrives through `mcp`)
- [ ] Axis labels: shorten ISO timestamps on the x-axis and big numbers on the y-axis (`8000000` → `8M`)
- [ ] The list page starts the ~23 MB model download (warm-up) — document it or defer to the detail page
- [ ] Gallery image is 559 MB: copy only the onnxruntime build that is used, and drop the unused
      27 MB wasm Vite bundles into `assets/`
