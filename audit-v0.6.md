# MERIDIAN — Audit 4 (routing + hardening; all engine findings now closed)

**Version:** v0.6 — now consistent across `app/main.js:1`, the console banner (`app/main.js:85`), and the README engine header (`README.md:85`). (M5, fixed this pass.)
**Scope:** `app/*.js` (22 modules, ~5,950 LOC) — all read in full across audits 3–4; `app.html`; `README.md`; `scripts/*`. Landing page `index.html` and the static marketing/legal pages: **spot-checked only** (see §4), not a full audit.
**Method:** Read every workbench module. Verified claims against source. A Node harness (`document`/`window`/`localStorage` stubbed, ~20 lines) imports the **real** modules and (a) runs `classifyIntent`/`runInvestigation` over natural-language queries, and (b) drives the **entire in-app `runSelfTests()` suite headlessly — 218/218 assertions pass** with the fixes below applied. Limitation: this is the JSDOM-stub path; the project's own `scripts/run-selftests.mjs` needs playwright, which isn't installed here, so it was not run in-browser.

Severity: CRITICAL (breaks a core flow or exposes data) · MODERATE (real bug under realistic use) · MINOR (polish, drift, hygiene)

---

## 0. Prior findings — re-verified in source

Audit 2 fixes (`F1`–`F12`) and audit 3 fixes (`M1`–`M3`) all hold; verified by reading each fix plus the headless suite (218/218).

| Finding | Status | Evidence |
|---|---|---|
| F1–F5, F10, F12 (audit 2) | Hold | Re-checked in audits 3–4; bounded pool, command gate, SSE CRLF, bounded search, long-line disclosure, null-proto maps all intact. |
| F6 · legal placeholders | Open, by design | `main.js:7` says so. |
| M1 · "what depends on X" inversion | **Fixed (audit 3)** | `imports` route no longer claims `what depends on X`; `intents.js` + `ROUTES` rows. |
| M2 · "who uses `<symbol>`" dead-end | **Fixed (audit 3)** | `importers.run` symbol fallback; suite green. |
| M3 · "list all files" | **Fixed (audit 3)** | `listType.run` determiner guard; suite green. |

---

## 1. CRITICAL / 2. MODERATE

None found this pass. The remaining open items were both MINOR; both are now fixed (§3).

---

## 3. Fixed this pass (audit 4 — were MINOR/open)

All three reproduced with the harness, fixed, covered by new self-tests; **218/218 suite green** and the **66 existing `ROUTES` rows show 0 kind changes**.

### M4 · FIXED — the `dirs` skip counter now means the same thing on every load path
`app/ingest.js` — new `ignoredDirPrefix()` helper + `pickHandler`

`st.skipped.dirs` was counted once per ignored *directory* on the drag-drop (`collectEntry`) and File-System-Access (`collectHandle`) paths, but once per *file* on the `webkitdirectory` picker fallback (`ignoredPath` inside `ingestFile`) — so the same `node_modules/` reported "1 ignored-dir" on Chrome and thousands on Firefox/Safari, undercutting the README's "everything skipped is counted, attributed, and reviewable" (line 123).

**Fix (landed):** added a pure `ignoredDirPrefix(path)` (mirrors the directory-level skip in `collectEntry`/`collectHandle`) and made `pickHandler` pre-filter files under an ignored directory, tallying each distinct dir prefix **once**. Dot-*files* in normal dirs still fall through to `ingestFile`'s `ignoredPath` guard (counted per file on every path — unchanged and consistent).

```
ignoredDirPrefix('proj/node_modules/x/y.js') === 'proj/node_modules'
ignoredDirPrefix('a/.cache/b.js')            === 'a/.cache'
ignoredDirPrefix('src/app.js')               === ''
ignoredDirPrefix('foo/.env')                 === ''   // a dot-file, not a dir
```

**Tests added:** four `ignoredDirPrefix` assertions covering IGNORE_DIRS segments, dot-dirs, clean paths, and the dot-file-basename case.

### M5 · FIXED — the engine version now agrees with itself
`README.md:85` · `app/main.js:85`

`README.md:85` said v0.4, the user-visible console banner said v0.5, and the code header said v0.6, with no v0.6 changelog entry.

**Fix (landed):** README header and console banner both → **v0.6**; added a concise v0.6 bullet to "Recent improvements" summarizing audits 3–4. The version-stamped history (v0.5 "174", v0.4 "143", v0.3 "47" checks) is left intact — it is correct history. The current "200+ checks" claim (README:143) stays accurate: the suite now runs **218 assertions**.

### M2-residual · FIXED — "who uses the store" resolves the noun, not the verb
`app/intents.js` — `pickSymbol`

`pickSymbol`'s final `queryTerms` fallback returned `terms[0]`, so `"who uses the store"` picked the verb *"uses"* and `importers` dead-ended at *"Could not resolve `uses`"*.

**Fix (landed):** a small `PICK_SKIP` set of usage/dependency verbs (`uses`/`use`/`used`/`using`/`call(s)`/`import(s)`/`depend(s)`/`reference(s)`…) is skipped in that fallback, so the first real noun is picked; falls back to `terms[0]` if every term is a verb. Symbol- and path-shaped tokens are still picked earlier, so no existing routing or arg assertion changed.

```
before:  who uses the store -> importers :: Could not resolve `uses` to a loaded file.
after:   who uses the store -> importers :: `src/store.js` is imported by 2 files:
         who uses addTodo   -> importers :: `addTodo` is referenced 8 times… (unchanged)
```

**Test added:** `inv('who uses the store')` matches `/imported by \d+ file/` and contains no *"Could not resolve"*.

---

## 4. Open / not yet audited

- **F6 · legal placeholders** — deliberately open (`[ENTITY]`/`[JURISDICTION]`); pre-launch task, documented in the README.
- **Landing page `index.html` + static pages — not fully audited.** This pass spot-checked the two claim-heavy areas: the **goatcounter analytics snippet is correctly commented out** by default (`index.html:1259-1263`), and the **waitlist defaults to the localStorage-only fallback** with honest copy (`FORMSPREE_ID='YOUR_FORM_ID'` → `FS_LIVE=false`; the field note reads "stored in this browser only — nothing is transmitted"). Both match the README. The remaining ~2,000 lines (Canvas particle field, command palette, FAQ, trace-console SIM) were **not** audited — recommended as the next pass.

---

## 5. Verdict

**All engine-level findings from audits 3–4 are now closed** (M1–M3 in audit 3; M4, M5, and the M2 residual here), each with a self-test; the suite is green at 218/218 and no existing route changed meaning. The only deliberately-open item is F6 (legal placeholders, a pre-launch task). The natural next step is a first full audit of the landing page `index.html`, the one substantial surface not yet covered.

**What this codebase does well — specifically, with evidence:**

- **`state.js` is 44 lines with explicit invalidation helpers**; the symbol index is decoupled from selection, so toggling checkboxes never rebuilds the graph.
- **Preview and the real request share one code path** (`ingest.js` `openPreview` → `buildProjectMap`/`packSmartContext`/`buildInvestigationBlock`), so `[ PREVIEW SEND ]` cannot drift from what's sent.
- **Prompt-cache preservation is correct** — `cache_control` sits on the instruction + map blocks only, with per-question grounding appended after the last breakpoint (`prompt.js:252-256`).
- **The honesty machinery is real** — `traceAuthentic` refuses to strip a "trace" whose citations don't resolve locally; dead citations are counted and surfaced; the CSP in `app.html:17` matches the README byte-for-byte with zero third-party script origins. This pass added a fourth data point: the *skip accounting* is now honest across load paths (M4), and the *version labelling* the project stakes its credibility on is now self-consistent (M5).

The routing cascade (`intents.js:282`, "array order is the routing cascade") remains the one spot where terseness trades against correctness — every collision fixed across audits 3–4 was an earlier, broader regex swallowing a phrasing a later intent was written for. The durable discipline, applied again this pass: keep the picker (`pickSymbol`) from mistaking verbs for targets, and keep growing the `ROUTES` table with the phrasings real users type.
