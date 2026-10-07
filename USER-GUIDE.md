# The MERIDIAN User Guide

**MERIDIAN is a browser-only workbench for understanding a codebase.** You load a
project folder into your browser, then ask questions about it. Every answer comes
back with a **trace**: reasoning steps, each carrying citations you click to open
the file at the cited lines.

Nothing you load ever reaches us. Your files live in the browser tab and vanish
when you close it. If you connect an AI, your question goes straight from your
browser to that AI provider under your own key, never through a server of ours.

- **Live app:** https://drewosi.github.io/lucid-engine/app.html
- **Run it locally:** [§13](#13-run-it-on-your-own-machine)

---

## Who this guide is for

It serves two readers, and marks the difference where it matters:

- **New to this:** you write a little code, or none, and want to *understand*
  a project. Follow the guide top to bottom. Concepts are explained the first
  time they appear, and there's a [Glossary](#glossary) at the end.
- **Experienced:** you know codebases and want the fast path and the
  internals. Skim [Quick start](#quick-start-2-minutes-no-key-needed), the
  [Command reference](#6-the-local-command-reference), and
  [For power users](#12-for-power-users-internals--self-hosting).

Call-outs marked **Power user** add depth without cluttering the main path.

---

## Contents

1. [What MERIDIAN actually is](#1-what-meridian-actually-is)
2. [Quick start (no key)](#quick-start-2-minutes-no-key-needed)
3. [The screen, explained](#3-the-screen-explained)
4. [Load your project](#4-load-your-project)
5. [Choose a brain (provider & key)](#5-choose-a-brain-provider--key)
6. [The LOCAL command reference](#6-the-local-command-reference)
7. [Ask questions with an AI](#7-ask-questions-with-an-ai)
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

MERIDIAN keeps your project in the browser tab and does two things:

1. **A deterministic index (no AI).** The moment you load a project, MERIDIAN
   scans it and builds a structured map: every **symbol** (a named function,
   class, variable…), every **import** (which file pulls in which), the entry
   points, the tests, the packages. This is plain, repeatable analysis: the same
   input always gives the same output. It runs in your browser with no
   network.

2. **An optional AI layer on top.** When you want interpretation ("*why* is this
   slow?", "*how should* I refactor this?"), you connect an AI. MERIDIAN first
   runs its own investigation, then sends the AI the **verified evidence** it
   found along with the files you selected, so the answer stays anchored to real
   lines.

**MERIDIAN indexes the project before any model sees it**, and the AI reasons on
top of that index. Because the index is always there, the **LOCAL** engine can
answer with **no key, no AI and no internet**. Start there.

> **Jargon, once:** a **symbol** = a named thing in code (function, class,
> constant). An **import** = one file using another. A **token** = the unit AIs
> bill by (~¾ of a word). A **trace** = MERIDIAN's shown work: numbered steps,
> each with clickable evidence. Full [Glossary](#glossary) at the end.

---

## Quick start (2 minutes, no key needed)

1. Open the app: https://drewosi.github.io/lucid-engine/app.html
   (first visit shows a one-time welcome; accept to continue).
2. Click **Load the demo project** (on the welcome screen, or press `Ctrl-K` and
   type "demo"). A tiny sample project loads instantly. Shortcut: open
   https://drewosi.github.io/lucid-engine/app.html?demo and the demo starts by
   itself (on a first visit, accept the welcome with the demo button).
3. The provider is already **LOCAL**: no key, no AI, no network. Type a question
   in the box at the bottom and press **Enter**:
   - `where is addTodo defined`
   - `what depends on store.js`
   - `project structure`
   - `signals`  ← a ranked "what deserves attention" digest
4. In any answer, **click an evidence chip** (the small `ctx://path:line`
   buttons) to open that file at the cited lines, with the quote highlighted.

The loop is **load → ask → follow the evidence.** The sections below are
reference for when you need them.

---

## 3. The screen, explained

- **Left sidebar ("the rail")**: load your project (or several, side by side, as a
  **workspace**: see [§4](#work-across-several-repos)); tick which files are in play;
  and read the **PROJECT INTELLIGENCE** panel (live counts: files, directories,
  packages, entry points, tests, symbols, TODOs, orphans, signals). Each count is
  a button that runs the matching investigation. Collapse the rail with `Ctrl-B`;
  drag its right edge (or focus it and use arrow keys) to resize it.
- **Middle: the chat stage.** Your questions, the streaming answers, the traces,
  and the composer box where you type.
- **Right: the file viewer.** On wide screens it docks as a third column when you
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

Load a folder while one is already open and MERIDIAN asks: **REPLACE** it, or
**ADD REPO** to load it beside the first one as a second repo (see
[Work across several repos](#work-across-several-repos) below). If a repo with
that folder's name is already loaded, the choice is **RELOAD** it from the new
pick or add it as another repo. Dropping loose files is always additive.

**What gets skipped automatically**

| Skipped | Why |
|---|---|
| `node_modules`, `.git`, `dist`, `build`, `target`, `vendor`, `.venv`, … | build/junk directories |
| dot-folders (except `.github`) | tooling noise |
| binaries (images, fonts, archives, compiled files) | not source |
| files > **512 KB** | oversized |
| anything past the **file cap** (8,000 files by default) or **~300 MB** total | memory caps that keep the tab alive |

Everything skipped is **counted and attributed**. Open **[ REVIEW SKIPPED ]** to
see the list grouped by reason, and click **[ INCLUDE ]** on any one file to pull
it in anyway (true binaries stay out).

**File cap.** Up to 8,000 files by default, adjustable in Settings under
**FILE CAP**. Enter a positive whole number and click **Set**; leave it blank to
go back to 8,000. Anything else (0, a negative number, text) is rejected. The new
cap applies to the next folder you load. A higher cap uses more memory, and the
~300 MB text cap still applies. Shared links and bundles are held to the same cap
when you open them.

**Ignore patterns.** In Settings, add glob-style filters (one per line, `*` is
wildcard) to skip more, e.g. `*.min.js`, `*.map`, `*.lock`. **[ Suggest ]**
proposes common ones, but only globs that match a file you loaded.

> **Power user:** the indexer skips any single line longer than 400 characters
> (minified bundles), so imports on those lines don't enter the graph, and the
> `orphans`/`broken` answers disclose the skipped-line count so a missing edge is
> never presented as a certainty. Reads run through a bounded 32-wide pool so the
> caps hold even on one giant drop.

### Work across several repos

A **workspace** is several project folders loaded side by side: a frontend and
its API, a service and the shared library it imports. Everything still lives in
this tab's memory only.

- **Add a repo.** Once a folder is loaded, a **WORKSPACE** block appears under the
  drop zone. **[ + ADD REPO ]** picks another folder; dropping or picking a folder
  and choosing **[ ADD REPO ]** does the same. Each repo keeps its own file set and
  its own index.
- **Repo labels.** Every path starts with its repo's name: `web/src/app.js`,
  `api/src/app.js`. Two repos can hold the same relative path and never collide.
  Two folders with the same name get distinct labels (`app`, `app-2`).
- **Switch and scope.** Click a repo's name to make it the **active repo** (`▸`).
  **[ ASK: ALL REPOS ]** sends every question to all repos at once; click it to
  switch to **[ ASK: &lt;repo&gt; ONLY ]**, which narrows questions to the active
  repo. The scope applies to the LOCAL engine and to AI providers alike: a scoped
  question searches, indexes and sends that repo only. LOCAL answers state the
  scope as their first trace step, and the budget line says `… only` while scoped.
- **Ask across repos.** In ALL scope, SMART packing guarantees the best-scoring
  file of every repo a slot, and the model is told which repos are loaded and
  that each path begins with its repo label. Ask `workspace` (or "compare the
  repos") for the deterministic cross-repo view: per-repo files, languages,
  entry points, tests and symbols; dependencies declared by two or more repos;
  **repo links** (one repo depends on a package another loaded repo publishes);
  imports that resolve across repos; and names exported by more than one repo.
  The same summary sits at the bottom of **PROJECT INTELLIGENCE**, with each
  repo's signal count. Dependency matching reads `package.json`,
  `requirements.txt`, `go.mod`, `Cargo.toml`, `composer.json` and `Gemfile`.
- **Citations.** With several repos loaded, evidence chips read
  `ctx://web:src/app.js:12–14` and open that file in that repo. Copied citations
  use the same `repo:path:line` form. If a model cites a path without its repo
  label and only one repo has that path, MERIDIAN maps it; if two repos have it,
  the chip stays greyed out rather than guess.
- **Unload a repo** with its **✕**. Nothing on disk is touched.
- **The caps are shared.** The file cap (8,000 by default) and ~300 MB limits cover the whole
  workspace, not each repo. The meter under the repo list shows the total. A repo
  added near the cap loads only partly, and **[ REVIEW SKIPPED ]** lists what was
  left out.

---

## 5. Choose a brain (provider & key)

Switch anytime from the top-bar dropdown or in **Settings** (`Ctrl-.`). Each
provider keeps its own key.

| Provider | Key? | Models | Notes |
|---|---|---|---|
| **LOCAL** | none | none | Answers factual questions itself. No AI, no network. **Start here.** |
| **Anthropic** | `sk-ant-…` | Sonnet 5 (1M-token context), Haiku 4.5 (200K) | Best reasoning; supports **prompt caching** (cheap multi-turn). |
| **OpenAI** | `sk-…` | GPT-5.1 (400K), GPT-5 mini (400K) | Standard chat-completions. |
| **Custom** | optional | your own | Any OpenAI-compatible endpoint. **On the hosted page only `localhost` endpoints work** (see below). |

**Add a key:** Settings (`Ctrl-.`) → paste → **Save**. It's stored in your
browser's `localStorage` only, one per provider, and sent straight to that
provider's API. **[ CLEAR KEY ]** removes it; the **clear-all-data** button wipes
everything MERIDIAN stored.

> **Recommended:** create your API key **with a spend limit** at your provider.
> You can also set a per-session spend warning in Settings; MERIDIAN warns before
> the *estimated* total crosses it.

**Custom endpoints.** Point MERIDIAN at LM Studio, Ollama, vLLM, etc. Enter a
base URL (`http://localhost:1234/v1` for LM Studio, `http://localhost:11434/v1` for
Ollama) and a model id, then **[ TEST ENDPOINT ]** probes reachability, CORS, and
latency. The API key is **optional**: leave it empty for keyless local servers, or
save any placeholder (LM Studio accepts e.g. `lm-studio`); whatever you save is
passed through verbatim as a `Bearer` token. Remote (non-localhost) endpoints are
**blocked on the hosted page** by its security policy; to use one, self-host the
workbench and widen `connect-src` ([§12](#12-for-power-users-internals--self-hosting)).

**Enable CORS on a local server.** The browser only lets the hosted page talk to
a local server that allows requests from `https://drewosi.github.io`.

- **LM Studio** ships with CORS off. Turn on **Enable CORS** in its server
  settings (or start it with `lms server start --cors`).
- **Ollama** reads allowed origins from the `OLLAMA_ORIGINS` environment
  variable. Set it to `https://drewosi.github.io` and restart Ollama.

**[ TEST ENDPOINT ]** reports a CORS failure if one remains. On a self-hosted copy,
allow your own page's origin instead.

---

## 6. The LOCAL command reference

With the **LOCAL** engine you can ask in **plain language** *or* type a **command**.
Both routes hit the same deterministic engine. Every answer is labelled
**KNOWN LOCALLY** (a verifiable fact from the index) or **REQUIRES MODEL
REASONING** (an interpretation question; connect an AI for those).

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
| `dir <path>` | n/a | Summary of one folder |
| `recent [n]` | "what changed recently" | Most recently modified files |
| `search <text\|regex>` | n/a | Text/regex search (quote for literal: `search "foo bar"`) |

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
| `drift` | What changed since your **last session** (new/removed/reshaped files), from a local metadata fingerprint (paths & counts only, never contents) |
| `workspace` | With 2+ repos loaded: per-repo stats, shared dependencies, repo links, cross-repo imports and names exported in more than one repo ("compare the repos" works too) |
| `help` | The in-engine reference |

**Languages understood:** JavaScript/TypeScript, Python, Go, Rust, Java, Ruby,
C#, Kotlin, Swift, PHP (symbols + import resolution), plus basic support for
others (Scala, Elixir, Dart…). Depth varies: it's regex-based, dependency-free
analysis, not a full compiler, and the app says so where it matters.

> **Power user: the intentional limits, in one place.** Graph analyses
> (`cycles`/`orphans`/`hubs`/`path`/`untested`) walk **statically resolved**
> import edges only; files wired at runtime (dynamic import, DI, HTML
> `<script>`, bundler config) can show as orphaned without being dead. Symbol
> and import extraction is **regex-based with per-language depth ceilings** (not
> a compiler), and **lines over 400 characters are not indexed** (minified /
> one-line content), so imports on them are invisible, so such files can appear
> orphaned or unresolved. `untested` matches tests to sources by **name stem +
> what test files import**; integration tests that exercise code indirectly are
> not traced. `search` is bounded to ~400K lines / 2s on the main thread and
> tells you when it stops early. Every affected answer discloses its own caveat
> in place, and the PROJECT INTELLIGENCE overview carries a standing machinery
> note.

---

## 7. Ask questions with an AI

Connect Anthropic, OpenAI, or a custom endpoint ([§5](#5-choose-a-brain-provider--key)),
then ask anything, including the interpretive questions LOCAL declines
("why is this slow", "how should I structure this").

- The answer **streams in**, then its **trace** appears beneath it.
- **Grounding is on by default** (`[ GROUND: ON ]`). Before the AI answers,
  MERIDIAN runs its own investigation and attaches the verified `file:line`
  evidence as a context block. The AI is told to prefer citing those exact lines,
  so answers rest on what MERIDIAN found in the index. These excerpts can come
  from any loaded file, ticked or not.
- Press **Stop** (or the palette) to cancel a stream; partial output is kept.

> **Power user:** grounding is per-question and placed *after* the cached
> project context, so Anthropic prompt-cache of the stable prefix is preserved.
> Toggle it off for a raw context-only request.

---

## 8. Read the answer and its trace

- **Trace**: numbered reasoning steps under the answer, ending with a confidence
  score (AI answers).
- **Evidence chips**: the `ctx://path:line` buttons. Click to open the file at
  those lines in the viewer, with the cited quote highlighted. A **greyed-out**
  chip means the cited file isn't in your loaded set, so it can't be verified; a
  chip marked *unverified* means the quote wasn't found in the file (the model may
  have paraphrased). MERIDIAN counts and surfaces these.
- **MERIDIAN FOUND panel** (AI mode): the deterministic findings and evidence the
  AI was given, shown *above* the AI's interpretation so you can always tell facts
  from reasoning.
- **Copy**: every answer has **[ COPY ]** (that exchange as Markdown); every chip
  copies its `path:line` + quote.
- **When a trace can't be parsed**: MERIDIAN degrades to a `RAW RESPONSE`
  / `TRACE TRUNCATED` state and offers **[ RE-GROUND & RETRY ]**, which re-runs the
  local investigation and re-asks with a stricter instruction. A **Force Strict
  Trace** setting opts noncompliant models into stricter prompting from the start.

**Proposed actions (experimental).** An AI answer may suggest read-only actions:
`search`, `def`/`refs`, `dir`, `recent`, `open` a file. Nothing runs until you
click **[ RUN LOCALLY ]**, and it only ever runs against your in-memory files.
Suggested `git` commands are **display + copy only**; MERIDIAN never executes a
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
- **GROUND: ON/OFF**: attach MERIDIAN's verified findings (leave it on). The
  excerpts can come from any loaded file, ticked or not; turn GROUND off and
  untick a file to keep it out of a request.
- **Conversation**: earlier questions and answers in the session go with every
  new question.
- **[ PREVIEW SEND ]**: shows the exact payload your next question will transmit: the
  map, the file list, whole-vs-excerpt, token estimates, and the grounding block,
  computed by the **same code** the real request uses, so the preview can't drift
  from reality.
- **Token budget**: tune the SMART send size in Settings (default ≈ the smaller
  of 40% of the model's context or 120K tokens).
- **File checkboxes**: tick/untick files (tri-state per directory) to include or
  exclude them; the budget bar shows the running total.

> **Power user: how SMART scores files.** Static importance (file type,
> READMEs/manifests/entry points weigh up; tests, lockfiles, generated dirs weigh
> down) + recency (file *and* directory) + path depth + query-keyword hits.
> Debug-worded questions boost test files; onboarding-worded questions boost docs.
> The winners are greedily packed into the budget. Token counts are estimates
> and run high of a real tokenizer (an 8% pad on a scan that already counts
> digits and line-number prefixes as their own tokens, so C/C++ lands further
> above), so the budget is a ceiling; your provider bills the actual counts.

---

## 10. Save, reload, export

**Save a project** (`Ctrl-K` → "Save project") stores your **selection, ignore
patterns, and preferences, never file contents**, in your browser (IndexedDB).
On Chrome/Edge, folders opened via **[ PICK FOLDER ]** also remember the folder
handle, so you can **reload from disk in one click** (after the browser
re-confirms read permission). Other browsers restore settings and ask you to
re-drop the folder.

**Save a workspace.** With two or more repos loaded, **[ SAVE PROJECT ]** saves a
workspace (marked `⧉` in the list): the repo names, each repo's file and token
counts, the selection, ignore patterns, the active repo and the question scope,
and folder handles where the browser provides them. Never file contents.
Reloading it restores the settings and lists each repo under WORKSPACE with a
**[ PICK ]** button (or **[ ⟳ RELOAD ]** when the browser remembers the folder;
it asks for read permission first). Pick each folder again and its saved
selection comes back. Dropping a folder whose name matches a waiting repo works
too.

**Export the session** as **Markdown** (`Ctrl-E`) or a self-contained **HTML** page
(top bar / palette). Both carry the answers, traces, and the *actual cited lines*
pulled from your files; the HTML has zero external assets. You can also copy a
single exchange with its **[ COPY ]** button.

### Share a project (no server)

Click **[ SHARE ]** under the file tree (or `Ctrl-K` → "Share project"). You pick
which files go in, then either copy a **link** or download a **bundle**.

- **The link carries the code itself.** Your browser compresses the ticked files
  (paths, full text, last-modified times) and a project name into the part of the
  address after `#`. Browsers never send that part to a server, so GitHub Pages
  never receives it, and neither do we. **Anyone who has the link can read those
  files**, and so can the chat app or inbox you paste it into. There is no server,
  so a link can't be revoked or expired.
- **Links have a size limit: 32,000 characters.** The panel shows the live size
  against the limit. Everything is ticked by default when it fits; otherwise
  **[ FIT TO LINK ]** picks the most important files that do (READMEs, manifests,
  entry points first). Files that look like secrets (`.env`, private keys,
  credential files) always start unticked.
- **Too big for a link? Download a bundle.** A `.meridian` file holds the same
  data as readable JSON (open it in a text editor to see what's inside)
  and has no size limit. Send it as a file.
- **Never included:** API keys, provider settings, the conversation, saved
  projects, or anything else MERIDIAN keeps in your browser.
- You tick a box confirming you understand the above before either button works.
- **Workspaces:** the files keep their repo labels, and the link or bundle also
  lists those labels, so the recipient sees the same repos (read-only). By
  default the panel ticks the files in the current question scope: every repo in
  ALL scope, only the active repo when **[ ASK ]** is narrowed to it. **[ ALL ]**
  ticks every repo.

**Opening a share.** Open the link, or use **[ OPEN SHARED ]** in the rail (or drop
the `.meridian` file on the drop zone). The project loads **read-only**, badged
`SHARED · READ-ONLY`: it lives in that tab's memory only, isn't saved (save
project is blocked), and leaves nothing in browser storage. The `#share=…` part is
removed from the address bar once loaded, so it isn't passed on by accident. Ask
questions as usual, with **LOCAL** (no key) or your own key. Loading your own
folder replaces it.

### Usage analytics (opt-in, off by default)

MERIDIAN can keep a log of how you use it, **in your browser only**. It is off
until you turn it on, and while it is off nothing is recorded at all.

- **Turn it on:** **⚙ SETTINGS → USAGE ANALYTICS → [ USAGE ANALYTICS: ON ]**.
- **What is stored**, per event, in this browser's IndexedDB: the time, the kind of
  question (the same intent the LOCAL engine routes by, like `def` or `cycles`),
  the provider, whether LOCAL or a model answered, how long it took (time to the
  first word and to the full answer), token counts if the provider reported them,
  how many repos were loaded and the question scope, and when you created a share
  link, saved a bundle or added a repo.
- **What is never stored:** code, file paths or API keys.
- **Question text** has its own switch, **[ ALSO STORE QUESTION TEXT ]**, also off
  by default. When on, each question is kept as you typed it, cut to 300
  characters, with anything that looks like a key removed.
- **See it:** **[ VIEW USAGE LOG ]** (or `Ctrl-K` → "usage analytics") shows
  totals, a breakdown by question kind and by provider, LOCAL vs model, median and
  90th-percentile latency, and the most recent events.
- **Export or delete it:** the same panel has **Export JSON**, **Export CSV** and
  **Clear all data**. Turning analytics off keeps the existing log until you clear
  it. The settings clear-all button deletes it too. The log keeps the latest
  5,000 events.

**Send events to my own endpoint (optional).** This field is blank by default and
is meant for people who run their own copy of MERIDIAN and their own collector.
When you fill it in and analytics is on, the same events are sent as JSON
(`POST`, a small batch every few seconds) to that URL, with question text only if
you store it. That is the only network request analytics ever makes. MERIDIAN has
no collection server; the URL is yours or nothing.

- Events from **LOCAL** mode are never sent, so LOCAL stays network-free.
- If a send fails, that batch is dropped (it stays in your local log) and sending
  pauses for a minute, then longer after each further failure, up to 30 minutes.
  It never retries in a loop.
- The hosted page's security policy only allows `localhost`, so on
  drewosi.github.io a collector must run on your machine (e.g.
  `http://localhost:8787/events`). For a remote collector, self-host and add its
  origin to `connect-src` ([§13](#13-run-it-on-your-own-machine)). The collector
  must allow browser CORS from the page's origin.

**Session cost**: a live `$` estimate in the top bar tracks spend as answers
stream (prompt-cache aware). Click the reset arrow to zero it. Estimates only;
your provider bills the real amount.

---

## 11. Keyboard & command palette

The **command palette** (`Ctrl-K`) is a searchable list of *every* action: the
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

**Appearance:** toggle **dark / light mode** from the top bar or palette. All
motion respects your OS "reduce motion" setting.

---

## 12. For power users: internals & self-hosting

**The deterministic index.** One pass over your in-memory files builds: a symbol
table (name → definitions), import and importer edges (with real resolution:
tsconfig `paths`, `package.json` `exports`/`imports`/`main`, workspace packages,
Rust `crate::`/`super::`, Java/Kotlin source roots, Ruby `require_relative`, C#
namespaces, PHP composer PSR-4…), file classifications, exports, TODO tags, env
reads, and per-file symbol counts. It's rebuilt only when file *content* changes;
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
`script-src 'self'` (zero third-party script origins; the page loads **no**
third-party scripts), `object-src 'none'`, `base-uri 'none'`, and a tight
`connect-src` that permits network only to `api.anthropic.com`, `api.openai.com`,
and `localhost`/`127.0.0.1`. Since `frame-ancestors` can't be set from a `<meta>`
tag, the app also runs a **frame-buster** and refuses to run inside an iframe.
(Residual risk: no CSP directive restricts top-level navigation. CSP narrows
the attack surface; it doesn't make key theft impossible.)

**Self-tests.** A deterministic suite (**350+ checks**) exercises the index,
smart packer, intent router, the analyses/instruments, the resolvers, the ingest
caps, the bounded search, share links, workspaces, usage analytics (off by
default, no writes while off, nothing sensitive stored, export, clear, no
network with a blank endpoint) and the trace parser against a bundled
multi-language fixture, with no network and no API. The run uses a scratch
analytics store, so it never touches your real usage log. Run it three ways: the palette → **"Run self-tests
(dev)"**, append **`?selftest`** to the URL, or call `__meridianSelfTest()` in the
browser console. Headless in CI via `scripts/run-selftests.mjs` (GitHub Actions on
every push/PR).

**Widen `connect-src` for a remote endpoint.** Self-host and add your endpoint's
origin to the `connect-src` line in `app.html`; the concrete steps are in
[§13](#13-run-it-on-your-own-machine).

---

## 13. Run it on your own machine

The app is plain browser files with **no build step**, but it must be served over
`http://` (opening the file directly won't load the ES modules).

1. Open a terminal in the project folder.
2. Start any static server, e.g.: `python3 -m http.server 8000`
3. Visit `http://localhost:8000/app.html`.

Any static host works; GitHub Pages needs no configuration. Editing is
edit-refresh-ship, with no compile step.

### Point it at a private model endpoint

The hosted page's CSP only allows network to `api.anthropic.com`,
`api.openai.com`, and `localhost`/`127.0.0.1`, so a **remote** custom endpoint
(a hosted vLLM box, openrouter, a company gateway) is blocked there by design.
Self-hosting lifts that in one edit:

1. **Clone or fork** the repo (or copy only `app.html` + the `app/` folder; that
   is the entire workbench).
2. **Edit the one `connect-src` line** in `app.html`'s `<meta
   http-equiv="Content-Security-Policy">` tag: append your endpoint's origin,
   e.g. `https://models.internal.example`. Add nothing else: every origin you
   add is an origin an injected script could reach, so keep the list minimal.
3. **Serve statically** (step above) and open your copy of `app.html`.
4. In the app: **⚙ SETTINGS → PROVIDER → CUSTOM**, set the base URL (e.g.
   `https://models.internal.example/v1`) and model id, add a key if your server
   wants one (optional for most local servers), then **[ TEST ENDPOINT ]**.

### What changes vs. the GitHub Pages version

Nothing else. Same files, same zero-dependency build (none), same behavior:
`app.html` still loads **no third-party scripts** and makes no requests except
to the providers you configured (and, only if you set one, your own analytics
endpoint). Neither does the landing page.

---

## 14. Troubleshooting & FAQ

- **"The engine won't load."** You opened the file directly (`file://`). Serve it
  over `http://` ([§13](#13-run-it-on-your-own-machine)).
- **"Send does nothing / it asks for a key."** You're on an AI provider with no key
  saved. Add one in Settings, or switch to **LOCAL**.
- **`KEY REJECTED (401)`**: the key is wrong or revoked; re-check it in Settings.
- **`RATE LIMITED (429)`**: you hit your provider's limit; MERIDIAN shows the
  retry-after time and a one-click **[ RETRY ]**.
- **`CONTEXT TOO LARGE (400)`**: deselect files or switch to **SMART**.
- **My custom endpoint is "unreachable."** Either it doesn't allow browser **CORS**
  from this origin, or it's a **remote** endpoint blocked by the CSP (localhost
  only on the hosted page; self-host to use it).
- **A file I need was skipped.** Open **[ REVIEW SKIPPED ]** and **[ INCLUDE ]** it,
  or loosen your ignore patterns.
- **An orphan/broken result looks wrong.** It traces *static* imports only; runtime
  wiring can't be seen (and the answer says so). Also check whether the target file
  was even loaded.
- **"This share link is damaged or incomplete."** The link was cut short, usually
  by a chat app or email client. Ask the sender to resend it, or to send a
  `.meridian` bundle instead. Nothing is loaded from a broken link.
- **The answer had no trace.** Some models don't follow the format; use
  **[ RE-GROUND & RETRY ]** or enable **Force Strict Trace** in Settings.

---

## 15. Privacy & security model

- **No backend.** The whole product is static files. There is no server of ours to
  receive your data.
- **Bring your own key.** Requests go directly from your browser to the provider's
  API under your account. Keys live in `localStorage` only, one per provider. What
  a request carries is listed in [§9](#9-control-what-gets-sent-ai-only).
- **Zero egress to us.** File contents and conversations exist in tab memory and
  vanish on close (unless you switch on storing question text in the usage log,
  which keeps only your questions, in this browser). Saved projects and workspaces persist **metadata only**
  (repo names, counts, selection + settings) in IndexedDB.
- **LOCAL uses no network at all.** And the workbench page loads **zero
  third-party scripts**.
- **Share links and bundles contain your code.** The link's code sits after `#`,
  which never reaches any server (GitHub Pages included), but whoever holds the
  link or `.meridian` file can read the files in it. Keys and settings are never
  included. See [§10](#10-save-reload-export).
- **Usage analytics are opt-in and local.** Off by default. When on, a usage log
  (question kind, provider, timings, counts; never code, paths or keys; question
  text only with its own switch) is kept in this browser's IndexedDB, and you can
  export or clear it. Nothing is sent anywhere unless you enter your own endpoint,
  and LOCAL-mode events are never sent. See [§10](#10-save-reload-export).

The architecture is the privacy model, and you can check it in the source and in
your browser's network inspector.

---

## Glossary

- **API key**: a secret string that authorizes requests to an AI provider and ties
  usage to *your* billing. MERIDIAN stores it only in your browser.
- **Symbol**: a named thing in code: a function, class, constant, method.
- **Import / importer**: file A *imports* file B if it pulls B in; then B's
  *importers* include A. "What depends on B" = B's importers.
- **Token**: the unit AIs process and bill by; roughly ¾ of an English word.
- **Context window**: the maximum tokens a model can consider at once (e.g. 200K,
  1M). Too much context → the provider rejects the request; that's what SMART mode
  and the budget prevent.
- **Trace**: MERIDIAN's shown work: numbered steps, each with clickable evidence.
- **Evidence chip**: a `path:line` button that opens the cited source
  (`repo:path:line` when several repos are loaded).
- **Workspace / repo**: several project folders loaded side by side; each one is a
  repo, labelled by its folder name, with its own files and index.
- **Scope**: whether a question goes to every repo (ALL) or only the active repo.
- **Grounding**: running the deterministic investigation first and feeding its
  verified findings to the AI, so answers cite real lines.
- **Entry point**: a file a program starts from (`index`, `main`, `app`,
  `server`…).
- **Orphan**: a code file nothing imports (per the static graph).
- **Prompt caching**: reusing a stable, already-processed context prefix across
  turns so repeat input costs far less (Anthropic).
- **CORS**: the browser rule a server must satisfy to accept requests from another
  origin; a custom endpoint must allow MERIDIAN's origin.

---

*Anything this guide doesn't cover is usually answered in-app by the `?` keymap,
the **[ PREVIEW SEND ]** panel, or the labels MERIDIAN puts on its answers:*
`LOCAL · NO AI`, `KNOWN LOCALLY`, `REQUIRES MODEL REASONING`, `SMART`, `GROUNDED`.
