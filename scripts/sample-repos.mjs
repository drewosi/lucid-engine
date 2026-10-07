/**
 * sample-repos.mjs: the two tiny sample repos used by capture-shots.mjs and
 * record-demo.mjs. They are written to a temp folder so the workbench can load
 * them through its normal folder picker, and every page that shows them labels
 * them as samples.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/* two sample repos: a shared dependency, a repo link (web depends on the
   package api publishes), and a name exported by both */
export const REPOS = {
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

export async function writeRepos(dir) {
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
