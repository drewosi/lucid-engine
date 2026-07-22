# LUCID ENGINE

**Drew's personal design DNA — and MERIDIAN, the instrument built on it. Now a real, working product in free beta.**

> Lucid Engine is the combination of **hospitable clarity**, **visible engineering**, and **cinematic depth**.
> *"The front door is a museum. The basement is a laboratory."*

## Live

| Page | URL |
|------|-----|
| **MERIDIAN** — landing page | https://drewosi.github.io/lucid-engine/ |
| **MERIDIAN Workbench** — the app (free beta) | https://drewosi.github.io/lucid-engine/app.html |
| **One-pager** — the pitch on one page | https://drewosi.github.io/lucid-engine/one-pager.html |
| **Design DNA** — the system itself | https://drewosi.github.io/lucid-engine/dna.html |
| Terms · Privacy | [terms.html](https://drewosi.github.io/lucid-engine/terms.html) · [privacy.html](https://drewosi.github.io/lucid-engine/privacy.html) |

## One-pager & demo

A clean [**one-pager**](one-pager.html) (`one-pager.html`) states the whole pitch on a single
screen and prints to one PDF page — six pillars, each labeled `LIVE`, over an honest ledger of
what's live vs `ROADMAP`/`PLANNED`. Like everything here it's one dependency-free file.

![MERIDIAN — LOCAL engine demo](media/meridian-demo.gif)

> The clip above is a **real screen capture** of the workbench running its built-in demo — a tiny
> `todo-api` answered entirely by the deterministic **LOCAL** engine (no key, no AI, no network).
> The UI labels itself as it goes: `DEMO · LOCAL ENGINE`, `LOCAL · NO AI`, `KNOWN LOCALLY`.
> An evidence chip opens the cited file at the cited line; the session exports as HTML + Markdown.
> Higher-quality [`MP4`](media/meridian-demo.mp4).

The recording is fully reproducible — no faked frames:

```
npm i playwright @ffmpeg-installer/ffmpeg   # throwaway toolchain (gitignored)
node scripts/record-demo.mjs                # drives app.html's LOCAL demo → scripts/.rec/*.webm
bash scripts/encode-demo.sh                 # → media/meridian-demo.mp4 + .gif
```

## What MERIDIAN is now

A **browser-only AI workbench**. You bring your own API key (Anthropic, OpenAI, or any OpenAI-compatible endpoint), load a project folder into your browser's memory, and ask questions. Every answer streams back with a **trace** — the reasoning steps, pinned to the exact files and lines they stand on, as clickable evidence chips that open the cited file at the cited range.

Underneath the chat, MERIDIAN is a **deterministic project-intelligence engine**: it understands the terrain of a project *before* a model enters the room. On load it indexes the project — symbols, import/importer edges, entry points, tests, packages — and shows a **PROJECT INTELLIGENCE** overview. The AI model is an optional reasoning layer on top of that understanding, not the foundation.

Don't want to use an API at all? The **LOCAL engine** (settings → PROVIDER → LOCAL) answers with **no key, no AI, and zero network**. It routes each question by intent and runs a real investigation over the project index, returning findings through the same trace + evidence-chip UI, honestly labeled `LOCAL · NO AI`. Every answer carries a verdict — **KNOWN LOCALLY** (structure, definitions, references, imports/importers, related files, recent changes, evidence) or **REQUIRES MODEL REASONING** (root-cause, synthesis, architectural recommendations). When a model *is* connected, MERIDIAN sends only the relevant evidence, never the whole repo.

The architecture *is* the privacy story:

- **No backend.** The whole product is static files on GitHub Pages. There is no server of ours to receive your data.
- **BYO key.** Requests go directly from the browser to the chosen provider's API under the user's own account. Keys live in localStorage only, one per provider.
- **Zero egress to us.** File contents and conversations exist in tab memory and vanish on close. Saved projects persist **metadata only** (file tree + settings) in IndexedDB.
- **Prompt caching.** On Anthropic, the stable context block is cached, so multi-turn conversations over a big project cost ~10× less on input after the first turn.

### The smart context engine

Medium and large codebases no longer blow the context window. In **SMART** mode (auto-enabled when the loaded project exceeds ~70% of the model's context) each question sends:

1. a **project map** — the full file tree with language-aware token counts, package roots marked (`◆ PACKAGE`, monorepo-aware: package.json / Cargo.toml / pyproject.toml / go.mod detected per directory), plus the heads of key files (READMEs, manifests, entry points — including the largest sub-packages');
2. the **most relevant files**, scored by type weight, recency (file *and* directory), path depth, and query keywords — debug-worded questions boost test files, onboarding-worded questions boost docs — greedily packed into an adjustable token budget (default ≤120K). Files too large to send whole are excerpted **with their true line numbers kept** and omitted ranges marked — so evidence citations stay verifiable in the viewer.

**FULL** mode (every checked file, whole) remains one click away. `[ PREVIEW SEND ]` shows exactly what the next question will transmit — map, file list, whole-vs-excerpt, token estimates — computed by the same code path as the real request. Skipped files (binary / oversized / pattern) are summarized in the rail with a `[ REVIEW SKIPPED ]` modal that can pull individual files back in — and a count badge on the CONTEXT toggle plus an actionable `[ REVIEW ]` toast on load make them impossible to miss.

### Grounding — the engine feeds the model

With `[ GROUND: ON ]` (default), every model question first runs Meridian's deterministic investigation locally, then attaches its **verified findings** — the exact `path:line` evidence — as a context block the model reasons on top of. The model is told to prefer citing those lines, so answers are anchored to what Meridian actually found rather than the model's guess. The grounding block is per-question and placed **after** the cached map/context, so Anthropic prompt caching of the stable prefix is preserved. It appears in `[ PREVIEW SEND ]` like everything else, and the toggle turns it off for a raw context-only request.

### Also on the bench

- **Project intelligence engine** *(deterministic, no API)* — on load MERIDIAN builds a structured index of the project (symbols, import/importer edges, entry points, tests, configs, docs, packages) and surfaces a **PROJECT INTELLIGENCE** overview of the terrain. This index powers the LOCAL engine and is always available regardless of provider.
- **LOCAL engine** *(no API)* — a provider that uses no key, no model, and no network. It routes each question by intent and runs a real investigation over the index: definitions (`def`), references (`refs`), importers/imports, related files, symbols, structure, tests, entry points, recent changes, plus `search` / `dir` / `recent` commands — all answered through the same trace + evidence-chip UI with a **KNOWN LOCALLY / REQUIRES MODEL REASONING** verdict, labeled `LOCAL · NO AI`. Interpretation questions honestly say a model is needed rather than fabricating an answer. Fully offline; keeps the zero-third-party-scripts guarantee.
- **Project memory** — save named projects (tree + selection + ignore patterns + context prefs, never contents). Folders opened via the File System Access API reload from disk in one click.
- **Ignore patterns** — per-project glob-lite filters applied at ingest, with a one-click **Suggest** that proposes common junk-file globs grounded in what you've actually loaded.
- **First-run demo** — new visitors can load a tiny bundled sample project and get a real answer from the **LOCAL** engine — trace, evidence chips, and a `KNOWN LOCALLY` verdict — before committing any API key. Reachable any time from the empty state or the command palette.
- **Propose Action** *(experimental)* — the model may suggest read-only actions: `search` (with optional path filter), `def` / `refs` symbol navigation, `dir` summaries, `recent` changes — all run locally against in-memory files after a click; `open` opens the viewer, `git` commands are display + copy only. Nothing ever executes without approval; shell is never executed.
- **Exportable traces** — the whole session (answers, traces, and the actual cited lines) as Markdown or a self-contained zero-asset HTML page. Or copy just one: every answer carries a `[ COPY ]` control (that exchange as Markdown), and every evidence chip a one-click copy of its `path:line` + quote.
- **Session cost, always visible** — a live `$` chip in the nav tracks estimated spend (prompt-cache aware) as answers stream, with a one-click reset; it's no longer only a send-time readout.
- **Provider quick-switch** — a nav selector flips between Anthropic, OpenAI, a custom endpoint, and LOCAL without a trip through settings; each provider keeps its own key.
- **Command palette** — `Ctrl-K` in the workbench, plus `Ctrl-E` export, `Ctrl-.` settings, `Ctrl-Shift-O` pick folder, `?` keymap (also a visible `? KEYS` button in the nav).

Honest-labeling rule, upgraded: everything simulated or unbuilt says so on the surface — the landing page's trace console wears a `SIM` chip, unbuilt capabilities wear `ROADMAP` chips, and future pricing wears `PLANNED` chips with a "nothing can be purchased today" note.

## Engine internals — languages, limits, security, self-tests

*(MERIDIAN Engine v0.2-hardened)*

### Recent improvements

- **Resilient trace parsing** — the `meridian-trace` block is recovered even when the model uses ` ```json `, drops the fence, adds trailing commas, or gets cut off mid-JSON. When no trace can be recovered the answer degrades honestly to a `RAW RESPONSE` / `TRACE TRUNCATED` state with a one-click **`[ RE-GROUND & RETRY ]`** (re-runs the local investigation and re-asks with a stricter instruction). A **Force Strict Trace** setting opts noncompliant models into stricter prompting.
- **Multi-language indexing** — symbol and import extraction now covers **Python, Go, Rust** alongside deepened JS/TS (dynamic `import()`, tsconfig `paths` aliases, monorepo workspace resolution). See the matrix below.
- **Faster on large repos** — the symbol/import index no longer rebuilds when you toggle file selection (it depends on content, not selection), the file cap is raised to **8,000**, and token estimates blend a token-regex count for small files with the per-language char divisor for large ones.
- **Hardening** — a pragmatic `<meta>` CSP, custom-endpoint URL validation + a `[ TEST ENDPOINT ]` probe (reachability, CORS, latency), BOM/UTF-16-aware encoding detection, `Retry-After`-aware rate-limit messages with a one-click `[ RETRY ]`, focus-return on every modal, a live-region for screen readers, and dynamic reduced-motion.

### Supported languages & intents

Indexing is regex-based and lightweight (no parser, no dependencies), so depth varies by language:

| Language | Symbols | Imports | Entry points | Notes |
|---|---|---|---|---|
| JS/TS | Strong | Strong + aliases | Yes | dynamic `import()`, tsconfig `paths`, workspace resolution |
| Python | Good | relative + top-level | `app.py` / `__main__` | `test_*` + `_test.` recognized |
| Go | Good | block imports | `main.go` | receiver methods (`func (r *R) M()`) |
| Rust | Good | `use` / `mod` | `main.rs` / `lib.rs` | `pub fn` / `pub struct` / `mod` |
| Others (Java/Ruby/C#…) | Basic | — | partial | extension weighting + `class`/`def` only *(ROADMAP)* |

LOCAL-engine intents: `def`, `refs`, `imports`, `importers`, `related`, `symbols`, `structure`, `tests`, `entries`, `recent <n>`, `dir <path>`, `search <text|regex>`, plus plain-language routing. Interpretation questions ("why…", "how should I…") return a `REQUIRES MODEL REASONING` verdict rather than guessing.

### Known limitations

- **Token counts are estimates** (heuristic char/divisor + a token-regex blend, ~±15–20% vs a real BPE tokenizer). Your provider bills the actual counts. The session `$` and spend-limit warnings are estimate-based.
- **Alias / `exports` resolution is best-effort** — tsconfig `paths` and workspace package names resolve; full `package.json` `exports`/`imports` maps and non-relative cross-crate Rust `use` are not.
- **File System Access reload is Chromium-only** — Firefox/Safari lack `showDirectoryPicker`, so saved projects there restore settings/selection only and ask you to re-drop the folder (never file contents, in any browser).
- **Indexing is synchronous** — a multi-thousand-file scan briefly blocks the tab; a progress status is shown first. Tuned for medium repos (~5–8k files).

### Security / CSP

`app.html` ships a Content-Security-Policy `<meta>` tag (GitHub Pages can't set HTTP headers). The workbench's code lives in same-origin ES modules under `app/`, so `script-src` is a strict `'self'` — inline script injection is blocked outright. `style-src` keeps `'unsafe-inline'` only for the markup's inline `style=` attributes; the rest of the hardening is `object-src 'none'`, `base-uri 'none'`, and a bounded `connect-src` that still permits BYO **https** providers and local model servers:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; object-src 'none'; form-action 'self'
```

Tighten `connect-src` to your own provider hosts for a stricter deployment. Note `frame-ancestors` is intentionally omitted — it is ignored in a `<meta>` CSP and needs an HTTP header (or a JS frame-buster) to take effect. `app.html` still loads **zero third-party scripts**; `index.html` (the landing page) uses the optional goatcounter analytics, so if you add a CSP there it must allow `https://gc.zgo.at`.

### Self-tests

A deterministic self-test suite exercises the index, smart packer, and trace parser against a bundled multi-language fixture — no network, no API. Run it from the command palette (**"Run self-tests (dev)"**), by appending **`?selftest`** to the URL, or with `__meridianSelfTest()` in the browser console (returns the results array). It's honestly labeled `DEV`.

## What's in here

- **[index.html](index.html)** — the MERIDIAN landing page. Single dependency-free file: live Canvas particle field, command palette (`Ctrl-K`), simulated trace console (labeled SIM), FAQ, waitlist form, ceremony/daylight modes, debug panel (`d`).
- **[app.html](app.html)** + **`app/`** — the workbench: markup in `app.html`, styles in `app/app.css`, and the engine as dependency-free ES modules under `app/` (no framework, no npm, no build step — the files ship as authored). Multi-provider key management, folder ingestion (drag-and-drop, picker, or File System Access API — with binary sniffing, ignore-dir filters, and user ignore patterns), the smart context engine (scoring + project map + budgeted packing), IndexedDB project memory, streaming Anthropic/OpenAI-compatible API calls, trace parsing/rendering with evidence chips + file viewer, proposed-action cards, Markdown/HTML trace export, command palette, session cost estimates. Loads **zero third-party scripts**.
  - Module map: `main.js` (entry + init order + global keys) · `state.js` (the shared store + cache invalidation) · `config.js` (providers/models/localStorage keys) · `helpers.js` · `shell.js` (provider/model/theme/first-run/settings) · `ingest.js` (folder loading, tree, budget, preview, ignore patterns) · `demo.js` (bundled sample project) · `memory.js` (IndexedDB projects) · `smart-context.js` (scoring + packing + project map) · `indexer.js` (symbols/imports index) · `prompt.js` (context assembly + grounding) · `chat.js` (provider request loop + cost) · `local.js` (the no-API LOCAL engine) · `trace.js` (rendering + trace parsing) · `actions.js` · `viewer.js` · `export.js` · `palette.js` · `selftest.js`.
- **[privacy.html](privacy.html)** / **[terms.html](terms.html)** — the legal layer, written for this exact architecture (no servers, BYO key, localStorage-only storage).
- **[dna.html](dna.html)** — the Lucid Engine design system as a browsable page.
- **[DESIGN-DNA.md](DESIGN-DNA.md)** — the full system spec (v1.2), including a paste-ready instruction block for AI design tools (§10).

## Before public launch — fill the legal placeholders

The legal pages ship with clearly marked placeholders. Find them all with:

```
grep -rn "TODO(drew)" *.html
```

- `[ENTITY]` — your legal name or company (footers, privacy §01, terms §01).
- `[JURISDICTION]` — governing law (terms §15).
- The terms/privacy are strong standard-practice templates tailored to this architecture, **not legal advice** — have an attorney review before charging money or marketing broadly.

## Make the waitlist real

Out of the box the waitlist form falls back to localStorage (entries never leave the visitor's browser, and the page says so). Two steps make it live:

1. **Email capture (required).** Create a free form at [formspree.io](https://formspree.io), copy the id from its endpoint (`formspree.io/f/<id>`), and paste it into the `FORMSPREE_ID` constant in `index.html` (search for `YOUR_FORM_ID`). The page's copy switches to disclose the transmission automatically — and the privacy policy already describes both states.
2. **Analytics (optional).** Create a free site at [goatcounter.com](https://www.goatcounter.com) (privacy-friendly, no cookies, no consent banner needed), then uncomment the snippet at the bottom of `index.html` and replace `YOURCODE`. Never add analytics to `app.html` — the workbench's zero-third-party-scripts guarantee is part of the privacy policy.

## Developing / verifying

No build step. Serve locally and click around:

```
python3 -m http.server 8000
```

The workbench is ES modules, so it needs to be served over HTTP — opening `app.html` straight from disk (`file://`) won't load the engine. Any static server works; GitHub Pages needs no configuration.

Key flows to check: first-run modal on the workbench (once per browser), folder load with skipped-file report, Send without a key (should prompt, not request), a real question with a spend-limited key (streaming → trace console → evidence chip → file viewer), Stop mid-stream, wrong key (401 state), `[ CLEAR KEY ]` and the clear-all-data button.

## The three laws

1. **Clarity is the price of admission.** Mystery lives in the experience, never in the architecture.
2. **Every element must demonstrate thought.** Decoration that merely signals "designed" gets cut.
3. **Depth is a reward, not a requirement.** Casual users never pay for what explorers earn.

## Depth ladder (try it on the live page)

- **L1** — just read the page.
- **L2** — `Ctrl-K` palette · `t` mode · `g` grid · `d` field debug · `1–5` jump · `?` keymap.
- **L3** — open the browser console.

---

MERIDIAN started as a fictional product built to prove this design system. The workbench made it real. The honest-demo rule still holds: wherever the site simulates or promises, it says so — `SIM`, `ROADMAP`, and `PLANNED` chips mark the line between what runs today and what's on the bench.
