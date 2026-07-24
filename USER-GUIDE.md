# The MERIDIAN User Guide

**MERIDIAN is a browser-only workbench for understanding a codebase.** You load a
project folder into your browser, then ask questions about it. Every answer comes
back with a **trace** — the reasoning steps, each pinned to the exact files and
lines it stands on, which you click to open.

Nothing you load ever reaches us. Your files live in the browser tab and vanish
when you close it. If you connect an AI, your question goes straight from your
browser to that AI provider under your own key — never through a server of ours.

- **Live app:** https://drewosi.github.io/lucid-engine/app.html
- **Run it locally:** [§13](#13-run-it-on-your-own-machine)

---

## Who this guide is for

It serves two readers, and marks the difference where it matters:

- 🟢 **New to this** — you write a little code, or none, and want to *understand*
  a project. Follow the guide top to bottom. Concepts are explained the first
  time they appear, and there's a [Glossary](#glossary) at the end.
- 🔵 **Experienced** — you know codebases and just want the fast path and the
  internals. Skim [Quick start](#quick-start-2-minutes-no-key-needed), the
  [Command reference](#6-the-local-command-reference), and
  [For power users](#12-for-power-users-internals--self-hosting).

Call-outs marked **🔵 Power user** add depth without cluttering the main path.

---

## Contents

1. [What MERIDIAN actually is](#1-what-meridian-actually-is)
2. [Quick start (no key)](#quick-start-2-minutes-no-key-needed)
3. [The screen, explained](#3-the-screen-explained)
4. [Load your project](#4-load-your-project)
5. [Choose a brain (provider & key)](#5-choose-a-brain-provider--key)
6. [Ask questions — the LOCAL command reference](#6-the-local-command-reference)
7. [Ask questions — with an AI](#7-ask-questions-with-an-ai)
8. [Read the answer and its trace](#8-read-the-answer-and-its-trace)
9. [Control what gets sent](#9-control-what-gets-sent-ai-only)
10. [Save, reload, export](#10-save-reload-export)
11. [Keyboard & command palette](#11-keyboard--command-palette)
12. [For power users: internals & self-hosting](#12-for-power-users-internals--self-hosting)
13. [Run it on your own machine](#13-run-it-on-your-own-machine)
14. [Troubleshooting & FAQ](#14-troubleshooting--faq)
15. [Privacy & security model](#15-privacy--security-model)
- [Glossary](#glossary)

---

## 1. What MERIDIAN actually is

Most tools that "read your code with AI" send your whole project to a server.
MERIDIAN is built the opposite way. It does two things:

1. **A deterministic index (no AI).** The moment you load a project, MERIDIAN
   scans it and builds a structured map: every **symbol** (a named function,
   class, variable…), every **import** (which file pulls in which), the entry
   points, the tests, the packages. This is plain, repeatable analysis — the same
   input always gives the same output. It runs entirely in your browser with no
   network.

2. **An optional AI layer on top.** When you want interpretation ("*why* is this
   slow?", "*how should* I refactor this?"), you connect an AI. MERIDIAN first
   runs its own investigation, then hands the AI only the **verified evidence** it
   found — not your whole repo — so the answer stays anchored to real lines.

The mental model: **MERIDIAN understands the terrain before a model enters the
room.** The AI is a reasoning layer, not the foundation. And because the index is
always there, you can get real answers with **no key, no AI, and no internet** —
that's the **LOCAL** engine, and it's the best place to start.

> 🟢 **Jargon, once:** a **symbol** = a named thing in code (function, class,
> constant). An **import** = one file using another. A **token** = the unit AIs
> bill by (~¾ of a word). A **trace** = MERIDIAN's shown work: numbered steps,
> each with clickable evidence. Full [Glossary](#glossary) at the end.

---

## Quick start (2 minutes, no key needed)

1. Open the app: https://drewosi.github.io/lucid-engine/app.html
   (first visit shows a one-time welcome — accept to continue).
2. Click **Load the demo project** (on the welcome screen, or press `Ctrl-K` and
   type "demo"). A tiny sample project loads instantly.
3. The provider is already **LOCAL** — no key, no AI, no network. Type a question
   in the box at the bottom and press **Enter**:
   - `where is addTodo defined`
   - `what depends on store.js`
   - `project structure`
   - `signals`  ← a ranked "what deserves attention" digest
4. In any answer, **click an evidence chip** (the small `ctx://path:line`
   buttons) to open that file at the cited lines, with the quote highlighted.

That's the whole loop: **load → ask → follow the evidence.** Everything below is
detail you can reach for when you need it.

---

## 3. The screen, explained

- **Left sidebar ("the rail")** — load your project; tick which files are in play;
  and read the **PROJECT INTELLIGENCE** panel (live counts: files, directories,
  packages, entry points, tests, symbols, TODOs, orphans, signals). Each count is
  a button that runs the matching investigation. Collapse the rail with `Ctrl-B`;
  drag its right edge (or focus it and use arrow keys) to resize it.
- **Middle — the chat stage.** Your questions, the streaming answers, the traces,
  and the composer box where you type.
- **Right — the file viewer.** On wide screens it docks as a third column when you
  click an evidence chip; on narrow screens it opens as an overlay. It highlights
  the cited lines and has a copy button.
- **Top bar.** Provider + model switcher, live cost `$` chip, export (MD/HTML),
  keymap, settings, and the light/dark mode toggle.

---

## 4. Load your project

Your files are read into **browser memory only**. Three ways:

- **Drag a folder** onto the drop zone in the rail.
- **[ PICK FOLDER ]** (`Ctrl-Shift-O`). On Chrome/Edge this uses the File System
  Access API, which also lets you **reload from disk in one click** later ([§10](#10-save-reload-export)).
- **[ PICK FILES ]** to choose individual files.

Load a folder while one is already open and MERIDIAN asks: **REPLACE** it or
**ADD** to it (dropping loose files is always additive).

**What gets skipped automatically**

| Skipped | Why |
|---|---|
| `node_modules`, `.git`, `dist`, `build`, `target`, `vendor`, `.venv`, … | build/junk directories |
| dot-folders (except `.github`) | tooling noise |
| binaries (images, fonts, archives, compiled files) | not source |
| files > **512 KB** | oversized |
| anything past **8,000 files** or **~300 MB** total | memory caps that keep the tab alive |

Everything skipped is **counted and attributed**. Open **[ REVIEW SKIPPED ]** to
see the list grouped by reason, and click **[ INCLUDE ]** on any one file to pull
it in anyway (true binaries stay out).

**Ignore patterns.** In Settings, add glob-style filters (one per line, `*` is
wildcard) to skip more — e.g. `*.min.js`, `*.map`, `*.lock`. **[ Suggest ]**
proposes common ones, but only globs that actually match a file you loaded.

> 🔵 **Power user:** the indexer skips any single line longer than 400 characters
> (minified bundles), so imports on those lines don't enter the graph — and the
> `orphans`/`broken` answers disclose the skipped-line count so a missing edge is
> never presented as a certainty. Reads run through a bounded 32-wide pool so the
> caps hold even on one giant drop.

---

## 5. Choose a brain (provider & key)

Switch anytime from the top-bar dropdown or in **Settings** (`Ctrl-.`). Each
provider keeps its own key.

| Provider | Key? | Models | Notes |
|---|---|---|---|
| **LOCAL** | none | — | Answers factual questions itself. No AI, no network. **Start here.** |
| **Anthropic** | `sk-ant-…` | Sonnet 5 (1M-token context), Haiku 4.5 (200K) | Best reasoning; supports **prompt caching** (cheap multi-turn). |
| **OpenAI** | `sk-…` | GPT-5.1 (400K), GPT-5 mini (400K) | Standard chat-completions. |
| **Custom** | optional | your own | Any OpenAI-compatible endpoint. **On the hosted page only `localhost` endpoints work** (see below). |

**Add a key:** Settings (`Ctrl-.`) → paste → **Save**. It's stored in your
browser's `localStorage` only, one per provider, and sent straight to that
provider's API. **[ CLEAR KEY ]** removes it; the **clear-all-data** button wipes
everything MERIDIAN stored.

> 🟢 **Recommended:** create your API key **with a spend limit** at your provider.
> You can also set a per-session spend warning in Settings — MERIDIAN warns before
> the *estimated* total crosses it.

**Custom endpoints (🔵).** Point MERIDIAN at Ollama, LM Studio, vLLM, etc. Enter a
base URL like `http://localhost:11434/v1` and a model id, then **[ TEST ENDPOINT ]**
probes reachability, CORS, and latency. Remote (non-localhost) endpoints are
**blocked on the hosted page** by its security policy — to use one, self-host the
workbench and widen `connect-src` ([§12](#12-for-power-users-internals--self-hosting)).

---

## 6. The LOCAL command reference

With the **LOCAL** engine you can ask in **plain language** *or* type a **command**.
Both routes hit the same deterministic engine. Every answer is labelled
**KNOWN LOCALLY** (a verifiable fact from the index) or **REQUIRES MODEL
REASONING** (an interpretation question — connect an AI for those).

**Navigate & describe**

| Command | Plain-language example | What you get |
|---|---|---|
| `def <name>` | "where is addTodo defined" | Definition site(s) |
| `refs <name>` | "who uses addTodo", "what calls addTodo" | Every reference |
| `imports <file>` | "what does server.js import" | What that file pulls in |
| `importers <file>` | "what depends on store.js" | What depends on it |
| `related <file>` | "files related to store.js" | Imports, importers, siblings, name matches |
| `symbols [name]` | "functions named handler" | Symbol index / matches |
| `structure` | "project structure", "how is this organized" | Packages, entries, tests, top dirs, languages |
| `tests` | "where are the tests" | Detected test files |
| `entries` | "entry points", "main file" | index/main/app/server/cli… |
| `dir <path>` | — | Summary of one folder |
| `recent [n]` | "what changed recently" | Most recently modified files |
| `search <text\|regex>` | — | Text/regex search (quote for literal: `search "foo bar"`) |

**Analyze the dependency graph & code health**

| Command | Finds |
|---|---|
| `cycles` | Circular imports |
| `orphans` | Code files nothing imports (possible dead weight) |
| `broken` | Relative imports that resolve to no loaded file |
| `hubs` | Most-depended-on files (the load-bearing walls) |
| `path <a> <b>` | Shortest dependency chain between two files |
| `exports <file>` | A file's public surface |
| `hotspots` | Where change is most expensive (size × symbols × fan-in) |
| `todos` | `TODO`/`FIXME`/`HACK`/`XXX` tags |
| `env` | Environment variables the code reads |
| `untested` | Code files with no matching test |
| `dupes` | Symbol names defined in more than one file |

**Instruments**

| Command | Does |
|---|---|
| `signals` | A ranked digest of the top few things worth attention, each pinned to evidence |
| `drift` | What changed since your **last session** (new/removed/reshaped files) — from a local metadata fingerprint (paths & counts only, never contents) |
| `help` | The in-engine reference |

**Languages understood:** JavaScript/TypeScript, Python, Go, Rust, Java, Ruby,
C#, Kotlin, Swift, PHP (symbols + import resolution), plus basic support for
others (Scala, Elixir, Dart…). Depth varies — it's regex-based, dependency-free
analysis, not a full compiler, and the app says so where it matters.

> 🔵 **Power user:** graph analyses (`cycles`/`orphans`/`hubs`/`path`/`untested`)
> walk **statically resolved** import edges only — files wired at runtime (dynamic
> import, DI, HTML `<script>`, bundler config) can show as orphaned without being
> dead. Each answer discloses this. `search` is bounded to ~400K lines / 2s on the
> main thread and tells you when it stops early.

---

## 7. Ask questions — with an AI

Connect Anthropic, OpenAI, or a custom endpoint ([§5](#5-choose-a-brain-provider--key)),
then ask anything — including the interpretive questions LOCAL declines
("why is this slow", "how should I structure this").

- The answer **streams in**, then its **trace** appears beneath it.
- **Grounding is on by default** (`[ GROUND: ON ]`). Before the AI answers,
  MERIDIAN runs its own investigation and attaches the verified `file:line`
  evidence as a context block. The AI is told to prefer citing those exact lines,
  so answers are anchored to what MERIDIAN actually found, not the model's guess.
- Press **Stop** (or the palette) to cancel a stream; partial output is kept.

> 🔵 **Power user:** grounding is per-question and placed *after* the cached
> project context, so Anthropic prompt-cache of the stable prefix is preserved.
> Toggle it off for a raw context-only request.

---

## 8. Read the answer and its trace

- **Trace** — numbered reasoning steps under the answer, ending with a confidence
  score (AI answers).
- **Evidence chips** — the `ctx://path:line` buttons. Click to open the file at
  those lines in the viewer, with the cited quote highlighted. A **greyed-out**
  chip means the cited file isn't in your loaded set, so it can't be verified; a
  chip marked *unverified* means the quote wasn't found in the file (the model may
  have paraphrased). MERIDIAN counts and surfaces these honestly.
- **MERIDIAN FOUND panel** (AI mode) — the deterministic findings and evidence the
  AI was given, shown *above* the AI's interpretation so you can always tell facts
  from reasoning.
- **Copy** — every answer has **[ COPY ]** (that exchange as Markdown); every chip
  copies its `path:line` + quote.
- **When a trace can't be parsed** — MERIDIAN degrades honestly to a `RAW RESPONSE`
  / `TRACE TRUNCATED` state and offers **[ RE-GROUND & RETRY ]**, which re-runs the
  local investigation and re-asks with a stricter instruction. A **Force Strict
  Trace** setting opts noncompliant models into stricter prompting from the start.

**Proposed actions (experimental).** An AI answer may suggest read-only actions —
`search`, `def`/`refs`, `dir`, `recent`, `open` a file. Nothing runs until you
click **[ RUN LOCALLY ]**, and it only ever runs against your in-memory files.
Suggested `git` commands are **display + copy only** — MERIDIAN never executes a
shell command.

---

## 9. Control what gets sent (AI only)

- **CONTEXT: SMART vs FULL**
  - **FULL** sends every ticked file, whole.
  - **SMART** sends a compact **project map** plus only the most relevant files,
    packed into a token budget. Files too big to send whole are **excerpted with
    their real line numbers kept** and omitted ranges marked, so citations stay
    verifiable. SMART turns on automatically once a project exceeds ~70% of the
    model's context window.
- **GROUND: ON/OFF** — attach MERIDIAN's verified findings (leave it on).
- **[ PREVIEW SEND ]** — shows *exactly* what your next question will transmit: the
  map, the file list, whole-vs-excerpt, token estimates, and the grounding block —
  computed by the **same code** the real request uses, so the preview can't drift
  from reality.
- **Token budget** — tune the SMART send size in Settings (default ≈ the smaller
  of 40% of the model's context or 120K tokens).
- **File checkboxes** — tick/untick files (tri-state per directory) to include or
  exclude them; the budget bar shows the running total.

> 🔵 **Power user — how SMART scores files:** static importance (file type,
> READMEs/manifests/entry points weigh up; tests, lockfiles, generated dirs weigh
> down) + recency (file *and* directory) + path depth + query-keyword hits.
> Debug-worded questions boost test files; onboarding-worded questions boost docs.
> The winners are greedily packed into the budget. Token counts are estimates
> (~±15–20% vs a real tokenizer) — your provider bills the actual counts.

---

## 10. Save, reload, export

**Save a project** (`Ctrl-K` → "Save project") stores your **selection, ignore
patterns, and preferences — never file contents** — in your browser (IndexedDB).
On Chrome/Edge, folders opened via **[ PICK FOLDER ]** also remember the folder
handle, so you can **reload from disk in one click** (after the browser
re-confirms read permission). Other browsers restore settings and ask you to
re-drop the folder.

**Export the session** as **Markdown** (`Ctrl-E`) or a self-contained **HTML** page
(top bar / palette). Both carry the answers, traces, and the *actual cited lines*
pulled from your files; the HTML has zero external assets. You can also copy a
single exchange with its **[ COPY ]** button.

**Session cost** — a live `$` estimate in the top bar tracks spend as answers
stream (prompt-cache aware). Click the reset arrow to zero it. Estimates only;
your provider bills the real amount.

---

## 11. Keyboard & command palette

The **command palette** (`Ctrl-K`) is a searchable list of *every* action — the
fast path for everything below and more (load, save, export, toggle context, run
a LOCAL analysis, run the self-tests…). Every palette action also has a visible
control; the palette is a shortcut, never the only way.

| Key | Action |
|---|---|
| `Ctrl-K` | Command palette |
| `Ctrl-E` | Export session as Markdown |
| `Ctrl-.` | Settings |
| `Ctrl-B` | Show/hide the sidebar |
| `Ctrl-Shift-O` | Pick project folder |
| `?` | Keyboard map |
| `Esc` | Close the top-most panel |
| `Enter` / `Shift-Enter` | Send question / newline |

**Appearance:** toggle **ceremony (dark) / daylight (light)** from the top bar or
palette. All motion respects your OS "reduce motion" setting.

---

## 12. For power users: internals & self-hosting

**The deterministic index.** One pass over your in-memory files builds: a symbol
table (name → definitions), import and importer edges (with real resolution —
tsconfig `paths`, `package.json` `exports`/`imports`/`main`, workspace packages,
Rust `crate::`/`super::`, Java/Kotlin source roots, Ruby `require_relative`, C#
namespaces, PHP composer PSR-4…), file classifications, exports, TODO tags, env
reads, and per-file symbol counts. It's rebuilt only when file *content* changes —
toggling which files are *selected* never rebuilds it.

**The intent registry.** Every LOCAL reasoning instance is one self-contained
entry in `app/intents.js`; array order **is** the natural-language routing
cascade. Adding a new analysis = adding one entry (aliases, router, investigation,
grounding label, help text).

**Prompt caching economics (Anthropic).** The stable context block (instructions +
project map/files) carries a cache breakpoint, so on multi-turn conversations over
a large project the input costs roughly **10× less after the first turn**. The
per-question grounding block is placed after the cached prefix so it never busts
the cache.

**Security / CSP.** `app.html` ships a `<meta>` Content-Security-Policy:
`script-src 'self'` (zero third-party script origins — the page loads **no**
third-party scripts), `object-src 'none'`, `base-uri 'none'`, and a tight
`connect-src` that permits network only to `api.anthropic.com`, `api.openai.com`,
and `localhost`/`127.0.0.1`. Since `frame-ancestors` can't be set from a `<meta>`
tag, the app also runs a **frame-buster** and refuses to run inside an iframe.
(Honest residual: no CSP directive restricts top-level navigation — CSP narrows
the attack surface, it doesn't make key theft impossible.)

**Self-tests.** A deterministic suite (**200+ checks**) exercises the index,
smart packer, intent router, the analyses/instruments, the resolvers, the ingest
caps, the bounded search, and the trace parser against a bundled multi-language
fixture — no network, no API. Run it three ways: the palette → **"Run self-tests
(dev)"**, append **`?selftest`** to the URL, or call `__meridianSelfTest()` in the
browser console. Headless in CI via `scripts/run-selftests.mjs` (GitHub Actions on
every push/PR).

**Widen `connect-src` for a remote endpoint.** Self-host (below) and add your
endpoint's origin to the `connect-src` line in `app.html`.

---

## 13. Run it on your own machine

The app is plain browser files with **no build step**, but it must be served over
`http://` (opening the file directly won't load the ES modules).

1. Open a terminal in the project folder.
2. Start any static server, e.g.: `python3 -m http.server 8000`
3. Visit `http://localhost:8000/app.html`.

Any static host works; GitHub Pages needs no configuration. Editing is
edit-refresh-ship — no compile.

---

## 14. Troubleshooting & FAQ

- **"The engine won't load."** You opened the file directly (`file://`). Serve it
  over `http://` ([§13](#13-run-it-on-your-own-machine)).
- **"Send does nothing / it asks for a key."** You're on an AI provider with no key
  saved. Add one in Settings, or switch to **LOCAL**.
- **`KEY REJECTED (401)`** — the key is wrong or revoked; re-check it in Settings.
- **`RATE LIMITED (429)`** — you hit your provider's limit; MERIDIAN shows the
  retry-after time and a one-click **[ RETRY ]**.
- **`CONTEXT TOO LARGE (400)`** — deselect files or switch to **SMART**.
- **My custom endpoint is "unreachable."** Either it doesn't allow browser **CORS**
  from this origin, or it's a **remote** endpoint blocked by the CSP (localhost
  only on the hosted page — self-host to use it).
- **A file I need was skipped.** Open **[ REVIEW SKIPPED ]** and **[ INCLUDE ]** it,
  or loosen your ignore patterns.
- **An orphan/broken result looks wrong.** It traces *static* imports only; runtime
  wiring can't be seen (and the answer says so). Also check whether the target file
  was even loaded.
- **The answer had no trace.** Some models don't follow the format; use
  **[ RE-GROUND & RETRY ]** or enable **Force Strict Trace** in Settings.

---

## 15. Privacy & security model

- **No backend.** The whole product is static files. There is no server of ours to
  receive your data.
- **Bring your own key.** Requests go directly from your browser to the provider's
  API under your account. Keys live in `localStorage` only, one per provider.
- **Zero egress to us.** File contents and conversations exist in tab memory and
  vanish on close. Saved projects persist **metadata only** (selection + settings)
  in IndexedDB.
- **LOCAL uses no network at all.** And the workbench page loads **zero
  third-party scripts**.

That architecture *is* the privacy story — it's not a policy you have to trust,
it's how the thing is built.

---

## Glossary

- **API key** — a secret string that authorizes requests to an AI provider and ties
  usage to *your* billing. MERIDIAN stores it only in your browser.
- **Symbol** — a named thing in code: a function, class, constant, method.
- **Import / importer** — file A *imports* file B if it pulls B in; then B's
  *importers* include A. "What depends on B" = B's importers.
- **Token** — the unit AIs process and bill by; roughly ¾ of an English word.
- **Context window** — the maximum tokens a model can consider at once (e.g. 200K,
  1M). Too much context → the provider rejects the request; that's what SMART mode
  and the budget prevent.
- **Trace** — MERIDIAN's shown work: numbered steps, each with clickable evidence.
- **Evidence chip** — a `path:line` button that opens the cited source.
- **Grounding** — running the deterministic investigation first and feeding its
  verified findings to the AI, so answers cite real lines.
- **Entry point** — a file a program starts from (`index`, `main`, `app`,
  `server`…).
- **Orphan** — a code file nothing imports (per the static graph).
- **Prompt caching** — reusing a stable, already-processed context prefix across
  turns so repeat input costs far less (Anthropic).
- **CORS** — the browser rule a server must satisfy to accept requests from another
  origin; a custom endpoint must allow MERIDIAN's origin.

---

*Anything this guide doesn't cover is usually answered in-app by the `?` keymap,
the **[ PREVIEW SEND ]** panel, or the honest labels MERIDIAN puts on everything —*
`LOCAL · NO AI`, `KNOWN LOCALLY`, `REQUIRES MODEL REASONING`, `SMART`, `GROUNDED`,
`SIM`, `ROADMAP`. *Where the tool simulates or promises, it says so.*
