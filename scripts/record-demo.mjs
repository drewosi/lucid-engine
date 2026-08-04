/**
 * record-demo.mjs — capture a real MERIDIAN demo, honestly.
 *
 * Two acts, both the actual product — nothing faked, nothing re-created:
 *   Act 1 — LOCAL engine: the built-in first-run demo answers a tiny bundled
 *           `todo-api` project deterministically (no key, no AI, no network).
 *           The UI self-labels DEMO · LOCAL ENGINE, LOCAL · NO AI, KNOWN LOCALLY.
 *   Act 2 — Sonnet 5 how-to: switch the provider to Anthropic and the model to
 *           SONNET 5 (1M-token context), show where your own key goes, then open
 *           [ PREVIEW SEND ] — the exact context (files + token estimates +
 *           grounding state) that would be sent to the model. No key is entered
 *           and no request is made, so no model answer is shown or fabricated;
 *           the honest-demo rule is preserved.
 *
 * A caption bar (mono system voice) is baked into the capture so the video
 * explains itself — README embeds autoplay muted and the GIF has no audio,
 * so on-screen text beats a voiceover for this medium.
 *
 * Output: an intermediate .webm (gitignored). Convert to media/meridian-demo.mp4
 * and media/meridian-demo.gif with scripts/encode-demo.sh.
 *
 * Prereqs (already present on the box): Chromium + ffmpeg under /opt/pw-browsers,
 * `npm i playwright` (throwaway, gitignored). Run: `node scripts/record-demo.mjs`
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC_DIR = path.join(ROOT, 'scripts', '.rec');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const W = 1280, H = 800, PORT = 8137;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Inject a soft "presenter" cursor so clicks read on video (Playwright's mouse
// is otherwise invisible). Purely cosmetic — it never covers content.
const CURSOR_INIT = `
  (function(){
    function mount(){
      if (document.getElementById('__cur')) return;
      var c = document.createElement('div');
      c.id = '__cur';
      c.style.cssText = 'position:fixed;z-index:2147483647;width:16px;height:16px;'
        + 'margin:-8px 0 0 -8px;border-radius:50%;pointer-events:none;left:-50px;top:-50px;'
        + 'background:rgba(255,92,10,.35);border:1.5px solid #FF5C0A;'
        + 'transition:left .18s cubic-bezier(.16,1,.3,1),top .18s cubic-bezier(.16,1,.3,1);'
        + 'box-shadow:0 0 12px rgba(255,92,10,.5)';
      document.documentElement.appendChild(c);
      addEventListener('mousemove', function(e){ c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }, true);
      addEventListener('mousedown', function(){ c.style.transform='scale(.7)'; }, true);
      addEventListener('mouseup', function(){ c.style.transform='scale(1)'; }, true);
    }
    if (document.documentElement) mount();
    document.addEventListener('DOMContentLoaded', mount);
  })();
`;

// A narrator caption bar in the system's mono voice, pinned to the bottom edge.
// pointer-events:none (never blocks the UI), z 150 (below toasts at 160 so real
// product feedback still reads above it). Purely presentational for the video.
const CAPTION_INIT = `
  (function(){
    function mount(){
      if (document.getElementById('__cap')) return;
      var b = document.createElement('div');
      b.id = '__cap';
      b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:46px;z-index:150;'
        + 'display:flex;align-items:center;justify-content:center;pointer-events:none;'
        + 'background:rgba(10,11,13,.94);border-top:1px solid #34363E;'
        + 'font-family:"Cascadia Code","JetBrains Mono",ui-monospace,Consolas,monospace;'
        + 'font-size:14px;letter-spacing:.04em;color:#EDECE7;opacity:0;'
        + 'transition:opacity .25s cubic-bezier(.16,1,.3,1)';
      document.documentElement.appendChild(b);
    }
    if (document.documentElement) mount();
    document.addEventListener('DOMContentLoaded', mount);
  })();
`;

// Set (or clear) the caption. idx renders in Signal Orange, text in ink.
async function cap(page, idx, text) {
  await page.evaluate(([i, t]) => {
    var b = document.getElementById('__cap');
    if (!b) return;
    if (!t) { b.style.opacity = '0'; return; }
    b.innerHTML = '';
    var n = document.createElement('b');
    n.style.cssText = 'color:#FF5C0A;font-weight:500;margin-right:14px';
    n.textContent = i;
    var s = document.createElement('span');
    s.textContent = t;
    b.appendChild(n); b.appendChild(s);
    b.style.opacity = '1';
  }, [idx, text]).catch(() => {});
}

// Move the presenter cursor to an element's centre (so switches/selects read on
// video even when we drive them programmatically).
async function glide(page, selector) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

// Zero-dependency static server (node builtins only — same pattern as
// scripts/run-selftests.mjs; python is not required on the box).
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const srv = http.createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/index.html';
      const buf = await readFile(path.join(ROOT, p));
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    } catch (e) { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((resolve) => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

async function main() {
  if (!existsSync(CHROME)) throw new Error('chromium not found at ' + CHROME);
  mkdirSync(REC_DIR, { recursive: true });
  const server = await serve();

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    recordVideo: { dir: REC_DIR, size: { width: W, height: H } },
  });
  await ctx.addInitScript(CURSOR_INIT);
  await ctx.addInitScript(CAPTION_INIT);
  // Swallow export downloads so clicking the export buttons doesn't hang.
  ctx.on('page', (pg) => pg.on('download', (d) => d.saveAs(path.join(REC_DIR, 'dl-' + d.suggestedFilename())).catch(() => {})));

  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'load' });

  /* ======================= ACT 1 — LOCAL ENGINE ======================= */

  // Scene 1 — first-run: the honest entry point (no key required).
  const demoBtn = page.locator('#fr-demo');
  await demoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await cap(page, '01', 'THE HONEST ENTRY — the demo runs the LOCAL engine: no key, no AI, zero network');
  await sleep(2400); // read the modal + caption
  await demoBtn.hover();
  await sleep(350);
  await demoBtn.click();

  // Scene 2 — sample project loads; LOCAL answers Q1 with a trace + evidence.
  await page.locator('#demobanner').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.convo-in .ev-row .ev').first().waitFor({ state: 'visible', timeout: 8000 });
  await cap(page, '02', 'the opening answer is SIGNALS — ranked, real findings, each pinned to file:line evidence');
  await sleep(2600);

  // Scene 3 — click an evidence chip → the cited file opens at the cited line.
  await cap(page, '03', 'evidence chips open the cited file at its exact line');
  const opened = await openFirstEvidence(page);
  if (opened) {
    await sleep(2600); // dwell on the highlighted lines in the viewer
    await page.locator('#vclose').click();
    await sleep(600);
  }

  // Scene 4 — one more bundled question, straight from the demo chips.
  const chips = page.locator('#demobanner .demochip');
  const n = await chips.count();
  if (n > 1) {
    await cap(page, '04', 'a second question — deterministic, honestly labeled KNOWN LOCALLY');
    await chips.nth(1).scrollIntoViewIfNeeded();
    await chips.nth(1).hover();
    await sleep(400);
    await chips.nth(1).click();
    await page.locator('.convo-in .ev-row .ev').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await sleep(2400);
  }

  /* ==================== ACT 2 — SONNET 5 HOW-TO ==================== */

  // Scene 5 — switch the provider to Anthropic; the model select offers SONNET 5.
  await cap(page, '05', 'SONNET 5 SETUP — provider → ANTHROPIC, model → SONNET 5 · 1M-token context');
  await glide(page, '#navprov');
  await sleep(700);
  await page.selectOption('#navprov', 'anthropic').catch(() => {});
  await sleep(650);
  await glide(page, '#modelsel');
  await page.selectOption('#modelsel', 'claude-sonnet-5').catch(() => {});
  await sleep(1200); // top bar now reads ANTHROPIC · SONNET 5 · live context

  // Scene 6 — bring your own key: open Settings, show the ANTHROPIC API KEY field.
  // (Nothing is typed — the key is yours; requests go straight to Anthropic.)
  await cap(page, '06', 'your key goes in settings — stored in this browser only, sent straight to Anthropic');
  await glide(page, '#setbtn');
  await sleep(300);
  await page.locator('#setbtn').click();
  await page.locator('#drawer.open').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await glide(page, '#keyin');
  await sleep(2600); // read: "ANTHROPIC API KEY · sk-ant-…" + the provider note
  await page.locator('#setbtn').click(); // close settings
  await sleep(600);

  // Scene 7 — ask a question, then PREVIEW SEND: exactly what goes to Sonnet 5.
  await cap(page, '07', '[ PREVIEW SEND ] — the exact files + tokens a question would send to Sonnet 5');
  await glide(page, '#prompt');
  await page.locator('#prompt').click();
  await page.locator('#prompt').fill('Where is the todo list persisted, and what validates a new todo?');
  await sleep(800);
  await glide(page, '#prevbtn');
  await sleep(350);
  await page.locator('#prevbtn').click();
  // The CONTEXT // SEND PREVIEW panel: files + token estimates + grounding state.
  await sleep(3600); // dwell on the honest "what would be sent" breakdown
  await page.keyboard.press('Escape');
  await sleep(600);

  // Scene 8 — the grounding switch: verified path:line evidence sent with the ask.
  await cap(page, '08', 'GROUND: ON — verified path:line evidence accompanies every model question');
  await glide(page, '#groundbtn');
  await sleep(2200);
  await cap(page, '', '');
  await sleep(400);

  await ctx.close();   // finalizes the .webm
  await browser.close();
  server.close();
  console.log('done — .webm written under', REC_DIR);
}

// Click evidence chips until the file viewer opens (skips COPY/RUN/dead chips).
async function openFirstEvidence(page) {
  const chips = page.locator('.convo-in .ev-row .ev');
  const count = await chips.count();
  for (let i = 0; i < count; i++) {
    const c = chips.nth(i);
    const txt = (await c.textContent().catch(() => '')) || '';
    if (/COPY|RUN|INCLUDE/i.test(txt)) continue;
    if ((await c.getAttribute('class') || '').includes('dead')) continue;
    await c.scrollIntoViewIfNeeded();
    await c.hover();
    await sleep(450);
    await c.click();
    const on = await page.locator('#viewveil.on').isVisible().catch(() => false);
    if (on) return true;
  }
  return false;
}

main().catch((e) => { console.error(e); process.exit(1); });
