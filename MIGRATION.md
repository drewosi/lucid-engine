# Migrating to v0.7 (production hardening)

For people who already use Meridian. Nothing here needs action to keep working: your keys, settings and saved
projects are untouched, the LOCAL engine still needs no key, and old share links and `.meridian` bundles still open.

## What changed for you

| Area | Before | Now |
|---|---|---|
| **License** | No license file | **MIT** (`LICENSE`). The hosted Terms and Privacy apply only to the public demo at drewosi.github.io |
| **Big projects** | Indexing froze the tab for a while | Projects over 300 files index in a **background worker** with progress. Ask meanwhile and you get a *partial index* answer that says so. Palette: *Cancel background indexing*. No Workers? The old in-page indexer runs |
| **Share dialog** | One kind of link, permanent | A **PROTECTION** box: passphrase or generated token, expiry (24 hours, 7 days, never), self-destruct after first open. A link with no passphrase now needs the "permanent, unprotected link" checkbox |
| **Opening a protected share** | n/a | A passphrase prompt appears. Expired links, wrong passphrases and already-opened one-time links say why they will not open |
| **Model answers** | Chips marked unverifiable only when a file was missing | Every answer is **post-checked**: files, line ranges and quotes, including citations written in the prose. Failures show **UNVERIFIED** with the list and a re-ground button; no citations shows **UNCITED** |
| **Languages** | One undifferentiated list | Core / best-effort / basic tiers shown in the overview and on graph answers. The README has measured accuracy for JS/TS and Python |
| **Skipped lines** | Noted when over-long lines existed | An explicit warning when more than 10% of lines were skipped; generated, minified and vendored files are left out and listed |
| **Support** | n/a | *Diagnostics* in the palette and settings: a redacted report you can paste into a ticket |

## Things that behave differently

- **Counts can shift slightly.** The indexer is more accurate: `const x = require('y')` is no longer counted as
  a symbol, `const enum` names are right, `obj.import('x')` is not an import, CRLF files index properly, top-level
  destructured names and multi-line `import { … } from` / `export { … }` lists are now found. Totals on a project
  you analysed before may differ by a few percent, and Drift Watch can report a one-time change.
- **Generated and minified files are skipped** (banner such as "Code generated … DO NOT EDIT", `*.min.js`,
  `*_pb.*`, files whose first lines are mostly over-long). They stay loaded and searchable.
- **Old unprotected links still work forever**, and always will; a link already sent cannot be recalled by anyone.
  If you shared company code that way, the only fix is to stop circulating it. New shares can expire.
- **Protected shares are enforced by the opener's browser.** Expiry uses that browser's clock; "opens once" is
  remembered in that browser's localStorage (`meridian.shares.seen`: an id and an expiry, nothing else). They
  stop old links resurfacing, not a determined recipient. Send the passphrase by a different channel than the link.
- **`file://` does not work** and never did for the app: serve the folder over `http://localhost` (see
  `docs/AIRGAPPED.md`). Module workers make this stricter, not different.
- **Self-hosters**: the page now starts a same-origin module worker (`app/index-worker.js`). Your server must
  serve `.js` as JavaScript and must not block workers with a stricter CSP (`worker-src 'self'` or inheriting
  `script-src 'self'` is enough). `deploy/Dockerfile` and `deploy/nginx.conf.template` show a working setup.
  No new third-party origins, no new `connect-src` entries.

## If something looks wrong

1. Settings → **[ DIAGNOSTICS REPORT ]**, read it, copy it into an issue.
2. Add `?noworker=1` to the app URL to force the in-page indexer and see whether the worker is involved.
3. Run the self-tests (`?selftest`, or palette → *Run self-tests*) or `node scripts/run-selftests.mjs`.

## For contributors

- The index scan moved to `app/index-core.js` (pure, no DOM). `app/indexer.js` is now the thin main-thread wrapper
  and `app/index-run.js` owns the worker. Path classifiers live in `app/paths.js`.
- New self-test files: `selftest-index.js`, `selftest-seal.js`, `selftest-verify.js`, `selftest-diag.js`,
  `selftest-parity.js`, plus the areas split out of `selftest.js`: `selftest-ingest.js`, `selftest-share.js`,
  `selftest-workspace.js`, `selftest-demo.js`, `selftest-routing.js`, `selftest-wire.js`, `selftest-smart.js`,
  `selftest-analytics.js` and the shared `selftest-fixture.js`. They are all run from `selftest.js`.
- `intents.js` now assembles the LOCAL intent registry from `intents-overview.js`, `intents-health.js`,
  `intents-inventory.js`, `intents-symbols.js` and `intents-fallback.js` (array order is still the routing
  cascade); shared helpers moved to `intents-core.js`. The exports of `intents.js` are unchanged.
- `scripts/eval-index.mjs` scores the indexer against real repositories (see the README).
