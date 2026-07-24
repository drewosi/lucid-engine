# MERIDIAN — Audit 3

**Version:** v0.6 (from `app/main.js:1`; the app console logs "v0.5" and the README's engine header says "v0.4" — see M5)
**Scope:** `app/*.js` (22 modules, ~5,900 LOC), `app.html`, `README.md`, `scripts/run-selftests.mjs`, `.github/workflows/selftests.yml`. Load-bearing modules read in full.
**Method:** Read the entry point, shared state, indexer, ingest, intent registry, smart-context, chat/prompt, trace, actions, local, drift, memory, viewer, export, and the self-test suite. Verified claims against source. Built a Node harness (`document`/`window`/`localStorage` stubbed, ~20 lines) that imports the **real** `state`/`smart-context`/`indexer`/`intents`/`demo` modules and loads the bundled `SAMPLE_PROJECT`, then ran the real `classifyIntent` + `runInvestigation` against natural-language queries to reproduce routing behavior. Could not run `scripts/run-selftests.mjs` (playwright not installed in this environment); assertion count verified statically instead.

Severity: CRITICAL (breaks a core flow or exposes data) · MODERATE (real bug under realistic use) · MINOR (polish, drift, hygiene)

---

## 0. Prior findings — re-verified in source

The v0.3/v0.5 audit fixes (`F1`–`F12`, tagged in `app/selftest.js` and `app/main.js`) all hold. Verified by reading the fix + independent harness checks, not by trusting the changelog.

| Prior finding | Status | Evidence |
|---|---|---|
| F1 · bounded ingest pool (caps fire mid-batch) | **Holds** | `ingest.js:63-105` re-checks both caps *after* the async read (`:83-86`); pool keeps ≤32 in flight (`:115-134`). Guard is no longer dead code behind a `Promise.all` fan-out. |
| F2 · command grammar can't hijack prose | **Holds** | `commandArg` (`intents.js:788-798`) rejects prose-shaped rest. Harness: "Exports keep breaking"→`plain`, "Tests are failing…, why?"→`reason`, `search "cache control"`→`search` (literal). |
| F3 · SMART grounding sent with nothing checked | **Holds** | `buildContextBlocks` (`prompt.js:242-248`) still pushes the grounding block when `map` is empty; self-test asserts `blocks.length===1`. |
| F4 · SSE split handles CRLF + unterminated tail | **Holds** | `splitSseEvents` (`chat.js:121-124`) splits on `/\r?\n\r?\n/`; `pump()` drains `tail.rest` at `r.done` (`:263-270`). |
| F5 · bounded, honest search | **Holds** | `localSearchData` aborts at 400K lines / 2s (`actions.js:35,65-66`); invalid regex → literal, flagged (`:54,81`). |
| F6 · legal `[ENTITY]`/`[JURISDICTION]` placeholders | **Open, by design** | `main.js:7` says so explicitly; README §"Before public launch" documents it. Not a defect. |
| F10 · >400-char lines skipped, disclosed | **Holds** | `indexer.js:411-414` counts them; `longLineNote` (`intents.js:84-88`) discloses in `orphans`/`broken`. |
| F12 · project-supplied keys can't hit `Object.prototype` | **Holds** | Null-proto maps in `indexer.js` (`:77,376-379`), `smart-context.js:30`, `intents.js:60,144`; self-test hits `byExt.constructor`. |

No fix introduced a new reachable bug. `SKIP_LIST_MAX=500` (`ingest.js:11`) bounds the `skippedFiles` list even when an 8,000-file over-cap load records an `over-cap` skip per file, so the F1 cap did not blow up the review list.

---

## 1. CRITICAL

None. This is a mature codebase two audit passes deep; the streaming path, ingest caps, CSP, and prototype hardening are sound. The real defects are in natural-language intent routing (below), which produces wrong or dead answers for a headline feature (the LOCAL engine) but does not break streaming, corrupt data, or leak anything.

---

## 2. MODERATE

### M1 · MODERATE — "what depends on X" returns the *opposite* of the truth
`app/intents.js:660` (the `imports` intent's `route`)

The `imports` intent (which lists what a file **imports**) claims the phrase "what depends on X":

```js
route: function (s, lo) { return /\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat.*\bdepend(s)? on\b/.test(lo) ? { arg: pickPathish(s) } : null; },
```

The `\bwhat.*\bdepend(s)? on\b` alternative matches **"what depends on store.js"** — but that phrase asks for store.js's **dependents** (who imports it), which is the `importers` intent, not `imports`. Because `imports` precedes `importers` in the cascade (`imports` is entry 23, `importers` 24), it wins and answers the wrong question.

**What the user experiences** (harness, sample project — `src/store.js` is imported by 2 files):

```
what depends on store.js  -> imports    :: No import statements found in `src/store.js`.
importers store.js        -> importers  :: `src/store.js` is imported by 2 files:
```

The engine confidently reports "No import statements found" for a file two others depend on. In a product whose entire thesis is *deterministic, verifiable, honest* answers, returning the inverse of ground truth to a common phrasing is the most damaging class of bug here. `"what does store.js depend on"` (genuinely `imports`) and `"dependencies of server.js"` (genuinely `imports`) both stay correct — only the inverted phrasing is wrong.

**How I verified it:** ran `classifyIntent` + `runInvestigation` on the real registry against the bundled `SAMPLE_PROJECT`; compared to the `importers` ground truth for the same file (both shown above).

**Fix:** the `imports` route should only claim the *"what does X depend on"* form, never *"what depends on X"*:

```js
route: function (s, lo) {
  return /\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat (?:do|does)\b[\s\S]*\bdepend on\b/.test(lo)
    ? { arg: pickPathish(s) } : null;
},
```

`"what depends on store.js"` then falls through to `importers` (whose regex already matches `depend(s|ents?|encies)?`), which answers correctly. `"what does store.js depend on"` still matches the new `what do(es) … depend on` clause and stays with `imports`.

**Test to add** (`app/selftest.js` `ROUTES` table, near the `imports`/`importers` rows):

```js
['what depends on store.js', 'importers'],   // dependents, NOT imports — must beat the imports route
['what does store.js depend on', 'imports'], // still X's own dependencies
```

---

### M2 · MODERATE — "who uses `<symbol>`" dead-ends on a file lookup instead of finding references
`app/intents.js:675` (the `importers` intent's `route`) and `:676-686` (its `run`)

The `importers` route is greedy about "who uses":

```js
route: function (s, lo) { return /\b(imports?|importe(rs|d)?|depend(s|ents?|encies)?|who (imports|uses|depends)|used by|includes)\b/.test(lo) ? { arg: pickPathish(s) } : null; },
```

`who (imports|uses|depends)` grabs **"who uses addTodo"**. `addTodo` is a *symbol*, not a file, so `importers.run` calls `resolveToFile('addTodo')`, gets nothing, and dead-ends. The neighboring phrasing "who **calls** addTodo" routes to `refs` and works:

```
who uses addTodo  -> importers  :: Could not resolve `addTodo` to a loaded file.
who calls addTodo -> refs       :: `addTodo` is referenced 8 times across 4 files.
who uses the store -> importers :: Could not resolve `uses` to a loaded file.   // pickPathish grabbed "uses"
```

"who uses X" is one of the most natural ways to ask for a symbol's references. The answer isn't just unhelpful — for "who uses the store" `pickPathish` picks the verb "uses" and reports *that* as unresolved, which reads as broken.

**How I verified it:** harness output above; confirmed `addTodo` is in the symbol index (`getIndex().symbols.has('addTodo') === true`) so a `refs`-style answer is available.

**Fix:** keep `importers` first (a *file* target legitimately means importers), but in `run`, when the arg resolves to no file yet **is** a known symbol, answer references instead of dead-ending:

```js
run: function (arg, q, idx) {
  var steps = [];
  var tf = resolveToFile(arg);
  if (!tf && symLookup(arg, idx).length) {                 // "who uses <symbol>" — X is a symbol, not a file
    var r = localSearchData(arg, 'refs');
    steps.push({ action: 'no file named “' + arg + '” — treat as a symbol', note: r.hits.length + ' reference' + (r.hits.length === 1 ? '' : 's'), evidence: r.hits.slice(0, 10).map(localEvidence), status: 'done' });
    return { steps: steps, verdict: LOCAL_VERDICT(),
      answer: r.hits.length ? '`' + arg + '` is referenced ' + (r.hits.length >= r.cap ? r.cap + '+' : r.hits.length) + ' time' + (r.hits.length === 1 ? '' : 's') + ' across ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's') + '. (No file is named `' + arg + '`, so this is a symbol reference search.) Chips open each at its line.' : 'No references to `' + arg + '` in the loaded files.' };
  }
  // …existing importer logic unchanged…
```

`symLookup`, `localSearchData`, and `localEvidence` are already imported by `intents.js`.

**Test to add:**

```js
var wu = inv('who uses addTodo');
ok('intent · who-uses <symbol> falls back to references', /referenced\s+8\s+time/.test(wu.answer), wu.answer.split('\n')[0]);
```

---

### M3 · MODERATE — "list all files" / "show all files" reports "No `.all` files loaded"
`app/intents.js:622-632` (the `listType` intent)

`listType` fires on `<word> files` and treats the word as an extension:

```js
route: function (s, lo) { return /\b(list|show|all)\b/.test(lo) && /\b(files?)\b/.test(lo) && /\b([a-z]{1,6})\b\s+files?\b/.test(lo) ? { arg: s } : null; },
run: function (arg, q) {
  var em = q.toLowerCase().match(/\b(typescript|javascript|python|golang|go|rust|java|ruby|markdown|html|css|json|yaml|c\+\+|c#|[a-z]{1,6})\s+files?\b/);
  …
  var want = em ? (alias[em[1]] || em[1]) : '';
  var matched = sortedPaths().filter(function (p) { return fileExt(p) === want; });
```

For **"list all files"**, `[a-z]{1,6}` before "files" captures the determiner `all`; no file has extension `all`:

```
list all files  -> listType :: No `.all` files loaded.
show me all files-> listType :: No `.all` files loaded.
show all the files-> listType:: No `.the` files loaded.
```

"list/show all files" is a plainly reasonable request to enumerate the project's files; the deterministic engine answers with a confusing null. The self-test covers `['list js files','listType']` but never the determiner case, so it passed clean.

**How I verified it:** harness output above against the real registry.

**Fix:** treat determiners as "no extension filter" and list all loaded paths. In `run`, after computing `want`:

```js
var DETERMINER = { all: 1, every: 1, the: 1, these: 1, those: 1, any: 1, my: 1, our: 1, your: 1 };
if (!want || DETERMINER[want]) {
  var everything = sortedPaths();
  return { steps: [{ action: 'list all loaded files', note: everything.length + ' file' + (everything.length === 1 ? '' : 's'), evidence: everything.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' }],
    verdict: LOCAL_VERDICT(),
    answer: everything.length + ' file' + (everything.length === 1 ? '' : 's') + ' loaded:\n\n' + everything.slice(0, 40).map(function (p) { return '- `' + p + '`'; }).join('\n') + (everything.length > 40 ? '\n\n… +' + (everything.length - 40) + ' more.' : '') };
}
```

**Test to add:**

```js
ok('intent · "list all files" lists files, not a `.all` filter', /files loaded:/.test(inv('list all files').answer));
```

---

## 3. MINOR

### M4 · MINOR — the `dirs` skip counter means "directories" on drop/FSA but "files" via the picker
`app/ingest.js:41-43,146` · `app/memory.js:69`

Ignored-directory skips are counted three different ways depending on the load path:

- **Drag-drop** (`collectEntry`, `ingest.js:146`) and **FSA reload** (`collectHandle`, `memory.js:69`) increment `st.skipped.dirs` **once per ignored directory**, then stop descending.
- **The `webkitdirectory` picker fallback** (`pickHandler` → `ingestFile` → `ignoredPath`, `ingest.js:70`) increments `st.skipped.dirs` **once per file** inside any ignored/dot directory.

Both feed the same counter, which `skipSummary`/`afterIngest` render as "*N* ignored-dir" in the skip note and the load toast (`ingest.js:27,191,195`). So the **same folder** loaded on Chrome (FSA, per-directory) vs Firefox/Safari (picker fallback, per-file) reports wildly different totals — a `node_modules/` with 5,000 files shows "1 ignored-dir" one way and "5,000 ignored-dir" the other. The README (line 123) promises "everything skipped is counted, attributed, and reviewable"; the count is real but its unit silently changes with the browser.

**How I verified it:** read all three walkers. `collectEntry`/`collectHandle` do `st.skipped.dirs++` inside the `isDirectory` branch and return without recursing; `ignoredPath` (called per file by `pickHandler`) does `st.skipped.dirs++` per matching path segment.

**Fix:** make the picker path count directories, not files — skip the whole ignored subtree once. Simplest: in `pickHandler`, drop ignored-dir files silently (they're already excluded from the reviewable list) and count distinct ignored top segments:

```js
function pickHandler(input) {
  st.lastDirHandle = null; beginBatch();
  var list = Array.prototype.slice.call(input.files || []), seenIgnored = {};
  var kept = [];
  list.forEach(function (f) {
    var path = (f.webkitRelativePath || f.name);
    var seg = path.split('/').find(function (s) { return IGNORE_DIRS.indexOf(s.toLowerCase()) !== -1 || (s !== '.' && s.charAt(0) === '.' && s !== '.github' && s !== '.env.example'); });
    if (seg) { if (!seenIgnored[seg]) { seenIgnored[seg] = 1; st.skipped.dirs++; } return; }
    kept.push({ path: path, getFile: function () { return Promise.resolve(f); } });
  });
  runIngestPool(kept).then(afterIngest);
  input.value = '';
}
```

(`ingestFile`'s own `ignoredPath` guard then becomes a belt-and-suspenders no-op for the picker path.)

**Test to add:** feed `runIngestPool` a synthetic batch of 3 files under `node_modules/` + 1 real file and assert `st.skipped.dirs === 1`, not `3`.

---

### M5 · MINOR — the engine version disagrees with itself in three places
`README.md:85` · `app/main.js:1` · `app/main.js:85`

- `app/main.js:1` (file header): **"MERIDIAN Engine v0.6"**
- `app/main.js:85` (browser console banner the user sees): **"Engine v0.5"**
- `README.md:85` (the "Engine internals" version header): **"*(MERIDIAN Engine v0.4)*"**

The README's "Recent improvements" changelog tops out at a v0.5 entry (line 89) while the CSP section (line 139) and the code both reference v0.6 ("Tailwind's Play CDN was removed in v0.6") — so v0.6 shipped but has no changelog entry and the headline version label still reads v0.4. For a project that markets honest self-labeling (`SIM`/`ROADMAP`/`PLANNED` chips, the whole "the basement is a laboratory" thesis), a version string that's wrong in the two most-read spots (the README header and the console banner) is a small but on-brand-sensitive drift.

The test-count numbers, by contrast, check out: the suite runs **~208 assertions** at runtime (146 static `ok('…')` sites, minus the one inside `ROUTES.forEach` which expands to 63, ≈145 + 63), matching the "200+ checks" claim (README line 143). The "174" (v0.5) and "143" (v0.4) figures are version-stamped changelog history, not current-state claims — those are fine.

**Fix:** set all three to the same string (v0.6), add a one-line v0.6 changelog entry, and — since the console banner is user-visible — pull the version from one constant rather than three literals.

**Test to add:** none warranted; a `grep -n "Engine v0" app/main.js README.md` in CI that asserts a single version would prevent recurrence.

---

## 4. Verdict

**Fix order:**

1. **M1 — "what depends on X" inversion (~10 min).** One regex clause. It returns the confident opposite of the truth for a common query, and it's the single finding most corrosive to the LOCAL engine's honesty positioning. Ship the regex change + the two-row routing test first.
2. **M2 — "who uses `<symbol>`" dead-end (~20 min).** A `run`-level fallback using helpers already imported. Turns a broken-looking null into the reference list the user wanted.
3. **M3 — "list/show all files" (~15 min).** Determiner guard in `listType.run`. Small, self-contained, adds a real capability (enumerate files) the engine oddly lacked.
4. **M5 — version strings (~5 min).** Trivial; do it in the same commit as M1 since you're touching the docs anyway.
5. **M4 — dirs counter (~20 min).** Cosmetic-count consistency; defer if time-boxed, but it undercuts a stated honesty guarantee, so don't drop it.

All five are contained to intent routing, one ingest counter, and docs — none touch the streaming, caching, CSP, or ingest-cap machinery, which are the load-bearing correctness surfaces and are in good shape. **Safe to defer indefinitely:** F6 (legal placeholders, deliberately open); the `search foo bar` (unquoted multi-word) fall-through, which is disclosed behavior ("quote it").

**What this codebase does well — specifically, with evidence:**

- **`state.js` is 44 lines with explicit, named invalidation helpers** (`invalidateSelection`/`invalidateAll`, `state.js:38-41`) and dirty-flag caches primed only through `getIndex()`/`buildProjectMap()`/`assembleContext()`. The index is deliberately decoupled from *selection* (only content changes set `indexDirty`), so toggling checkboxes never rebuilds the symbol graph — a real perf win called out and honored.
- **The preview and the real request share one code path.** `openPreview` (`ingest.js:440-509`) calls the same `buildProjectMap`/`packSmartContext`/`buildInvestigationBlock` the send uses, so `[ PREVIEW SEND ]` provably cannot drift from what's transmitted. Same discipline for the FOUND panel vs. the grounding block (`prompt.js` `serializeInvestigationContext` returns the single object both consume).
- **Prompt-cache preservation is correct, not just claimed.** `chat.js:150` orders `[instrBlock, …cb.blocks]` with `cache_control` on the instruction and map blocks only, and the per-question grounding + packed files are appended *after* the last breakpoint (`prompt.js:252-256`) — so the stable prefix genuinely stays cache-eligible (≤2 of Anthropic's 4 breakpoints used).
- **The honesty machinery is real.** `traceAuthentic` (`trace.js:109-119`) refuses to strip a "trace" whose citations don't resolve locally, so an answer *quoting* the trace format survives intact (self-test `trace · quoted example not stripped`); dead citations are counted and surfaced (`trace.js:333-344`); `longLineNote` discloses the indexer's >400-char blind spot inside `orphans`/`broken`. The CSP in `app.html:17` matches the README byte-for-byte, ships zero third-party script origins, and the residual (top-level-navigation exfil) is disclosed rather than hidden.

Keep those instincts. The routing cascade is the one place where the "one ordered registry, array order is the cascade" elegance (`intents.js:282`) trades correctness for terseness — every collision above is a case where an earlier, broader regex swallows a phrasing a later, correct intent was written for. The fix isn't to abandon the cascade; it's to keep tightening the greedy regexes (M1, M2) and to grow the `ROUTES` table with the natural phrasings real users type, not just the command forms.
