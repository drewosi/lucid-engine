/**
 * run-selftests.mjs — run MERIDIAN's in-app self-test suite headlessly.
 *
 * The app's modules are DOM-bound at load (helpers.js touches document), so the
 * suite runs where it was designed to run: inside the real app in a browser.
 * This script serves the repo root, opens app.html in headless Chromium, calls
 * the same __meridianSelfTest() hook the console exposes, prints each check,
 * and exits non-zero on any failure.
 *
 * Prereqs (same throwaway toolchain as record-demo.mjs, gitignored):
 *   npm i playwright        — Chromium itself is found via PLAYWRIGHT_BROWSERS_PATH,
 *                             or set CHROME=/path/to/chrome to point at a binary.
 * Run: node scripts/run-selftests.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8143;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/index.html';
  const file = path.join(ROOT, path.normalize(clean).replace(/^([.][.][/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

let results = [];
try {
  await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__meridianSelfTest === 'function', null, { timeout: 15000 });
  results = await page.evaluate(() => window.__meridianSelfTest());
} finally {
  await browser.close();
  server.close();
}

let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.extra ? '  — ' + r.extra : ''}`);
}
console.log(`\n${results.length - fails} / ${results.length} passed`);
if (!results.length || fails) process.exit(1);
