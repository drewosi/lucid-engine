# MERIDIAN

**A browser-only code workbench with evidence traces, in free beta.** This repo also contains the Lucid Engine design system it's built with.

## Live

| Page | URL |
|------|-----|
| **MERIDIAN** landing page | https://drewosi.github.io/lucid-engine/ |
| **MERIDIAN Workbench**, the app (free beta) | https://drewosi.github.io/lucid-engine/app.html |
| **One-pager**, the pitch on one page | https://drewosi.github.io/lucid-engine/one-pager.html |
| Terms · Privacy | [terms.html](https://drewosi.github.io/lucid-engine/terms.html) · [privacy.html](https://drewosi.github.io/lucid-engine/privacy.html) |

## One-pager & demo

A clean [**one-pager**](one-pager.html) (`one-pager.html`) states the whole pitch on a single
screen and prints to one PDF page. Like everything here it's one dependency-free file.

![MERIDIAN — LOCAL engine demo](media/meridian-demo.gif)

> The clip above is a **real screen capture** of the workbench running its built-in demo: a tiny
> `todo-api` answered entirely by the deterministic **LOCAL** engine (no key, no AI, no network).
> The UI labels itself as it goes: `DEMO · LOCAL ENGINE`, `LOCAL · NO AI`, `KNOWN LOCALLY`.
> An evidence chip opens the cited file at the cited line; the session exports as HTML + Markdown.
> Higher-quality [`MP4`](media/meridian-demo.mp4).

The recording is fully reproducible, with no faked frames:

```
npm i playwright @ffmpeg-installer/ffmpeg   # throwaway toolchain (gitignored)
node scripts/record-demo.mjs                # drives app.html's LOCAL demo → scripts/.rec/*.webm
bash scripts/encode-demo.sh                 # → media/meridian-demo.mp4 + .gif
node scripts/capture-shots.mjs              # → media/meridian-poster.jpg + media/shot-*.jpg (landing-page screenshots)
```

## What MERIDIAN is

A **browser-only AI workbench**. You bring your own API key (Anthropic, OpenAI, or any OpenAI-compatible endpoint), load a project folder into your browser's memory, and ask questions. Every answer streams back with a **trace** — the reasoning steps, pinned to the exact files and lines they stand on, as clickable evidence chips that open the cited file at the cited range.

Underneath the chat, MERIDIAN is a **deterministic project-intelligence engine** that indexes the project before any model sees it: symbols, import/importer edges, entry points, tests, packages, surfaced as a **PROJECT INTELLIGENCE** overview. The AI model is an optional reasoning layer on top of that index, not the foundation.

Don't want to use an API at all? The **LOCAL engine** (settings → PROVIDER → LOCAL) answers with **no key, no AI, and zero network**. It routes each question by intent and runs a real investigation over the project index, returning findings through the same trace + evidence-chip UI, labeled `LOCAL · NO AI`. Every answer carries a verdict: **KNOWN LOCALLY** (structure, definitions, references, imports/importers, related files, recent changes, evidence) or **REQUIRES MODEL REASONING** (root-cause, synthesis, architectural recommendations). When a model *is* connected, MERIDIAN sends only the relevant evidence, never the whole repo.

The architecture *is* the privacy story:

- **No backend.** The whole product is static files on GitHub Pages. There is no server of ours to receive your data.
- **BYO key.** Requests go directly from the browser to the chosen provider's API under the user's own account. Keys live in localStorage only, one per provider.
- **Zero egress to us.** File contents and conversations exist in tab memory and vanish on close (unless you switch on storing question text in the opt-in usage log, which keeps only your questions, in this browser). Saved projects and workspaces persist **metadata only** (repo names, counts, selection + settings) in IndexedDB.
- **Usage analytics are opt-in and stay in the browser.** Off by default; when off, nothing is recorded. When on, a local usage log (question kind, provider, LOCAL vs model, timings, token counts, repo count; never code, paths or keys) lives in IndexedDB. Nothing is sent anywhere unless you type in your own collector URL. Details below.
- **Sharing without a server.** A share link carries the code itself in the URL fragment (after `#`), which browsers never send to any server, GitHub Pages included. That also means whoever has the link can read the code. Details below.
- **Prompt caching.** On Anthropic, the stable context block is cached, so multi-turn conversations over a big project cost ~10× less on input after the first turn.

### The smart context engine

Medium and large codebases no longer blow the context window. In **SMART** mode (auto-enabled when the loaded project exceeds ~70% of the model's context) each question sends:

1. a **project map**: the full file tree with language-aware token counts and package roots marked (`◆ PACKAGE`, monorepo-aware: package.json / Cargo.toml / pyproject.toml / go.mod detected per directory), plus the heads of key files (READMEs, manifests, entry points, including the largest sub-packages');
2. the **most relevant files**, scored by type weight, recency (file *and* directory), path depth, and query keywords (debug-worded questions boost test files, onboarding-worded questions boost docs), greedily packed into an adjustable token budget (default ≤120K). Files too large to send whole are excerpted **with their true line numbers kept** and omitted ranges marked, so evidence citations stay verifiable in the viewer.

**FULL** mode (every checked file, whole) remains one click away. `[ PREVIEW SEND ]` shows exactly what the next question will transmit (map, file list, whole-vs-excerpt, token estimates), computed by the same code path as the real request. Skipped files (binary / oversized / pattern) are summarized in the rail with a `[ REVIEW SKIPPED ]` modal that can pull individual files back in, and a count badge on the CONTEXT toggle plus a `[ REVIEW ]` toast on load make them hard to miss.

### Grounding: the engine feeds the model

With `[ GROUND: ON ]` (default), every model question first runs Meridian's deterministic investigation locally, then attaches its **verified findings** (the exact `path:line` evidence) as a context block the model reasons on top of. The model is told to prefer citing those lines, so answers are anchored to what Meridian actually found rather than the model's guess. The grounding block is per-question and placed **after** the cached map/context, so Anthropic prompt caching of the stable prefix is preserved. It appears in `[ PREVIEW SEND ]` like everything else, and the toggle turns it off for a raw context-only request.

### Also on the bench

- **Project intelligence engine** *(deterministic, no API)*: on load MERIDIAN builds a structured index of the project (symbols, import/importer edges, entry points, tests, configs, docs, packages) and surfaces a **PROJECT INTELLIGENCE** overview of the terrain. This index powers the LOCAL engine and is always available regardless of provider.
- **LOCAL engine** *(no API)*: a provider that uses no key, no model, and no network. It routes each question by intent and runs a real investigation over the index: definitions (`def`), references (`refs`), importers/imports, related files, symbols, structure, tests, entry points, recent changes, plus `search` / `dir` / `recent` commands, and a set of niche deterministic analyses: circular imports (`cycles`), never-imported files (`orphans`), unresolved relative imports (`broken`), most-imported files (`hubs`), the shortest import chain between two files (`path`), a file's exported surface (`exports`), change-cost hotspots (`hotspots`), tech-debt tags (`todos`), env-var reads (`env`), coverage gaps (`untested`), and duplicate symbol names (`dupes`). All answered through the same trace + evidence-chip UI with a **KNOWN LOCALLY / REQUIRES MODEL REASONING** verdict, labeled `LOCAL · NO AI`. Interpretation questions say a model is needed rather than fabricating an answer. Fully offline; keeps the zero-third-party-scripts guarantee.
- **Share links and bundles**: `[ SHARE ]` packs the files you tick (paths, full text, last-modified times, and a project name; never keys, settings, the conversation, or anything else from browser storage) into a link, compressed with the browser's `CompressionStream` (`deflate-raw`) and base64url-encoded into the fragment: `app.html#share=v1.…`. The fragment is never sent in a request, so no server, GitHub Pages included, receives it, but **anyone holding the link can read the code**, and there is no way to revoke it. Links are capped at **32,000 characters** (`SHARE_LINK_MAX_CHARS` in `app/share.js`) with a live size-vs-limit readout; the default selection is everything that fits, minus secret-looking files (`.env`, private keys, credential files), which always start unticked. Over the limit, download a **`.meridian` bundle** instead: the same payload as readable JSON, no size limit. Opening either (the link, `[ OPEN SHARED ]`, or dropping the file) loads a **read-only `SHARED` project** into tab memory only: the index is rebuilt locally, nothing is saved or fingerprinted, the fragment is cleared from the address bar with `history.replaceState`, and damaged or truncated links get a plain error instead of a half-loaded project. Ask with LOCAL or your own key as usual.
- **Multi-repo workspaces**: load several project folders into one workspace (`[ + ADD REPO ]` under WORKSPACE in the rail, or **ADD REPO** when you drop or pick a folder over a loaded one). Each repo keeps its own file set and index, and every path is namespaced by its repo label (`web/src/app.js`), so identical relative paths never collide; a second folder with a taken name becomes `name-2`. Click a repo to make it active; `[ ASK: ALL REPOS ]` / `[ ASK: <repo> ONLY ]` sets the question scope for the LOCAL engine and model providers alike (a scoped question swaps that repo's files, index and context caches in, so every engine runs per repo unchanged). In ALL scope the model gets a workspace note naming the repos, and SMART packing seats the best file of every repo. The `workspace` intent and a cross-repo block in PROJECT INTELLIGENCE show per-repo stats and signals, dependencies declared by 2+ repos, repo links (one repo depends on a package another publishes), imports that resolve across repos, and names exported by more than one repo. Evidence chips and copied citations read `repo:path:line` and open the file in its own repo. The ingest caps cover the whole workspace, and the rail meter says so. Share links carry the repo labels (an optional `repos` field); the default selection follows the scope.
- **Project memory**: save named projects (selection + ignore patterns + context prefs, never contents). Folders opened via the File System Access API reload from disk in one click. A multi-repo workspace saves as one record (repo names, per-repo counts, selection, scope, folder handles; never contents) and reloading it asks you to pick each folder again.
- **Usage analytics** *(opt-in, off by default)*: settings → USAGE ANALYTICS. While it is off, `track()` returns before touching storage or the network (a self-test proves no writes happen). While it is on, each event is rebuilt through a field whitelist (`sanitizeEvent` in `app/analytics.js`) and kept in this browser's IndexedDB (`meridian-analytics`): timestamp, question kind from the intent classifier, provider, LOCAL vs model, latency (first token) and duration, token counts the provider reported, repo count, question scope, loaded-file count, and feature use (share link created, bundle saved, repo added). Never code, file paths or API keys: every string field is an enum or a fixed-shape token. The question text is stored only with a second switch, **Also store question text** (also off by default), cut to 300 characters with key-looking strings removed. `[ VIEW USAGE LOG ]` (or the palette) opens a panel with totals, breakdowns by intent and provider, LOCAL vs model, median / p90 latency and recent events, plus **Export JSON**, **Export CSV** and **Clear all data**. The log is capped at 5,000 events (oldest pruned). Optional: **Send events to my own endpoint**, a URL field that is blank by default, for owners who self-host a collector. Only when it is filled in and analytics is on, the same sanitized events (question text only if stored) are POSTed as JSON in small batches. It is the only network request analytics makes, and there is no collection server in the code. Events from LOCAL mode are never sent, so LOCAL stays zero-network. A failed send is dropped (the local log keeps it) and sending pauses with a doubling back-off from 60 seconds to 30 minutes; there are no retries. The page's CSP allows localhost only, so a remote collector needs a self-hosted copy with its origin added to `connect-src`. The settings clear-all button deletes the log too.
- **Ignore patterns**: per-project glob-lite filters applied at ingest, with a one-click **Suggest** that proposes common junk-file globs grounded in what you've actually loaded.
- **First-run demo**: new visitors can load a tiny bundled sample project and get a real answer from the **LOCAL** engine (trace, evidence chips, and a `KNOWN LOCALLY` verdict) before committing any API key. Reachable any time from the empty state or the command palette, or straight from a link: `app.html?demo` (the landing page's "Try the demo" button). Returning visitors go straight into the demo; a first visit still shows the terms with the demo button focused. A query param, not a hash, so it never collides with `#share=` links, and a share link always wins.
- **Propose Action** *(experimental)*: the model may suggest read-only actions: `search` (with optional path filter), `def` / `refs` symbol navigation, `dir` summaries, `recent` changes. All run locally against in-memory files after a click; `open` opens the viewer, `git` commands are display + copy only. Nothing ever executes without approval; shell is never executed.
- **Exportable traces**: the whole session (answers, traces, and the actual cited lines) as Markdown or a self-contained zero-asset HTML page. Or copy just one: every answer carries a `[ COPY ]` control (that exchange as Markdown), and every evidence chip a one-click copy of its `path:line` + quote.
- **Session cost, always visible**: a live `$` chip in the nav tracks estimated spend (prompt-cache aware) as answers stream, with a one-click reset; it's no longer only a send-time readout.
- **Provider quick-switch**: a nav selector flips between Anthropic, OpenAI, a custom endpoint, and LOCAL without a trip through settings; each provider keeps its own key.
- **Command palette**: `Ctrl-K` in the workbench, plus `Ctrl-E` export, `Ctrl-.` settings, `Ctrl-Shift-O` pick folder, `?` keymap (also a visible `? KEYS` button in the nav).

## Engine internals: languages, limits, security, self-tests

*(MERIDIAN Engine v0.6)*

### Recent improvements

- **v0.6 (audit pass 3 + hardening)**: fixed three LOCAL-engine intent-routing collisions: *"what depends on X"* now answers dependents (it was reporting X's own imports, the inverse of the truth), *"who uses `<symbol>`"* now returns references instead of dead-ending on a file lookup, and *"list all files"* now lists files instead of reading the determiner as a file extension. Plus the folder-picker path now counts an ignored directory (`node_modules`…) once, matching drag-drop/File-System-Access instead of once per file; `pickSymbol` skips usage verbs so *"who uses the store"* resolves the noun; Tailwind's Play CDN removed (`script-src 'self'`, zero third-party requests). Self-test suite grows to **200+ checks** including the query→intent collision pins.
- **v0.5 (instruments pass)**: the two planned instruments are real: **Signal Extraction** (`signals`, a ranked digest of the top three-to-five findings worth attention: broken imports, cycles, untested load-bearing files, duplicate names, orphans, debt concentration, each pinned to evidence, with a SIGNALS overview tile) and **Drift Watch** (`drift`, session-over-session comparison against a local metadata fingerprint: new/removed/reshaped files and net symbol/import drift; paths and counts only, never contents; not continuous monitoring). Plus **Kotlin, Swift, and PHP** move out of the Others row (gated declaration regexes, gradle-kotlin/SwiftPM/composer-psr-4 resolution), and the self-test suite grows to **174 checks**.
- **v0.4 (deterministic reasoning pass)**: every LOCAL-engine reasoning instance now lives in a single ordered **intent registry** (`app/intents.js`: command aliases, natural-language routing, investigation, grounding label, and help text in one entry; array order is the routing cascade), plus **eleven niche deterministic intents** computed from the index: `cycles`, `orphans`, `broken`, `hubs`, `path <a> <b>`, `exports <file>`, `hotspots`, `todos`, `env`, `untested`, `dupes`. The single indexing pass additionally tracks exports (JS/TS/CommonJS, Rust `pub`, Go capitals), TODO/FIXME/HACK/XXX tags, env-var reads, and per-file symbol counts. New TODOS / ORPHANS overview tiles, a LOCAL palette group, a headless self-test runner (`scripts/run-selftests.mjs`), and a self-test suite grown to **143 checks**, including a full query→intent routing table that pins the cascade's collision cases. The same pass cleared the language-matrix roadmap row (real **Java / Ruby / C#** symbols, imports, and resolution: Maven roots, `require_relative` + `lib/`, C# namespace maps), deepened resolution (`package.json` `exports`/`imports`/`main` maps, Rust `crate::`/`super::`/cross-crate `use` via Cargo.toml names), and added **CI**: GitHub Actions runs the whole suite headlessly on every push/PR.
- **v0.3 (audit pass)**: tight-by-default `connect-src` + a frame-buster, a streaming concurrency guard, trace-salvage fallbacks that no longer mangle answers *quoting* the trace format, un-silenced read errors (a `read-error` skip reason in `[ REVIEW SKIPPED ]`), rAF-batched streaming repaints with stick-to-bottom scrolling, a windowed evidence viewer that highlights the cited quote, an aggregate ~300MB ingest cap, REPLACE/ADD choice when loading a folder over a loaded project, pre-send checks that count history + instructions, and a self-test suite grown to 47 checks covering the stream adapters and ingest filters.
- **Resilient trace parsing**: the `meridian-trace` block is recovered even when the model uses ` ```json `, drops the fence, adds trailing commas, or gets cut off mid-JSON. When no trace can be recovered the answer degrades to a `RAW RESPONSE` / `TRACE TRUNCATED` state with a one-click **`[ RE-GROUND & RETRY ]`** (re-runs the local investigation and re-asks with a stricter instruction). A **Force Strict Trace** setting opts noncompliant models into stricter prompting.
- **Multi-language indexing**: symbol and import extraction now covers **Python, Go, Rust** alongside deepened JS/TS (dynamic `import()`, tsconfig `paths` aliases, monorepo workspace resolution). See the matrix below.
- **Faster on large repos**: the symbol/import index no longer rebuilds when you toggle file selection (it depends on content, not selection), the file cap is raised to **8,000**, and token estimates are a single character-class scan (one pass per text) rather than a per-file regex blend.
- **Hardening**: a pragmatic `<meta>` CSP, custom-endpoint URL validation + a `[ TEST ENDPOINT ]` probe (reachability, CORS, latency), BOM/UTF-16-aware encoding detection, `Retry-After`-aware rate-limit messages with a one-click `[ RETRY ]`, focus-return on every modal, a live-region for screen readers, and dynamic reduced-motion.

### Supported languages & intents

Indexing is regex-based and lightweight (no parser, no dependencies), so depth varies by language:

| Language | Symbols | Imports | Entry points | Notes |
|---|---|---|---|---|
| JS/TS | Strong | Strong + aliases | Yes | dynamic `import()`, tsconfig `paths`, workspace resolution |
| Python | Good | relative + top-level | `app.py` / `__main__` | `test_*` + `_test.` recognized |
| Go | Good | block imports | `main.go` | receiver methods (`func (r *R) M()`) |
| Rust | Good | `use` / `mod` + `crate::`/`super::`/cross-crate | `main.rs` / `lib.rs` | `pub fn` / `pub struct` / `mod`; crate names from Cargo.toml |
| Java | Good | resolved (source-root aligned, Maven layout, `import static`) | `Main.java` | modifier-gated method regex; `FooTest.java` classified as a test |
| Ruby | Good | `require_relative` + root/`lib/` `require` | `application.rb` | `def self.x`, `attr_*` accessors; `spec/` + `_spec.` recognized |
| C# | Good | `using` via namespace map (points at the namespace's first file) | `Program.cs` | methods + properties, file-scoped namespaces; `FooTests.cs` as a test |
| Kotlin | Good | resolved (java-style roots incl. `src/main/kotlin/`) | `main.kt` | fun/object/val/data class, extension receivers; `FooTest.kt` as a test |
| Swift | Good | module-level, rarely file-resolved (`Sources/` convention) | `main.swift` | protocol/extension/actor/open decls; `Tests/` + `FooTests.swift` |
| PHP | Good | namespaced `use` via composer psr-4 + relative `require` | `index.php` | `namespace` declarations not mapped; psr-4 + path conventions only |
| Others (Scala/Elixir/Dart…) | Basic | — | partial | extension weighting + `class`/`def` only |

LOCAL-engine intents: `def`, `refs`, `imports`, `importers`, `related`, `symbols`, `structure`, `tests`, `entries`, `recent <n>`, `dir <path>`, `search <text|regex>`, plus the niche analyses `cycles`, `orphans`, `broken`, `hubs`, `path <a> <b>`, `exports <file>`, `hotspots`, `todos`, `env`, `untested`, `dupes`, the instruments `signals` (ranked top-findings digest) and `drift` (session-over-session change), and `workspace` (cross-repo comparison, when 2+ repos are loaded). Every one is routable in plain language too ("are there circular dependencies", "files without tests", "what does store.js export"…). Each intent is one self-contained entry in the registry (`app/intents.js`); adding a reasoning instance means adding one entry there. Interpretation questions ("why…", "how should I…") return a `REQUIRES MODEL REASONING` verdict rather than guessing.

### Known limitations

- **Token counts are estimates, and they run high on purpose.** `estTokens` in `app/smart-context.js` is the only estimator: it counts the way a Qwen3.5 / GPT-style BPE tokenizer splits (one token per digit, a colon kept apart from the next word, short operator runs, newlines kept), then adds **8%** and rounds up. The 8% is a floor on top of a scan that already sits high of real merges, so a budget is a ceiling. Against the Qwen3.5-9B tokenizer the measured weighted means were about +28% on C/C++, +22% on the line-numbered text SMART sends, +18% JS, +13% Python, +21% GDScript, +20% Markdown and +12% JSON, and none of those files landed under. Three Godot GDScript *test* scripts (smashed identifiers and caret diagrams) stayed within about 2% under; raising the pad to cover them would have lifted every language. Your provider bills the actual counts. Provider-reported usage (`tokensIn` / `tokensOut`, and the session token totals they accumulate) is kept as returned; the session `$` and spend-limit warnings multiply those actuals by the rate card.
- **Alias / `exports` resolution is best-effort.** tsconfig `paths`, workspace package names, `package.json` `exports` / `imports` / `main` maps (conditions picked import > default > require > node > browser; `types` never taken; single-`*` patterns), and Rust `crate::` / `self::` / `super::` / cross-crate `use` (via Cargo.toml package names, hyphens→underscores) all resolve. Still not resolved: nested condition edge cases, `browser`-field objects, Rust `#[path]` attributes and re-export chains.
- **File System Access reload is Chromium-only.** Firefox/Safari lack `showDirectoryPicker`, so saved projects there restore settings/selection only and ask you to re-drop the folder (never file contents, in any browser).
- **Indexing is synchronous.** A multi-thousand-file scan briefly blocks the tab; a progress status is shown first. Tuned for medium repos (~5–8k files).
- **Ingest caps**: 512KB per file, 8,000 files, ~300MB of text total, enforced through a bounded read pool (32 concurrent reads) so they hold even on a single giant drop. Everything skipped is counted, attributed, and reviewable in `[ REVIEW SKIPPED ]`, including over-cap files.
- **Lines over 400 characters are skipped by the indexer** (minified bundles, one-line builds), so symbols and imports on those lines never enter the graph. The `orphans` and `broken` answers disclose the skipped count so a missing edge is never presented as certainty.
- **Search is bounded, not preemptible.** `search` scans at most ~400K lines / 2s on the main thread and says so when it stops early; invalid regex falls back to literal matching and says that too. A single catastrophically backtracking pattern on one line can still stall briefly; quote the query (`search "foo bar"`) to force literal matching.
- **Graph analyses trace static edges only.** `cycles`, `orphans`, `hubs`, `path`, and `untested` walk the resolved import graph; files wired at runtime (dynamic loading, DI, HTML script tags, bundler configs) can be flagged as orphaned/unreached without being dead. The answers say so.
- **Export tracking covers JS/TS (`export` / `module.exports`), Rust (`pub`), Go (uppercase initials), Java/C# (`public`), and Kotlin (non-restricted).** Python and Ruby have no export keyword, so `exports <file>` falls back to listing module-level definitions (underscore-prefixed names excluded).
- **Drift Watch compares sessions, not moments.** A local metadata fingerprint (paths + token/symbol counts, never file contents) keyed by top-level folder name (a workspace by its sorted repo labels); the first load of a project only records a baseline, and same-named root folders share an identity. Continuous monitoring is not built.
- **Workspaces share one set of caps and one tab.** All repos together count against the 8,000-file / ~300MB limits. Cross-repo import edges only appear where the resolver already links them (workspace package names, relative paths); dependency matching is line-based over `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `composer.json` and `Gemfile`. Per-repo signals in the overview are skipped above 4,000 files in total (scope to one repo and ask `signals`). Saved workspaces cannot reload in one click: each folder is re-picked (or re-authorized, where the browser kept a handle).
- **Swift import resolution is module-level best-effort** (`Sources/<Module>/` convention); **PHP `namespace` declarations are not mapped**, so resolution is composer psr-4 plus path conventions.

### Security / CSP

`app.html` ships a Content-Security-Policy `<meta>` tag (GitHub Pages can't set HTTP headers). The workbench's code lives in same-origin ES modules under `app/` and nowhere else: `script-src` is `'self'` with zero third-party script origins, so injected inline scripts and foreign script sources are blocked outright. `style-src` keeps `'unsafe-inline'` for the markup's inline `style=` attributes; the rest of the hardening is `object-src 'none'`, `base-uri 'none'`, and a **tight** `connect-src`: API keys live in `localStorage`, so `fetch()`/XHR can only reach the two known provider hosts plus localhost model servers, which closes the obvious exfiltration path for an injected payload. (Residual risk: no CSP directive restricts top-level navigation, so code already running same-origin could still leak data via `location =`. CSP narrows the attack surface here; it does not make key theft impossible.)

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src https://api.anthropic.com https://api.openai.com http://localhost:* http://127.0.0.1:*; base-uri 'none'; object-src 'none'; form-action 'self'
```

The tradeoff, disclosed in-app next to the custom-endpoint settings: **remote** custom endpoints (openrouter, a hosted vLLM box…) are blocked on the hosted page. Use a localhost server (LM Studio's `http://localhost:1234/v1` or Ollama's `http://localhost:11434/v1`; the API key is optional, and any placeholder like `lm-studio` is accepted and passed through verbatim), or self-host the workbench and add your endpoint's origin to `connect-src` (step-by-step in the [User Guide §13](USER-GUIDE.md#13-run-it-on-your-own-machine)). Note `frame-ancestors` is ignored in a `<meta>` CSP, so `app/main.js` opens with a frame-buster instead: the workbench refuses to run inside an iframe. The workbench page makes **no third-party requests at all** (Tailwind's Play CDN was removed in v0.6; every style lives in `app/app.css`), and neither does the landing page. The one request you can add yourself is the optional usage-analytics endpoint, which is blank by default and is subject to the same `connect-src`: a localhost collector works on the hosted page; a remote one needs a self-hosted copy with its origin added.

### Self-tests

A deterministic self-test suite (350+ checks) exercises the index, smart packer, intent router (a full query→kind routing table incl. cascade-collision pins and the command-grammar gate), the niche investigations, the signals/drift instruments, the resolvers, the ingest caps + bounded pool, the bounded search, the share-link and bundle round-trips (size limit, corrupt input, and a check that no key or setting can reach a payload), multi-repo workspaces (add/remove, path namespacing, query scope for LOCAL and model context, repo-labelled evidence chips, saved workspaces holding no contents, repo labels in shares), usage analytics (off by default, no writes or network while off, sanitizing that keeps code, paths and keys out, question text only with its switch, JSON/CSV export shape, clear, LOCAL never sent, failed sends dropped with no retries, and no network while the endpoint is blank), and the trace parser against a bundled multi-language fixture, with no network and no API. Run it from the command palette (**"Run self-tests (dev)"**), by appending **`?selftest`** to the URL, or with `__meridianSelfTest()` in the browser console (returns the results array). Headless: `npm i playwright` (throwaway, gitignored, the same toolchain as the demo recorder) then `node scripts/run-selftests.mjs`, which serves the repo, runs the suite in Chromium, and exits non-zero on failure. CI (GitHub Actions, `.github/workflows/selftests.yml`) runs exactly that on every push and pull request.

## What's in here

- **[index.html](index.html)**: the MERIDIAN landing page, written for engineering teams and their security reviewers. Single dependency-free file: Canvas particle-field hero framing the demo video, team benefits, screenshots of the real workbench (`media/shot-*.jpg`, captured by `scripts/capture-shots.mjs`), a data-flow diagram, a security-review sheet, FAQ, dark/light modes.
- **[app.html](app.html)** + **`app/`**: the workbench. Markup in `app.html`, styles in `app/app.css`, and the engine as dependency-free ES modules under `app/` (no framework, no npm, no build step; the files ship as authored). Multi-provider key management, folder ingestion (drag-and-drop, picker, or File System Access API, with binary sniffing, ignore-dir filters, and user ignore patterns), the smart context engine (scoring + project map + budgeted packing), IndexedDB project memory, streaming Anthropic/OpenAI-compatible API calls, trace parsing/rendering with evidence chips + a docked file viewer, proposed-action cards, Markdown/HTML trace export, command palette, session cost estimates. Loads **zero third-party scripts** (see Security / CSP).
  - Module map: `main.js` (entry + init order + global keys) · `state.js` (the shared store + cache invalidation) · `config.js` (providers/models/localStorage keys) · `helpers.js` · `shell.js` (provider/model/theme/first-run/settings) · `ingest.js` (folder loading, tree, budget, preview, ignore patterns) · `demo.js` (bundled sample project) · `memory.js` (IndexedDB projects + workspaces) · `repos.js` (workspace repos: labels, path namespacing, question scope, cross-repo facts) · `workspace.js` (the WORKSPACE rail block + saved-workspace restore) · `smart-context.js` (scoring + packing + project map) · `indexer.js` (symbols/imports index) · `prompt.js` (context assembly + grounding) · `chat.js` (provider request loop + cost) · `local.js` (the no-API LOCAL engine) · `trace.js` (rendering + trace parsing) · `actions.js` · `viewer.js` · `export.js` · `share.js` (share links + `.meridian` bundles + the read-only shared view) · `analytics.js` (the opt-in usage log: sanitizer, IndexedDB store, panel, export, optional own endpoint) · `palette.js` · `selftest.js`.
- **[privacy.html](privacy.html)** / **[terms.html](terms.html)**: the legal layer, written for this exact architecture (no servers, BYO key, browser-only storage, opt-in local usage log).
- `dna.html` / `DESIGN-DNA.md`: the design system the site is built with (repo-only; not linked from the public pages).
- **[USER-GUIDE.md](USER-GUIDE.md)**: step-by-step guide to using the workbench, dual-tracked for beginners and experienced coders. Linked from the landing-page footer and the workbench command palette (`Ctrl-K` → "user guide").

## Workbench UI architecture

The workbench is one primary HTML file (`app.html`) whose markup is organized into four fixed regions, driven by dependency-free ES modules. There is no build step: edit, refresh, ship.

### Regions

1. **TopNav** (`nav.primary`): wordmark, sidebar toggle, live context readout, session-cost chip, provider quick-switch + model select, `⌘K` palette trigger, MD/HTML export, keymap, settings, mode toggle. Controls hide progressively as the viewport narrows; every hidden control remains reachable through the command palette (the palette is a shortcut, never the only path).
2. **Left sidebar** (`aside.rail`): saved projects, the context engine (dropzone, the WORKSPACE repo list + scope switch + cap meter, token-budget bar, `SMART/FULL` + `GROUND` + `PREVIEW SEND`), the project tree (search filter, collapsible directories, tri-state per-directory checkboxes, skipped-file review, ignore-pattern shortcut), and the Project Intelligence panel (`#overview`, rendered by `local.js`; every stat tile runs a real deterministic query). The rail is resizable via the `#railresize` handle (drag, or arrow keys when focused; width persisted in `localStorage`) and collapsible (`Ctrl B`, the nav toggle, or the palette). Below 860px it becomes a full-screen overlay.
3. **Main area**: the chat stage (`section.stage`: streaming messages, trace consoles, evidence chips, composer) plus the **file viewer** (`#viewveil`). At ≥1100px the viewer docks as a third grid column, a non-modal right detail pane with line highlighting and a copy control, so the chat stays interactive while you read evidence. Below 1100px it falls back to a focus-trapped overlay.
4. **Layers**: settings drawer, command palette, keymap, send preview, skipped-files review, first-run modal, toasts. `Esc` always closes the topmost layer (ordering lives in `main.js`).

### The id contract

Modules never query by structure: every JS↔DOM touchpoint is a stable element **id** (`$('tree')`, `$('prompt')`, `$('vbody')`, …). Markup can be rearranged freely (this refactor moved the exports into the nav and the overview into the rail without touching their modules) as long as ids survive. When adding UI: give the element an id, wire it in the owning module's `init*()`, and keep the visible control + palette action pair in sync.

### Components

- **`<template>` components**: repeated rows are cloned from templates at the bottom of `app.html` (`tpl-dir-row`, `tpl-file-row`, used by `ingest.js renderTree()`). Prefer this pattern for any new repeated markup.
- **JS component functions**: richer dynamic pieces (messages, trace steps, evidence chips, stat tiles, demo banner) are built by small builder functions in their owning modules (`trace.js addAiMsg()`, `local.js renderOverview()`, …).
- **Module map**: see *What's in here* above. `main.js` owns init order and global keys; `state.js` is the single shared store; everything else owns its own DOM region and wiring.

### Styling

- **`app/app.css`** is the source of truth: DESIGN-DNA tokens (`--paper`, `--accent` Signal Orange `#FF4F00`/`#FF5C0A`, the gray ramp, `--ease-*` easings, `--t-*` durations) on `#app`, with `#app[data-mode="light"]` overrides. Both modes always work.
- **No CSS framework**: the handful of spacing/width utility classes the markup uses (`.mt-2`, `.mt-1\.5`, `.w-full`, `.sr-only`) are defined locally in `app/app.css`. (Tailwind's Play CDN was removed in v0.6 to get to `script-src 'self'`.)
- Layout is a CSS grid: `main.deck { grid-template-columns: var(--rail-w) minmax(0,1fr) auto }`. The rail width is a custom property set by the resize handle; the third column is the docked viewer (auto → 0 when closed). Breakpoints: ≥1100 three-column, 860–1100 rail + chat with the viewer overlaying, ≤860 single column with the rail as an overlay.
- Motion uses only the DNA's named patterns (Signal Trace, Light Lift, Flare Pulse, Machinery Reveal…), 120–240ms with the custom easings, and everything degrades to instant under `prefers-reduced-motion`.

### Extending

- **New command:** add a visible control, then append `{ g, n, k, f }` to `ACTIONS` in `palette.js`; add a `<kbd>` row to the keymap modal if it gets a shortcut (global shortcuts live in `main.js`).
- **New sidebar section:** add a `rail-hd` heading + content inside `.rail-scroll`, wire by id in the owning module.
- **New modal:** copy the `.veil > .modal` pattern, use `rememberFocus()/trap()/returnFocus()` from `helpers.js`, and register it in `main.js`'s `Escape` chain.

## Developing / verifying

No build step. Serve locally and click around:

```
python3 -m http.server 8000
```

The workbench is ES modules, so it needs to be served over HTTP: opening `app.html` straight from disk (`file://`) won't load the engine. Any static server works; GitHub Pages needs no configuration.

Key flows to check: first-run modal on the workbench (once per browser), folder load with skipped-file report, Send without a key (should prompt, not request), a real question with a spend-limited key (streaming → trace console → evidence chip → file viewer), Stop mid-stream, wrong key (401 state), `[ CLEAR KEY ]` and the clear-all-data button.
