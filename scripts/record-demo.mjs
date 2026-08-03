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
 * Output: an intermediate .webm (gitignored). Convert to media/meridian-demo.mp4
 * and media/meridian-demo.gif with scripts/encode-demo.sh.
 *
 * Prereqs (already present on the box): Chromium + ffmpeg under /opt/pw-browsers,
 * `npm i playwright` (throwaway, gitignored). Run: `node scripts/record-demo.mjs`
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
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

function serve() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  return p;
}

// Move the presenter cursor to an element's centre (so switches/selects read on
// video even when we drive them programmatically).
async function glide(page, selector) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error('chromium not found at ' + CHROME);
  mkdirSync(REC_DIR, { recursive: true });
  const server = serve();
  await sleep(700); // let the static server come up

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    recordVideo: { dir: REC_DIR, size: { width: W, height: H } },
  });
  await ctx.addInitScript(CURSOR_INIT);
  // Swallow export downloads so clicking the export buttons doesn't hang.
  ctx.on('page', (pg) => pg.on('download', (d) => d.saveAs(path.join(REC_DIR, 'dl-' + d.suggestedFilename())).catch(() => {})));

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/app.html`, { waitUntil: 'load' });

  /* ======================= ACT 1 — LOCAL ENGINE ======================= */

  // Scene 1 — first-run: the honest entry point (no key required).
  const demoBtn = page.locator('#fr-demo');
  await demoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await sleep(1900); // read the modal: "Try the demo — LOCAL, no key"
  await demoBtn.hover();
  await sleep(350);
  await demoBtn.click();

  // Scene 2 — sample project loads; LOCAL answers Q1 with a trace + evidence.
  await page.locator('#demobanner').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.convo-in .ev-row .ev').first().waitFor({ state: 'visible', timeout: 8000 });
  await sleep(2200);

  // Scene 3 — click an evidence chip → the cited file opens at the cited line.
  const opened = await openFirstEvidence(page);
  if (opened) {
    await sleep(2400); // dwell on the highlighted lines in the viewer
    await page.locator('#vclose').click();
    await sleep(600);
  }

  // Scene 4 — one more bundled question, straight from the demo chips.
  const chips = page.locator('#demobanner .demochip');
  const n = await chips.count();
  if (n > 1) {
    await chips.nth(1).scrollIntoViewIfNeeded();
    await chips.nth(1).hover();
    await sleep(400);
    await chips.nth(1).click();
    await page.locator('.convo-in .ev-row .ev').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await sleep(2200);
  }

  /* ==================== ACT 2 — SONNET 5 HOW-TO ==================== */

  // Scene 5 — switch the provider to Anthropic; the model select offers SONNET 5.
  await glide(page, '#navprov');
  await sleep(500);
  await page.selectOption('#navprov', 'anthropic').catch(() => {});
  await sleep(650);
  await glide(page, '#modelsel');
  await page.selectOption('#modelsel', 'claude-sonnet-5').catch(() => {});
  await sleep(900); // top bar now reads ANTHROPIC · SONNET 5 · live context

  // Scene 6 — bring your own key: open Settings, show the ANTHROPIC API KEY field.
  // (Nothing is typed — the key is yours; requests go straight to Anthropic.)
  await glide(page, '#setbtn');
  await sleep(300);
  await page.locator('#setbtn').click();
  await page.locator('#drawer.open').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await glide(page, '#keyin');
  await sleep(2200); // read: "ANTHROPIC API KEY · sk-ant-…" + the provider note
  await page.locator('#setbtn').click(); // close settings
  await sleep(600);

  // Scene 7 — ask a question, then PREVIEW SEND: exactly what goes to Sonnet 5.
  await glide(page, '#prompt');
  await page.locator('#prompt').click();
  await page.locator('#prompt').fill('Where is the todo list persisted, and what validates a new todo?');
  await sleep(700);
  await glide(page, '#prevbtn');
  await sleep(350);
  await page.locator('#prevbtn').click();
  // The CONTEXT // SEND PREVIEW panel: files + token estimates + grounding state.
  await sleep(3200); // dwell on the honest "what would be sent" breakdown
  await page.keyboard.press('Escape');
  await sleep(700);

  // Scene 8 — the grounding switch: verified path:line evidence sent with the ask.
  await glide(page, '#groundbtn');
  await sleep(1500);

  await ctx.close();   // finalizes the .webm
  await browser.close();
  server.kill('SIGTERM');
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
