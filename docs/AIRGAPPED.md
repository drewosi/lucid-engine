# Running Meridian with no internet

Meridian is a static site: HTML, ES modules and one worker file. There is no backend to install. That makes
air-gapped use simple, with one catch (below).

## What works with no network at all

| Feature | Offline? |
|---|---|
| **LOCAL engine** (no key, no AI): structure, symbols, imports, cycles, orphans, signals, evidence chips | Yes, fully |
| Loading a folder, indexing (worker or in-page), the evidence viewer, self-tests | Yes |
| Share links and `.meridian` bundles, including passphrase-protected ones | Yes (WebCrypto and CompressionStream are built into the browser) |
| Diagnostics report | Yes (it only shows text; nothing is sent) |
| Model answers (Anthropic / OpenAI) | **No**: needs those hosts. Use an internal gateway or a local model server instead (below) |

## The one catch: serve it, don't double-click it

Browsers refuse ES modules and Web Workers from `file://`. Opening `app.html` from disk shows a blank page.
Serve the folder over `http://localhost` with any static server:

```sh
unzip meridian-<sha>.zip && cd meridian
python3 -m http.server 8080        # or: npx serve · busybox httpd · nginx · IIS
# then open http://localhost:8080/app.html
```

`localhost` counts as a secure context, so WebCrypto (protected shares) works. A non-localhost `http://` address
does not; use https there.

## Getting the files onto the machine

On a connected machine: `sh scripts/package-zip.sh` writes `meridian-<short-sha>.zip` (the static app, license
and docs; no tests, no media, no `node_modules`). Verify it against the commit, carry it across, unzip.
There are no runtime dependencies: nothing is fetched from a CDN, and the page makes no third-party requests.

## Pointing model answers at your own infrastructure

1. **Local model server on the same machine** (LM Studio, Ollama, vLLM): pick the **CUSTOM** provider and use
   `http://localhost:1234/v1` or similar. The page's CSP already allows `localhost` and `127.0.0.1`.
2. **A firm gateway** (an OpenAI-compatible endpoint on your network): its origin must be added to `connect-src`
   in `app.html`, otherwise the browser blocks it. The container does this for you (next section). Without the
   container, edit the `connect-src` directive in the `<meta http-equiv="Content-Security-Policy">` tag.

## The hardened container (optional)

`deploy/Dockerfile` serves the static files from nginx (non-root, port 8080) with real response headers
(`frame-ancestors 'none'`, `nosniff`, COOP, a locked-down Permissions-Policy) in addition to the page's meta CSP.

```sh
docker build -f deploy/Dockerfile -t meridian .
docker run --rm -p 8080:8080 meridian                       # same network rules as the hosted page
docker run --rm -p 8080:8080 \
  -e MERIDIAN_AIRGAP=1 \                                     # drop api.anthropic.com / api.openai.com
  -e LLM_ORIGIN=https://llm.corp.example \                   # your gateway
  -e AUDIT_ORIGIN=https://audit.corp.example \               # your usage-log collector
  meridian
```

At start-up the container builds `connect-src` from those variables, validates each as a bare `https://host[:port]`
origin (anything else aborts start-up), and rewrites the meta CSP in `app.html` so the header and the meta tag
agree. `sh deploy/test-csp.sh` exercises that logic without Docker. It is not in the GitHub Actions workflow yet (pushing a workflow change needs a token with `workflow` scope); to add it, append `- run: sh deploy/test-csp.sh` to `.github/workflows/selftests.yml`. **The Dockerfile itself was
written in an environment without Docker and has not been built or run yet**; treat the first build as the test.

## Audit log (optional, firm-controlled)

Meridian's usage log is **off by default** and local to the browser. If you want a central record, enable it in
Settings and set the endpoint to a collector you run. The workbench POSTs batches of whitelisted metadata (time,
question kind, provider, timings, counts, share counts). It never sends code, file paths, keys or question text
unless question text is switched on.

`node deploy/audit-sink.mjs` is a 60-line, dependency-free collector that appends those batches to a JSON-lines
file: bind it to an internal interface and put authentication in front of it (the browser sends no credentials).
Set `ALLOW_ORIGIN` to your Meridian origin. A remote collector needs the container (or a hand edit of
`connect-src`); `http://localhost` collectors work with the stock page.

## What this does not give you

- No server-side enforcement of anything: expiry and one-time use on shares are client-side (see the privacy page).
- No SSO, no per-user audit trail beyond what your collector records, no central policy management.
- Not a security product: it is a deterministic code-reading tool that keeps your code in the tab.
