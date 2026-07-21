/**
 * record-demo.mjs — capture a real MERIDIAN demo, honestly.
 *
 * Drives app.html's built-in first-run demo: a tiny bundled `todo-api` project
 * answered by the deterministic LOCAL engine (no key, no AI, no network). What
 * you see is the actual product — the UI self-labels DEMO · LOCAL ENGINE,
 * LOCAL · NO AI, and KNOWN LOCALLY. Nothing is faked or re-created.
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
    await sleep(2600); // dwell on the highlighted lines in the viewer
    await page.locator('#vclose').click();
    await sleep(700);
  }

  // Scene 4 & 5 — the other two bundled questions, straight from the demo chips.
  const chips = page.locator('#demobanner .demochip');
  const n = await chips.count();
  for (let i = 1; i < Math.min(n, 3); i++) {
    await chips.nth(i).scrollIntoViewIfNeeded();
    await chips.nth(i).hover();
    await sleep(400);
    await chips.nth(i).click();
    await page.locator('.convo-in .ev-row .ev').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await sleep(2300);
  }

  // Scene 6 — exportable traces: Markdown + self-contained HTML.
  const exhtml = page.locator('#exporthtml');
  await exhtml.scrollIntoViewIfNeeded();
  await exhtml.hover();
  await sleep(500);
  await exhtml.click();          // → self-contained HTML trace export
  await sleep(1100);
  await page.locator('#exportmd').hover();
  await sleep(500);
  await page.locator('#exportmd').click(); // → Markdown export
  await sleep(1400);

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
