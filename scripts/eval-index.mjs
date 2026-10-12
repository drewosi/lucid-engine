/**
 * eval-index.mjs: measure the indexer's precision and recall against real open-source repos.
 *
 * The indexer (app/index-core.js) is a pure ES module, so it runs here in Node exactly as it
 * does in the browser or the worker. Ground truth comes from real parsers:
 *   JS/TS   TypeScript's own scanner/AST (ts.preProcessFile for imports, createSourceFile for
 *           top-level declarations)
 *   Python  the stdlib ast module (scripts/eval-python-truth.py)
 * Go and Rust have no parser here, so they are NOT measured and the README says so.
 *
 * Prereqs (throwaway, outside the repo, like the Playwright toolchain):
 *   npm i typescript@5                       # in any folder, then point TS_FROM at it
 *   git clone --depth 1 <repo> <dir> ...   # the repos listed in docs/eval/repos.txt
 * Run:
 *   TS_FROM=/path/to/node_modules node scripts/eval-index.mjs <repos-dir> [--json docs/eval/index-eval.json]
 *
 * What is compared
 *   imports  set of (file, module specifier) pairs. Precision = predicted pairs the parser also
 *            found; recall = parser pairs the indexer found.
 *   symbols  set of (file, name) for declarations at the top level of a file (scope-aware truth:
 *            the AST parent must be the source file). Predicted = index entries flagged top
 *            (declared at column 0). One-character names are excluded from truth because the
 *            indexer ignores them by design. Destructuring bindings count toward recall.
 * Files the indexer deliberately skips as generated/minified are excluded from both sides and
 * counted separately, so the numbers describe the code the product actually mines.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildIndexCore } = await import(pathToFileURL(path.join(here, '..', 'app', 'index-core.js')).href);
const reqFrom = createRequire(path.join(path.resolve(process.env.TS_FROM || here), 'x.js'));
const ts = reqFrom('typescript');

/* the same directory ignore list as app/ingest.js */
const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.cache', '.idea', '.vscode']);
const TEXT_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py|json|md|yml|yaml|toml|cfg|txt)$/i;
const MAX_FILE = 512 * 1024;

const args = process.argv.slice(2);
const reposDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!reposDir) { console.error('usage: node scripts/eval-index.mjs <repos-dir> [--json out.json]'); process.exit(2); }

function walk(dir, rel, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (IGNORE.has(e.name.toLowerCase()) || (e.name.startsWith('.') && e.name !== '.github')) continue;
      walk(path.join(dir, e.name), rel + e.name + '/', out);
    } else if (e.isFile() && TEXT_EXT.test(e.name)) {
      const full = path.join(dir, e.name);
      if (statSync(full).size > MAX_FILE) continue;
      out.push([rel + e.name, full]);
    }
  }
}
const sh = (cwd) => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd }).toString().trim(); } catch { return 'unknown'; } };

function tsTruth(file, text) {
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.(ts|mts|cts)$/i.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  /* imports: every static/dynamic/require/export-from/import-type specifier written as a quoted string
     (template-literal specifiers are not statically knowable and the indexer does not claim them) */
  const imports = new Set();
  const add = (n) => { if (n && ts.isStringLiteral(n)) imports.add(n.text); };
  (function walk(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) add(n.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) add(n.moduleReference.expression);
    else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) add(n.arguments[0]);
      else if (ts.isIdentifier(n.expression) && n.expression.text === 'require') add(n.arguments[0]);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) add(n.argument.literal);
    ts.forEachChild(n, walk);
  })(sf);
  /* top-level declarations (scope-aware: the AST parent is the file). Bindings whose initializer is a
     require()/import() call are imports, not definitions, so they are not counted as symbols. */
  const top = new Set();
  const isRequireInit = (e) => {
    while (e) {
      if (ts.isCallExpression(e)) { if ((ts.isIdentifier(e.expression) && e.expression.text === 'require') || e.expression.kind === ts.SyntaxKind.ImportKeyword) return true; e = e.expression; }
      else if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e)) e = e.expression;
      else return false;
    }
    return false;
  };
  const bind = (n) => {
    if (ts.isIdentifier(n)) top.add(n.text);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n.elements.forEach((e) => { if (e.name) bind(e.name); });
  };
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && ts.isIdentifier(st.name)) top.add(st.name.text);
    else if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => { if (!(d.initializer && isRequireInit(d.initializer))) bind(d.name); });
  }
  for (const n of [...top]) if (n.length < 2) top.delete(n);
  return { imports, top };
}

function pyTruth(paths) {
  const list = path.join(tmpdir(), 'meridian-eval-pyfiles.json');
  writeFileSync(list, JSON.stringify(paths));
  const script = path.join(here, 'eval-python-truth.py');
  for (const py of ['python', 'python3']) {
    try { return JSON.parse(execFileSync(py, ['-I', script, list], { maxBuffer: 1 << 29 }).toString()); } catch { /* try the next name */ }
  }
  return null;
}

const score = (tp, pred, truth) => ({ tp, pred, truth, precision: pred ? tp / pred : null, recall: truth ? tp / truth : null });
const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(1) + '%');
const results = [];

for (const name of readdirSync(reposDir).sort()) {
  const root = path.join(reposDir, name);
  if (!statSync(root).isDirectory()) continue;
  const list = []; walk(root, '', list);
  const files = new Map(), abs = new Map();
  for (const [rel, full] of list) { try { files.set(rel, { content: readFileSync(full, 'utf8') }); abs.set(rel, full); } catch { /* unreadable */ } }
  const t0 = Date.now();
  const idx = buildIndexCore(files, {});
  const ms = Date.now() - t0;
  const generated = new Set(idx.generated.map((g) => g.file));
  const predTop = new Map(); // file -> Set(name)
  for (const [sym, entries] of idx.symbols) for (const e of entries) if (e.top) (predTop.get(e.file) || predTop.set(e.file, new Set()).get(e.file)).add(sym);

  const row = { repo: name, commit: sh(root), files: files.size, indexMs: ms, generatedSkipped: generated.size, js: null, py: null };
  const tally = () => ({ imp: { tp: 0, pred: 0, truth: 0 }, sym: { tp: 0, pred: 0, truth: 0 }, files: 0 });
  const acc = { js: tally(), py: tally() };
  const misses = { js: [], py: [] };

  const jsFiles = [...files.keys()].filter((f) => /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(f) && !generated.has(f));
  for (const f of jsFiles) {
    const g = tsTruth(f, files.get(f).content);
    const predImp = new Set((idx.importsByFile.get(f) || []).map((e) => e.raw));
    const a = acc.js; a.files++;
    a.imp.pred += predImp.size; a.imp.truth += g.imports.size; for (const x of predImp) if (g.imports.has(x)) a.imp.tp++; else if (misses.js.length < 40) misses.js.push(['import-fp', f, x]);
    for (const x of g.imports) if (!predImp.has(x) && misses.js.length < 80) misses.js.push(['import-fn', f, x]);
    const ps = predTop.get(f) || new Set();
    a.sym.pred += ps.size; a.sym.truth += g.top.size; for (const x of ps) if (g.top.has(x)) a.sym.tp++; else if (misses.js.length < 120) misses.js.push(['sym-fp', f, x]);
    for (const x of g.top) if (!ps.has(x) && misses.js.length < 160) misses.js.push(['sym-fn', f, x]);
  }

  const pyFiles = [...files.keys()].filter((f) => /\.py$/i.test(f) && !generated.has(f));
  if (pyFiles.length) {
    const truth = pyTruth(pyFiles.map((f) => abs.get(f)));
    if (truth) for (const f of pyFiles) {
      const g = truth[abs.get(f)]; if (!g) continue;
      const gi = new Set(g.imports), gt = new Set(g.top.filter((n) => n.length > 1));
      const predImp = new Set((idx.importsByFile.get(f) || []).map((e) => e.raw));
      const a = acc.py; a.files++;
      a.imp.pred += predImp.size; a.imp.truth += gi.size; for (const x of predImp) if (gi.has(x)) a.imp.tp++; else if (misses.py.length < 40) misses.py.push(['import-fp', f, x]);
      for (const x of gi) if (!predImp.has(x) && misses.py.length < 80) misses.py.push(['import-fn', f, x]);
      const ps = predTop.get(f) || new Set();
      a.sym.pred += ps.size; a.sym.truth += gt.size; for (const x of ps) if (gt.has(x)) a.sym.tp++; else if (misses.py.length < 120) misses.py.push(['sym-fp', f, x]);
      for (const x of gt) if (!ps.has(x) && misses.py.length < 160) misses.py.push(['sym-fn', f, x]);
    }
  }
  for (const k of ['js', 'py']) if (acc[k].files) row[k] = { files: acc[k].files, imports: score(acc[k].imp.tp, acc[k].imp.pred, acc[k].imp.truth), symbols: score(acc[k].sym.tp, acc[k].sym.pred, acc[k].sym.truth), sample: misses[k] };
  results.push(row);
}

/* micro-averages across repos, per language */
const agg = {};
for (const k of ['js', 'py']) {
  const t = { files: 0, imp: [0, 0, 0], sym: [0, 0, 0] };
  for (const r of results) if (r[k]) { t.files += r[k].files; ['tp', 'pred', 'truth'].forEach((m, i) => { t.imp[i] += r[k].imports[m]; t.sym[i] += r[k].symbols[m]; }); }
  agg[k] = t.files ? { files: t.files, imports: score(...t.imp), symbols: score(...t.sym) } : null;
}

const label = { js: 'JS/TS', py: 'Python' };
let md = '| Repo | Commit | Lang | Files | Import precision | Import recall | Symbol precision | Symbol recall |\n|---|---|---|---:|---:|---:|---:|---:|\n';
for (const r of results) for (const k of ['js', 'py']) if (r[k]) md += `| ${r.repo} | \`${r.commit}\` | ${label[k]} | ${r[k].files} | ${pct(r[k].imports.precision)} | ${pct(r[k].imports.recall)} | ${pct(r[k].symbols.precision)} | ${pct(r[k].symbols.recall)} |\n`;
for (const k of ['js', 'py']) if (agg[k]) md += `| **all** | | **${label[k]}** | **${agg[k].files}** | **${pct(agg[k].imports.precision)}** | **${pct(agg[k].imports.recall)}** | **${pct(agg[k].symbols.precision)}** | **${pct(agg[k].symbols.recall)}** |\n`;
console.log(md);
console.log('generated/minified files skipped per repo:', results.map((r) => `${r.repo}=${r.generatedSkipped}`).join(' '));
if (jsonOut) {
  mkdirSync(path.dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify({ date: new Date().toISOString().slice(0, 10), aggregate: agg, repos: results }, null, 1));
  console.log('wrote', jsonOut);
}
