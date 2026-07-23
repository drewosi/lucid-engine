import { st } from './state.js';
import { estTokens, staticScore } from './smart-context.js';
import { afterIngest } from './ingest.js';
import { $ } from './helpers.js';
import { convoIn } from './trace.js';
import { dismissFirstRun, setProvider } from './shell.js';
/* ---- first-run demo: a tiny bundled project answered by the LOCAL engine, so a
   new visitor sees a real trace + evidence chips before committing an API key.
   File contents are line arrays (no template literals / backticks) — a habit from
   the app's single-inline-script era, kept because it stays copy-paste safe. ---- */
var SAMPLE_PROJECT = {
  'README.md': [
    '# todo-api',
    '',
    'A tiny in-memory todo REST API — the sample project for MERIDIAN\'s demo.',
    '',
    '## Run',
    '',
    '    npm install',
    '    npm start',
    '',
    'The server boots from src/index.js, listens on the PORT from src/config.js,',
    'and mounts every route under API_BASE_URL.',
    '',
    '## Layout',
    '',
    '- src/index.js  — entry point; boots the server',
    '- src/server.js — HTTP routes, wired to the store',
    '- src/store.js  — in-memory todo store (addTodo, listTodos, removeTodo)',
    '- src/config.js — API_BASE_URL and PORT',
    '- src/util.js   — small response helpers',
    '- test/store.test.js — store unit tests'
  ].join('\n'),
  'package.json': [
    '{',
    '  "name": "todo-api",',
    '  "version": "1.0.0",',
    '  "description": "A tiny in-memory todo REST API (MERIDIAN demo project).",',
    '  "main": "src/index.js",',
    '  "scripts": {',
    '    "start": "node src/index.js",',
    '    "test": "node test/store.test.js"',
    '  }',
    '}'
  ].join('\n'),
  'src/config.js': [
    '// Central configuration for the todo API.',
    'const PORT = process.env.PORT || 3000;',
    '',
    '// The base URL every route is mounted under.',
    'const API_BASE_URL = process.env.API_BASE_URL || ("http://localhost:" + PORT + "/api/v1");',
    '',
    'module.exports = { PORT, API_BASE_URL };'
  ].join('\n'),
  'src/store.js': [
    '// In-memory todo store. No database — state lives for the process lifetime.',
    'let todos = [];',
    'let nextId = 1;',
    '',
    'function addTodo(title) {',
    '  const todo = { id: nextId++, title: title, done: false };',
    '  todos.push(todo);',
    '  return todo;',
    '}',
    '',
    'function listTodos() {',
    '  return todos.slice();',
    '}',
    '',
    'function removeTodo(id) {',
    '  const before = todos.length;',
    '  todos = todos.filter(function (t) { return t.id !== id; });',
    '  return todos.length < before;',
    '}',
    '',
    'module.exports = { addTodo, listTodos, removeTodo };'
  ].join('\n'),
  'src/server.js': [
    'const http = require("http");',
    'const { API_BASE_URL } = require("./config");',
    'const { addTodo, listTodos } = require("./store");',
    'const { json } = require("./util");',
    '',
    '// Build the HTTP server. Routes are mounted under API_BASE_URL.',
    'function createServer() {',
    '  return http.createServer(function (req, res) {',
    '    if (req.url === API_BASE_URL + "/todos" && req.method === "GET") {',
    '      return json(res, 200, listTodos());',
    '    }',
    '    if (req.url === API_BASE_URL + "/todos" && req.method === "POST") {',
    '      return json(res, 201, addTodo("new todo"));',
    '    }',
    '    json(res, 404, { error: "not found" });',
    '  });',
    '}',
    '',
    'module.exports = { createServer };'
  ].join('\n'),
  'src/util.js': [
    '// Small response helpers shared across routes.',
    'function json(res, status, body) {',
    '  res.writeHead(status, { "Content-Type": "application/json" });',
    '  res.end(JSON.stringify(body));',
    '}',
    '',
    'module.exports = { json };'
  ].join('\n'),
  'src/index.js': [
    '// Entry point: boot the todo API server.',
    'const { createServer } = require("./server");',
    'const { PORT, API_BASE_URL } = require("./config");',
    '',
    'const server = createServer();',
    'server.listen(PORT, function () {',
    '  console.log("todo-api listening — API at " + API_BASE_URL);',
    '});'
  ].join('\n'),
  'test/store.test.js': [
    'const assert = require("assert");',
    'const { addTodo, listTodos, removeTodo } = require("../src/store");',
    '',
    '// addTodo appends and returns the new record',
    'const a = addTodo("write docs");',
    'assert.strictEqual(a.done, false);',
    'assert.ok(listTodos().length >= 1);',
    '',
    '// removeTodo drops it',
    'assert.strictEqual(removeTodo(a.id), true);',
    'console.log("store tests passed");'
  ].join('\n')
};
var DEMO_QUESTIONS = ['where is API_BASE_URL defined?', 'what imports store.js?', 'show the entry points'];

function loadSampleProject() {
  st.files.clear();
  st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
  st.totalBytes = 0;
  st.skippedFiles.length = 0;
  Object.keys(SAMPLE_PROJECT).forEach(function (path) {
    var text = SAMPLE_PROJECT[path];
    st.totalBytes += text.length;
    st.files.set(path, {
      content: text,
      lines: text.split('\n').length,
      tokens: estTokens(text, path),
      mtime: 0,
      base: staticScore(path),
      checked: true
    });
  });
  afterIngest(); /* same post-ingest path as a real folder load */
}

function renderDemoBanner() {
  if ($('demobanner')) return;
  var b = document.createElement('div');
  b.id = 'demobanner'; b.className = 'demobanner';
  var top = document.createElement('div');
  top.innerHTML = '<span class="dm mono">DEMO · LOCAL ENGINE</span>';
  var dt = document.createElement('div');
  dt.className = 'dt';
  dt.innerHTML = 'A sample <b>todo-api</b> project is loaded and answered by the deterministic <b>LOCAL</b> engine — no key, no AI, nothing leaves this tab. Try a question, then load your own project when ready.';
  b.appendChild(top); b.appendChild(dt);
  var chips = document.createElement('div'); chips.className = 'demochips';
  DEMO_QUESTIONS.forEach(function (q) {
    var c = document.createElement('button');
    c.type = 'button'; c.className = 'demochip mono'; c.textContent = q;
    c.addEventListener('click', function () { $('prompt').value = q; $('askform').requestSubmit(); });
    chips.appendChild(c);
  });
  b.appendChild(chips);
  var acts = document.createElement('div'); acts.className = 'demoacts';
  var load = document.createElement('button');
  load.type = 'button'; load.className = 'btn-quiet acc'; load.textContent = '[ LOAD YOUR OWN → ]';
  load.addEventListener('click', exitDemo);
  var dis = document.createElement('button');
  dis.type = 'button'; dis.className = 'btn-quiet'; dis.textContent = '[ dismiss ]';
  dis.addEventListener('click', function () { b.remove(); });
  acts.appendChild(load); acts.appendChild(dis);
  b.appendChild(acts);
  convoIn.insertBefore(b, convoIn.firstChild);
}

function exitDemo() {
  var b = $('demobanner'); if (b) b.remove();
  $('clearctx').click(); /* unloads the sample project (and toasts) */
  if (window.innerWidth <= 860 && !$('rail').classList.contains('open')) { $('rail').classList.add('open'); $('railbtn').setAttribute('aria-expanded', 'true'); }
  var dz2 = $('dropzone'); if (dz2 && dz2.scrollIntoView) dz2.scrollIntoView({ block: 'nearest' });
}

function startDemo() {
  /* accept the same terms record the normal path writes, then hand the demo to LOCAL */
  dismissFirstRun();
  setProvider('local');
  loadSampleProject();
  renderDemoBanner();
  $('prompt').value = DEMO_QUESTIONS[0];
  $('askform').requestSubmit(); /* LOCAL engine answers instantly — trace + evidence chips */
}
export { SAMPLE_PROJECT, startDemo };

export function initDemo() {
  $('fr-demo').addEventListener('click', startDemo);
  $('emptydemo').addEventListener('click', startDemo);
}
