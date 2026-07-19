# LUCID ENGINE

**Drew's personal design DNA — and MERIDIAN, the instrument built on it. Now a real, working product in free beta.**

> Lucid Engine is the combination of **hospitable clarity**, **visible engineering**, and **cinematic depth**.
> *"The front door is a museum. The basement is a laboratory."*

## Live

| Page | URL |
|------|-----|
| **MERIDIAN** — landing page | https://drewosi.github.io/lucid-engine/ |
| **MERIDIAN Workbench** — the app (free beta) | https://drewosi.github.io/lucid-engine/app.html |
| **Design DNA** — the system itself | https://drewosi.github.io/lucid-engine/dna.html |
| Terms · Privacy | [terms.html](https://drewosi.github.io/lucid-engine/terms.html) · [privacy.html](https://drewosi.github.io/lucid-engine/privacy.html) |

## What MERIDIAN is now

A **browser-only AI workbench**. You bring your own API key (Anthropic, OpenAI, or any OpenAI-compatible endpoint), load a project folder into your browser's memory, and ask questions. Every answer streams back with a **trace** — the reasoning steps, pinned to the exact files and lines they stand on, as clickable evidence chips that open the cited file at the cited range.

The architecture *is* the privacy story:

- **No backend.** The whole product is static files on GitHub Pages. There is no server of ours to receive your data.
- **BYO key.** Requests go directly from the browser to the chosen provider's API under the user's own account. Keys live in localStorage only, one per provider.
- **Zero egress to us.** File contents and conversations exist in tab memory and vanish on close. Saved projects persist **metadata only** (file tree + settings) in IndexedDB.
- **Prompt caching.** On Anthropic, the stable context block is cached, so multi-turn conversations over a big project cost ~10× less on input after the first turn.

### The smart context engine

Medium and large codebases no longer blow the context window. In **SMART** mode (auto-enabled when the loaded project exceeds ~70% of the model's context) each question sends:

1. a **project map** — the full file tree with token counts plus the heads of key files (README, main config, entry point), so the model always sees the whole project's shape;
2. the **most relevant files**, scored by type weight, recency, path depth, and query keywords, greedily packed into an adjustable token budget (default ≤120K). Files too large to send whole are excerpted **with their true line numbers kept** and omitted ranges marked — so evidence citations stay verifiable in the viewer.

**FULL** mode (every checked file, whole) remains one click away, and the rail reports exactly what will be sent.

### Also on the bench

- **Project memory** — save named projects (tree + selection + ignore patterns + context prefs, never contents). Folders opened via the File System Access API reload from disk in one click.
- **Ignore patterns** — per-project glob-lite filters applied at ingest.
- **Propose Action** *(experimental)* — the model may suggest read-only actions; `search` runs locally against in-memory files after a click, `open` opens the viewer, `git` commands are display + copy only. Nothing ever executes without approval.
- **Exportable traces** — the whole session (answers, traces, and the actual cited lines) as Markdown or a self-contained zero-asset HTML page.
- **Command palette** — `Ctrl-K` in the workbench, plus `Ctrl-E` export, `Ctrl-.` settings, `Ctrl-Shift-O` pick folder, `?` keymap.

Honest-labeling rule, upgraded: everything simulated or unbuilt says so on the surface — the landing page's trace console wears a `SIM` chip, unbuilt capabilities wear `ROADMAP` chips, and future pricing wears `PLANNED` chips with a "nothing can be purchased today" note.

## What's in here

- **[index.html](index.html)** — the MERIDIAN landing page. Single dependency-free file: live Canvas particle field, command palette (`Ctrl-K`), simulated trace console (labeled SIM), FAQ, waitlist form, ceremony/daylight modes, debug panel (`d`).
- **[app.html](app.html)** — the workbench. Also a single dependency-free file: multi-provider key management, folder ingestion (drag-and-drop, picker, or File System Access API — with binary sniffing, ignore-dir filters, and user ignore patterns), the smart context engine (scoring + project map + budgeted packing), IndexedDB project memory, streaming Anthropic/OpenAI-compatible API calls, trace parsing/rendering with evidence chips + file viewer, proposed-action cards, Markdown/HTML trace export, command palette, session cost estimates. Loads **zero third-party scripts**.
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
