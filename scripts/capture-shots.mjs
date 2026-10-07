/**
 * capture-shots.mjs — the landing page's screenshots, taken from the real app.
 *
 * Same rule as record-demo.mjs: nothing faked. This drives app.html in headless
 * Chromium and screenshots what the product actually renders:
 *   media/meridian-poster.jpg  — the built-in demo's opening answer (also the
 *                                video poster on the landing page)
 *   media/shot-workspace.jpg   — two small sample repos loaded as one workspace,
 *                                answered by the LOCAL engine's `workspace` intent
 *   media/shot-share.jpg       — the share dialog over the demo project
 *   media/shot-usage.jpg       — the opt-in usage log after a few questions
 * The two workspace repos are tiny fixtures written to a temp folder; they are
 * labelled as samples wherever the page shows them.
 *
 * Prereqs: `npm i playwright` (throwaway, gitignored). CHROME=/path overrides the
 * browser binary. Run: node scripts/capture-shots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'media');
const PORT = 8139, W = 1280, H = 800;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* two sample repos: a shared dependency, a repo link (web depends on the
   package api publishes), and a name exported by both */
const REPOS = {
  web: {
    'package.json': '{\n  "name": "web",\n  "dependencies": { "@acme/api": "1.0.0", "zod": "^3.23.0" }\n}',
    'src/main.ts': "import { listTodos } from '@acme/api';\nimport { formatDate } from './format';\n\nexport function render() {\n  return listTodos().map(function (t) { return t.title + ' ' + formatDate(t.created); });\n}",
    'src/format.ts': 'export function formatDate(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}',
    'README.md': '# web\n\nThe front end. Talks to @acme/api.'
  },
  api: {
    'package.json': '{\n  "name": "@acme/api",\n  "main": "src/index.js",\n  "dependencies": { "zod": "^3.23.0" }\n}',
    'src/index.js': "const { listTodos, addTodo } = require('./store');\nconst { formatDate } = require('./format');\n\nmodule.exports = { listTodos, addTodo, formatDate };",
    'src/store.js': '// In-memory store.\nlet todos = [];\n\nfunction addTodo(title) {\n  const t = { title: title, created: new Date() };\n  todos.push(t);\n  return t;\n}\n\nfunction listTodos() { return todos.slice(); }\n\nmodule.exports = { addTodo, listTodos };',
    'src/format.js': 'function formatDate(d) {\n  return d.toISOString();\n}\n\nmodule.exports = { formatDate };',
    'test/store.test.js': "const assert = require('assert');\nconst { addTodo, listTodos } = require('../src/store');\naddTodo('x');\nassert.ok(listTodos().length === 1);"
  }
};

async function writeRepos(dir) {
  const out = {};
  for (const [name, files] of Object.entries(REPOS)) {
    const base = path.join(dir, name);
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
      await writeFile(path.join(base, rel), text);
    }
    out[name] = base;
  }
  return out;
}

async function ask(page, q) {
  const before = await page.locator('.convo-in .msg').count();
  await page.locator('#prompt').fill(q);
  await page.locator('#askform').evaluate((f) => f.requestSubmit());
  await page.waitForFunction((n) => document.querySelectorAll('.convo-in .msg').length > n, before, { timeout: 8000 }).catch(() => {});
  await sleep(700);
}
async function clickToast(page, label) {
  const b = page.locator('button', { hasText: label }).last();
  await b.waitFor({ state: 'visible', timeout: 5000 });
  await b.click();
}
/* scroll the chat (not the page) so a message's top sits at the top of the stage */
async function showMsg(page, fromEnd) {
  await page.evaluate((k) => {
    var convo = document.getElementById('convo'), m = convo.querySelectorAll('.msg');
    var t = m[m.length - k]; if (!t) return;
    convo.scrollTop += t.getBoundingClientRect().top - convo.getBoundingClientRect().top - 12;
  }, fromEnd);
  await sleep(300);
}
/* wait for toasts to time out on their own so they don't sit over the frame */
async function quiet(page) {
  await page.waitForFunction(() => !document.querySelector('#toasts .toast'), null, { timeout: 9000 }).catch(() => {});
}
async function shot(page, name) {
  await quiet(page);
  await page.screenshot({ path: path.join(MEDIA, name), type: 'jpeg', quality: 82 });
  console.log('wrote media/' + name);
}

const server = createServer(async (req, res) => {
  const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/index.html';
  try {
    const body = await readFile(path.join(ROOT, path.normalize(clean).replace(/^([.][.][/\\])+/, '')));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(clean)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const tmp = await mkdtemp(path.join(tmpdir(), 'meridian-shots-'));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const dirs = await writeRepos(tmp);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  /* force the webkitdirectory picker path so Playwright can hand it a folder */
  await ctx.addInitScript(() => { try { delete window.showDirectoryPicker; } catch (e) {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

  /* 1 — the landing page's demo link: ?demo with a fresh browser shows the terms
     veil with the demo button focused; one click runs it */
  await page.goto(`http://127.0.0.1:${PORT}/app.html?demo`, { waitUntil: 'load' });
  await page.locator('#fr-demo').waitFor({ state: 'visible', timeout: 15000 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'fr-demo') throw new Error('?demo should focus the demo button, got ' + focused);
  await page.locator('#fr-demo').click();
  await page.locator('.convo-in .ev-row .ev').first().waitFor({ state: 'visible', timeout: 8000 });
  await showMsg(page, 2);
  await shot(page, 'meridian-poster.jpg');

  /* turn the usage log on, then ask the other demo questions so it has events */
  await page.locator('#setbtn').click();
  await page.locator('#anbtn').click();
  await page.locator('#setbtn').click();
  await ask(page, 'where is API_BASE_URL defined?');
  await ask(page, 'what imports store.js?');

  /* 2 — share dialog over the demo project */
  await page.locator('#sharebtn').click();
  await page.locator('#shareveil.on').waitFor({ state: 'visible', timeout: 4000 });
  await sleep(1200); /* let the size meter measure */
  await shot(page, 'shot-share.jpg');
  await page.keyboard.press('Escape');

  /* 3 — two repos as one workspace */
  await page.locator('#dirpick').setInputFiles(dirs.web);
  await clickToast(page, '[ REPLACE ]');
  await page.waitForFunction(() => document.querySelectorAll('#tree [data-path], #tree .row').length > 0, null, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  await page.locator('#dirpick').setInputFiles(dirs.api);
  await clickToast(page, '[ ADD REPO ]');
  await sleep(1200);
  await ask(page, 'workspace');
  await ask(page, 'where is formatDate defined?');
  await showMsg(page, 2);
  await shot(page, 'shot-workspace.jpg');

  /* 4 — the usage log */
  await page.locator('#setbtn').click();
  await page.locator('#anopen').click();
  await page.locator('#anveil.on').waitFor({ state: 'visible', timeout: 4000 });
  await sleep(800);
  await shot(page, 'shot-usage.jpg');
} finally {
  await browser.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
}
