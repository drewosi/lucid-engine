# Lucid Engine + MERIDIAN

Zero-dependency, single-file-craft web app. MERIDIAN is a non-AI checker for AI-written code; the LOCAL engine
needs no key and is the default start. MIT licensed; hosted terms/privacy cover only the public demo.

## Run / test / deploy
- Serve the folder over http (file:// is unsupported): `python3 -m http.server 8000`, then open /app.html
  (`?selftest` runs the in-app suite, `?noworker=1` forces the in-page indexer).
- Headless self-tests (same as CI, .github/workflows/selftests.yml):
  `npm i playwright && npx playwright install --with-deps chromium && node scripts/run-selftests.mjs`
  package.json and node_modules are gitignored on purpose. Never commit them.
  If a Chromium is already installed, point at it with `CHROME=/path/to/chrome` (the script honors it).
- Indexer eval: `node scripts/eval-index.mjs` (needs TypeScript and cloned repos; see README "Reproduce").
- Self-host: deploy/Dockerfile + deploy/nginx.conf.template (must allow same-origin module workers).
  `sh deploy/test-csp.sh` checks the CSP logic without Docker. Both the Dockerfile and
  scripts/package-zip.sh list the root HTML files by name: add new root pages there too.
- Public demo: GitHub Pages.

## Structure
- app/: ES modules. index-core.js is the pure indexer (no DOM); indexer.js is the main-thread wrapper; index-run.js
  owns the worker; paths.js holds path classifiers. selftest.js runs selftest-*.js.
- index.html (landing), app.html (app), dna.html (design DNA), one-pager.html, privacy.html, terms.html.
- scripts/: demo recording, screenshot capture, eval, packaging. media/: committed demo mp4/gif plus poster and
  screenshot jpgs.

## Rules
- No runtime dependencies, no build step.
- Run the self-tests before claiming anything works.
- Landing page, app, README, USER-GUIDE and one-pager must tell the same story. Update all of them together.
- Screenshots/recordings (capture-shots.mjs, record-demo.mjs) only at visual milestones, never in a fix-check loop.
  Prefer self-tests and DOM assertions.
- Don't commit new large binaries (>1 MB) without asking.
- Sessions: one task per session; compact or hand off with a NOTES.md around 150–200k context; don't leave sessions open for days.
- Branch + PR; never force-push main.
