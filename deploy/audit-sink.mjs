/**
 * audit-sink.mjs: a minimal, dependency-free collector for Meridian's opt-in usage log.
 *
 * Run it inside your own network and point Settings -> usage analytics -> endpoint at it
 * (the workbench POSTs batches of whitelisted events: time, question kind, provider,
 * timings, counts; never code, paths or keys). Events are appended to a JSON-lines file.
 *
 *   node deploy/audit-sink.mjs                    # 127.0.0.1:8787 -> ./meridian-audit.jsonl
 *   PORT=8787 HOST=0.0.0.0 OUT=/var/log/meridian-audit.jsonl ALLOW_ORIGIN=https://meridian.corp.example node deploy/audit-sink.mjs
 *
 * The browser sends no credentials and no custom headers (by design), so authenticate
 * with the network (bind to an internal interface, firewall, or a reverse proxy that adds
 * mTLS). ALLOW_ORIGIN pins CORS to your Meridian host; it defaults to refusing browsers
 * from anywhere else. Request bodies over 256 KB are rejected.
 */
import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const OUT = process.env.OUT || 'meridian-audit.jsonl';
const ALLOW = process.env.ALLOW_ORIGIN || '';
const MAX = 256 * 1024;

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOW ? origin === ALLOW : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return true;
  }
  return false;
}

export function createSink(out = OUT) {
  return createServer((req, res) => {
    const allowed = cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }
    if (req.method !== 'POST' || !allowed) { res.writeHead(allowed ? 405 : 403); return res.end(); }
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (size > MAX) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400); return res.end(); }
      if (!body || body.format !== 'meridian-analytics' || !Array.isArray(body.events)) { res.writeHead(422); return res.end(); }
      const received = new Date().toISOString();
      const lines = body.events.slice(0, 200).map((e) => JSON.stringify({ received, ip: req.socket.remoteAddress, ...e })).join('\n') + '\n';
      try { await appendFile(out, lines); res.writeHead(204); } catch { res.writeHead(500); }
      res.end();
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createSink().listen(PORT, HOST, () => console.log(`meridian audit sink on http://${HOST}:${PORT} -> ${OUT}`));
}
