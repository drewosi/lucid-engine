/**
 * record-demo.mjs: capture a real Meridian demo, honestly.
 *
 * Everything on screen is the actual product. Nothing is faked or re-created:
 *   Act 1  LOCAL engine. The built-in first-run demo answers a tiny bundled
 *          `todo-api` project from the deterministic index (no key, no AI, no
 *          network). The UI labels itself DEMO, LOCAL, NO AI and KNOWN LOCALLY.
 *   Act 2  Multi-repo workspace. Two tiny sample repos (scripts/sample-repos.mjs,
 *          written to a temp folder and loaded through the real folder picker)
 *          become one workspace with ADD REPO. ASK: ALL REPOS questions cite
 *          repo:path:line, and the switch narrows a question to one repo.
 *   Act 3  Share dialog. The size meter and the "this contains the code" box are
 *          shown. Nothing is copied and no link or bundle is produced.
 *   Act 4  Your own model. Provider and model are switched, the key field is
 *          shown empty, and PREVIEW SEND shows the exact payload. No key is
 *          entered and no request is made, so no model answer is shown or made up.
 *   Act 5  Settings. The FILE CAP field at its default of 8,000, and usage
 *          analytics OFF by default.
 *
 * A caption bar (mono system voice) is baked into the capture so the video
 * explains itself: README embeds autoplay muted and the GIF has no audio.
 *
 * Output: an intermediate .webm (gitignored). Convert to media/meridian-demo.mp4
 * and media/meridian-demo.gif with scripts/encode-demo.sh.
 *
 * Prereqs: `npm i playwright` (throwaway, gitignored). The browser is, in order:
 * the CHROME env var, the Linux path below when it exists, else Playwright's own
 * Chromium. Run: `node scripts/record-demo.mjs`
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeRepos } from './sample-repos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC_DIR = path.join(ROOT, 'scripts', '.rec');
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const W = 1280, H = 800, PORT = 8137;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CHROME wins, then the Linux build when it is there, else Playwright's default.
function launchOptions() {
  const args = ['--force-color-profile=srgb'];
  const exe = process.env.CHROME || (existsSync(LINUX_CHROME) ? LINUX_CHROME : '');
  if (!exe) return { args };
  return { executablePath: exe, args: ['--no-sandbox', ...args] };
}

// Inject a soft "presenter" cursor so clicks read on video (Playwright's mouse
// is otherwise invisible). Purely cosmetic: it never covers content.
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
        + 'font-size:14px;letter-spacing:.02em;color:#EDECE7;opacity:0;'
        + 'transition:opacity .25s cubic-bezier(.16,1,.3,1)';
      document.documentElement.appendChild(b);
      // lift the product's toasts above the caption bar so neither hides the other
      var st = document.createElement('style');
      st.textContent = '#toasts{bottom:62px !important}';
      document.documentElement.appendChild(st);
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
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
}

// Scroll an element to the middle of the settings drawer, then point at it.
async function showInDrawer(page, selector) {
  await page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await sleep(300);
  await glide(page, selector);
}

// Click a toast action button (for example [ REPLACE ] or [ ADD REPO ]) with the cursor visible.
async function clickToast(page, label) {
  const b = page.locator('#toasts button', { hasText: label }).last();
  await b.waitFor({ state: 'visible', timeout: 6000 });
  await sleep(1100); // let the viewer read the choice
  const box = await b.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await sleep(350);
  await b.click();
}

// Type a question into the composer and send it, then wait for the answer.
async function ask(page, q) {
  const before = await page.locator('.convo-in .msg').count();
  await glide(page, '#prompt');
  await page.locator('#prompt').click();
  await page.locator('#prompt').pressSequentially(q, { delay: 28 });
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.convo-in .msg').length > n, before, { timeout: 8000 }).catch(() => {});
  await sleep(500);
}

// Zero-dependency static server (node builtins only, same pattern as
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
  mkdirSync(REC_DIR, { recursive: true });
  const server = await serve();
  const tmp = await mkdtemp(path.join(tmpdir(), 'meridian-demo-'));
  const repos = await writeRepos(tmp);

  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    recordVideo: { dir: REC_DIR, size: { width: W, height: H } },
  });
  await ctx.addInitScript(CURSOR_INIT);
  await ctx.addInitScript(CAPTION_INIT);
  // Use the plain folder input so the recorder can hand it the sample repos.
  await ctx.addInitScript(() => { try { delete window.showDirectoryPicker; } catch (e) {} });
  // Swallow export downloads so clicking the export buttons doesn't hang.
  ctx.on('page', (pg) => pg.on('download', (d) => d.saveAs(path.join(REC_DIR, 'dl-' + d.suggestedFilename())).catch(() => {})));

  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'load' });

  /* ======================= ACT 1: LOCAL ENGINE ======================= */

  // Scene 1: first run, the honest entry point (no key required).
  const demoBtn = page.locator('#fr-demo');
  await demoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await cap(page, '01', 'Open the demo. It runs the LOCAL engine: no key, no AI, no network.');
  await sleep(2800); // read the modal + caption
  await demoBtn.hover();
  await sleep(350);
  await demoBtn.click();

  // Scene 2: sample project loads; LOCAL answers Q1 with a trace + evidence.
  await page.locator('#demobanner').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.convo-in .ev-row .ev').first().waitFor({ state: 'visible', timeout: 8000 });
  await cap(page, '02', 'The first answer is a ranked list of findings. Each one points to a file and line.');
  await sleep(3200);

  // Scene 3: click an evidence chip, and the cited file opens at the cited line.
  await cap(page, '03', 'Click an evidence chip and the cited file opens at that exact line.');
  const opened = await openFirstEvidence(page);
  if (opened) {
    await sleep(3000); // dwell on the highlighted lines in the viewer
    await page.locator('#vclose').click();
    await sleep(600);
  }

  // Scene 4: one more bundled question, straight from the demo chips.
  const chips = page.locator('#demobanner .demochip');
  const n = await chips.count();
  if (n > 1) {
    await cap(page, '04', 'Ask a second question. LOCAL answers from its index and labels it KNOWN LOCALLY.');
    await chips.nth(1).scrollIntoViewIfNeeded();
    await chips.nth(1).hover();
    await sleep(400);
    await chips.nth(1).click();
    await page.locator('.convo-in .ev-row .ev').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await sleep(3000);
  }

  /* ================== ACT 2: MULTI-REPO WORKSPACE ================== */

  // Scene 5: load a folder over a loaded project; Meridian asks what to do.
  await cap(page, '05', 'Load a sample folder. Meridian asks whether to replace the project or add a repo.');
  await page.locator('#dirpick').setInputFiles(repos.web);
  await clickToast(page, '[ REPLACE ]');
  await page.locator('#tree').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await sleep(1800);

  // Scene 6: load a second folder and choose ADD REPO.
  await cap(page, '06', 'Load a second folder and choose ADD REPO. Both repos now sit in one workspace.');
  await page.locator('#dirpick').setInputFiles(repos.api);
  await clickToast(page, '[ ADD REPO ]');
  await page.locator('#wsscope').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await sleep(2600);

  // Scene 7: ask across all repos; the evidence names its repo.
  await cap(page, '07', 'ASK: ALL REPOS sends a question to every repo. Evidence reads repo:path:line.');
  await glide(page, '#wsscope');
  await sleep(900);
  await ask(page, 'where is formatDate defined?');
  await sleep(3200);

  // Scene 8: narrow the scope to one repo, then back to all.
  await cap(page, '08', 'Click the switch to narrow questions to one repo, and again to ask them all.');
  await glide(page, '#wsscope');
  await sleep(500);
  await page.locator('#wsscope').click();
  await sleep(2200);
  await page.locator('#wsscope').click();
  await sleep(1200);

  /* ====================== ACT 3: SHARE DIALOG ====================== */

  // Scene 9: open the share dialog.
  await cap(page, '09', 'Share a project as a link or a file. No server sits in between.');
  await glide(page, '#sharebtn');
  await sleep(500);
  await page.locator('#sharebtn').click();
  await page.locator('#shareveil.on').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(2800);

  // Scene 10: the size meter.
  await cap(page, '10', 'The meter shows the link size against its 32,000 character limit.');
  await glide(page, '#sharebar');
  await sleep(3200);

  // Scene 11: the acknowledgement box. Nothing is copied.
  await cap(page, '11', 'Tick the box to confirm the link contains your code. This demo copies nothing.');
  await page.locator('#shareveil .modal').evaluate((m) => m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' }));
  await sleep(900);
  await glide(page, '#shareack');
  await sleep(700);
  await page.locator('#shareack').check();
  await sleep(2800);
  await glide(page, '#shareclose');
  await page.locator('#shareclose').click();
  await sleep(800);

  /* ================== ACT 4: YOUR OWN MODEL ================== */

  // Scene 12: switch the provider to Anthropic; the model select offers SONNET 5.
  await cap(page, '12', 'To use a model, pick a provider and model. Here that is Anthropic and Sonnet 5.');
  await glide(page, '#navprov');
  await sleep(700);
  await page.selectOption('#navprov', 'anthropic').catch(() => {});
  await sleep(650);
  await glide(page, '#modelsel');
  await page.selectOption('#modelsel', 'claude-sonnet-5').catch(() => {});
  await sleep(1800);

  // Scene 13: your key goes in Settings. Nothing is typed.
  await cap(page, '13', 'Your key goes in Settings. It stays in this browser and goes only to the provider.');
  await glide(page, '#setbtn');
  await sleep(300);
  await page.locator('#setbtn').click();
  await page.locator('#drawer.open').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await glide(page, '#keyin');
  await sleep(3200);
  await page.locator('#setbtn').click(); // close settings
  await sleep(600);

  // Scene 14: ask a question, then PREVIEW SEND shows exactly what would go out.
  await cap(page, '14', 'PREVIEW SEND shows the exact files and token estimates a question would send.');
  await glide(page, '#prompt');
  await page.locator('#prompt').click();
  await page.locator('#prompt').fill('Where is the todo list stored, and what validates a new todo?');
  await sleep(800);
  await glide(page, '#prevbtn');
  await sleep(350);
  await page.locator('#prevbtn').click();
  await sleep(4200); // dwell on the "what would be sent" breakdown
  await page.keyboard.press('Escape');
  await sleep(600);

  // Scene 15: the grounding switch.
  await cap(page, '15', 'GROUND: ON adds verified file and line evidence to every model question.');
  await glide(page, '#groundbtn');
  await sleep(3000);

  /* ======================== ACT 5: SETTINGS ======================== */

  // Scene 16: the file cap, at its default.
  await cap(page, '16', 'Settings also holds FILE CAP. The default is 8,000 files.');
  await glide(page, '#setbtn');
  await sleep(300);
  await page.locator('#setbtn').click();
  await page.locator('#drawer.open').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await sleep(600);
  await showInDrawer(page, '#maxfilesin');
  await sleep(3600);

  // Scene 17: analytics are off until you turn them on.
  await cap(page, '17', 'Usage analytics are OFF by default. Nothing is recorded until you turn them on.');
  await showInDrawer(page, '#anbtn');
  await sleep(3600);
  await cap(page, '', '');
  await sleep(400);

  await ctx.close();   // finalizes the .webm
  await browser.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
  console.log('done: .webm written under', REC_DIR);
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
