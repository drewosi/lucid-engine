# MERIDIAN — Audit 3 (with M1–M3 fixed this pass)

**Version:** v0.6 (from `app/main.js:1`; the app console logs "v0.5" and the README's engine header says "v0.4" — see M5, still open)
**Scope:** `app/*.js` (22 modules, ~5,900 LOC), `app.html`, `README.md`, `scripts/run-selftests.mjs`, `.github/workflows/selftests.yml`. Load-bearing modules read in full.
**Method:** Read the entry point, shared state, indexer, ingest, intent registry, smart-context, chat/prompt, trace, actions, local, drift, memory, viewer, export, and the self-test suite. Verified claims against source. Built a Node harness (`document`/`window`/`localStorage` stubbed, ~20 lines) that imports the **real** modules and (a) runs `classifyIntent`/`runInvestigation` against natural-language queries, and (b) drives the **entire in-app self-test suite** (`runSelfTests()`) headlessly — **213/213 assertions pass** with the fixes below applied.

Severity: CRITICAL (breaks a core flow or exposes data) · MODERATE (real bug under realistic use) · MINOR (polish, drift, hygiene)

---

## 0. Prior findings — re-verified in source

The v0.3/v0.5 audit fixes (`F1`–`F12`, tagged in `app/selftest.js` and `app/main.js`) all hold; verified by reading each fix plus the headless suite.

| Prior finding | Status | Evidence |
|---|---|---|
| F1 · bounded ingest pool (caps fire mid-batch) | Holds | `ingest.js:63-105` re-checks both caps after the async read; pool keeps ≤32 in flight (`:115-134`). |
| F2 · command grammar can't hijack prose | Holds | `commandArg` (`intents.js`) rejects prose-shaped rest; suite `route ·` rows green. |
| F3 · SMART grounding sent with nothing checked | Holds | `buildContextBlocks` (`prompt.js:242-248`); suite asserts `blocks.length===1`. |
| F4 · SSE split handles CRLF + unterminated tail | Holds | `splitSseEvents` (`chat.js:121-124`); `pump()` drains the tail at `r.done`. |
| F5 · bounded, honest search | Holds | `localSearchData` aborts at 400K lines / 2s; invalid regex → literal, flagged. |
| F6 · legal placeholders | Open, by design | `main.js:7` says so; README documents it. Not a defect. |
| F10 · >400-char lines skipped, disclosed | Holds | `indexer.js:411-414` + `longLineNote`. |
| F12 · project keys can't hit `Object.prototype` | Holds | Null-proto maps throughout; suite hits `byExt.constructor`. |

No prior fix introduced a new reachable bug.

---

## 1. CRITICAL

None. The streaming path, ingest caps, CSP, and prototype hardening are sound.

---

## 2. Fixed this pass (were MODERATE)

All three were reproduced with the harness, fixed in `app/intents.js`, covered by new self-tests, and re-verified: full suite **213/213 green**, and a regression sweep of the **64 existing `ROUTES` rows through the edited router shows 0 kind changes** beyond the one intended (M1).

### M1 · FIXED — "what depends on X" no longer returns the inverse of the truth
`app/intents.js:660` (the `imports` intent's `route`)

The `imports` route claimed `"what depends on store.js"` via `\bwhat.*\bdepend(s)? on\b` and answered with store.js's *own* imports (*"No import statements found"*) instead of its dependents.

**Fix (landed):** replaced that alternative with `\bwhat (?:do|does)\b[\s\S]*\bdepend on\b`, so only the *"what does X depend on"* form stays on `imports`; *"what depends on X"* falls through to `importers`.

```
before:  what depends on store.js  -> imports    :: No import statements found in `src/store.js`.
after:   what depends on store.js  -> importers  :: `src/store.js` is imported by 2 files:
         what does store.js depend on -> imports :: (store's own imports — unchanged)
         dependencies of server.js    -> imports :: `src/server.js` has 4 imports. (unchanged)
```

**Tests added** (`app/selftest.js` `ROUTES`): `['what depends on store.js','importers']`, `['what does store.js depend on','imports']`.

### M2 · FIXED — "who uses `<symbol>`" now answers references instead of dead-ending
`app/intents.js` (the `importers` intent's `run`)

`who (imports|uses|depends)` in the `importers` route grabbed `"who uses addTodo"`; `addTodo` is a symbol, so `resolveToFile` failed and the answer dead-ended at *"Could not resolve `addTodo` to a loaded file."*

**Fix (landed):** at the top of `importers.run`, when the arg resolves to no file **but** `symLookup(arg, idx)` is non-empty, answer a symbol-reference search (reusing `localSearchData`/`localEvidence`, already imported) instead of dead-ending. `importers` still precedes `refs`, so a real *file* target is unaffected.

```
before:  who uses addTodo -> importers :: Could not resolve `addTodo` to a loaded file.
after:   who uses addTodo -> importers :: `addTodo` is referenced 8 times across 4 files.
         who calls addTodo -> refs     :: (unchanged)
         who imports store.js -> importers :: `src/store.js` is imported by 2 files: (unchanged)
```

**Test added:** `inv('who uses addTodo')` answer matches `/referenced\s+\d+\s+time/` and contains no *"Could not resolve"*.

**Residual (honest):** `"who uses the store"` still reports *"Could not resolve `uses`"* — here `pickPathish` picks the verb "uses" as the token, and "the store" is not an indexed symbol, so the M2 fallback doesn't trigger. This is a separate, lower-frequency `pickPathish` weakness (verb-as-token), not the symbol case M2 fixes. Left open as a MINOR follow-up; noted rather than silently ignored.

### M3 · FIXED — "list all files" now lists files instead of a bogus `.all` filter
`app/intents.js` (the `listType` intent's `run`)

`listType` read the determiner in `"list all files"` as an extension → *"No .all files loaded"*.

**Fix (landed):** in `listType.run`, when the captured word is empty or a determiner (`all`/`every`/`the`/`these`/`those`/`any`/`my`/`our`/`your`), list every loaded path (via `sortedPaths()`, 40 shown) instead of filtering. The route is unchanged; a real extension (`list js files`) still filters.

```
before:  list all files -> listType :: No `.all` files loaded.
after:   list all files -> listType :: 8 files loaded: …
         list js files  -> listType :: 6 `.js` files: … (unchanged)
```

**Tests added:** `inv('list all files')` matches `/files loaded:/`; `inv('list js files')` still matches `/`.js` file/`.

---

## 3. MINOR (open — not in scope for this change)

### M4 · MINOR — the `dirs` skip counter is per-directory on drop/FSA but per-file via the picker
`app/ingest.js:41-43,146` · `app/memory.js:69`

Drag-drop (`collectEntry`) and FSA reload (`collectHandle`) increment `st.skipped.dirs` once per ignored directory; the `webkitdirectory` picker fallback (`ignoredPath`) increments once per file inside an ignored dir. Both feed the same "*N* ignored-dir" figure, so the same `node_modules/` reports "1" on Chrome (FSA) and thousands on Firefox/Safari (picker) — the count's unit silently changes with the browser, undercutting the README's "everything skipped is counted, attributed, and reviewable" (line 123). Fix: make the picker path count distinct ignored top segments once and drop those files silently (patch sketched in the prior write-up). ~20 min.

### M5 · MINOR — the engine version disagrees with itself
`README.md:85` (v0.4) · `app/main.js:1` (v0.6) · `app/main.js:85` (console banner: v0.5)

v0.6 shipped (code header + CSP prose) but the README's version header still reads v0.4 and the user-visible console banner reads v0.5, with no v0.6 changelog entry. On-brand-sensitive for a project built on honest self-labeling. The test-count claim ("200+", README line 143) is accurate — the suite now runs **213 assertions**. Fix: single version constant across all three; add a v0.6 changelog line. ~5 min.

---

## 4. Verdict

**This pass landed M1–M3** (the routing collisions), the highest-value fixes, each with a self-test; the suite is green at 213/213 and no existing route changed meaning. **Remaining, in priority order:**

1. **M4 — dirs skip-counter (~20 min).** Cosmetic-count consistency, but it undercuts a stated honesty guarantee.
2. **M5 — version strings (~5 min).** Trivial; do it next time the docs are touched.
3. **`pickSymbol`/`pickPathish` verb-as-token (the M2 residual, ~15 min).** `"who uses the store"` and similar pick a verb over the noun. Lower frequency; worth a follow-up when routing is next revisited.

None of the open items touch streaming, caching, CSP, or the ingest-cap machinery — the load-bearing correctness surfaces, which remain in good shape.

**What this codebase does well — specifically, with evidence:**

- **`state.js` is 44 lines with explicit, named invalidation helpers** (`invalidateSelection`/`invalidateAll`) and dirty-flag caches primed only through `getIndex()`/`buildProjectMap()`/`assembleContext()`. The symbol index is decoupled from *selection*, so toggling checkboxes never rebuilds the graph.
- **Preview and the real request share one code path.** `openPreview` (`ingest.js:440-509`) calls the same `buildProjectMap`/`packSmartContext`/`buildInvestigationBlock` the send uses — `[ PREVIEW SEND ]` provably cannot drift from what's transmitted.
- **Prompt-cache preservation is correct, not just claimed.** `chat.js:150` puts `cache_control` on the instruction + map blocks only, and the per-question grounding + packed files are appended *after* the last breakpoint (`prompt.js:252-256`), so the stable prefix stays cache-eligible.
- **The honesty machinery is real.** `traceAuthentic` (`trace.js:109-119`) refuses to strip a "trace" whose citations don't resolve locally; dead citations are counted and surfaced; `longLineNote` discloses the indexer's >400-char blind spot inside `orphans`/`broken`. The CSP in `app.html:17` matches the README byte-for-byte and ships zero third-party script origins.

The routing cascade (`intents.js:282`, "array order is the routing cascade") is elegant but is the one place where terseness trades against correctness: every collision fixed this pass was an earlier, broader regex swallowing a phrasing a later, correct intent was written for. The durable fix isn't to abandon the cascade — it's to keep tightening the greedy regexes and to grow the `ROUTES` table with the natural phrasings real users type, which this pass did.
