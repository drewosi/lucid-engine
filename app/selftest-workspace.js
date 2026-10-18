import { packSmartContext } from './smart-context.js';
import { invalidateAll, st } from './state.js';
import { classifyIntent } from './local.js';
import { runInvestigation } from './intents.js';
import { evidenceChip, extractTrace } from './trace.js';
import { buildContextBlocks } from './prompt.js';
import { buildSharePayload, bundleText, parseBundleText } from './share.js';
import { citeText, displayPath, displayText, dropRepoFiles, isMulti, registerRepo, remapRoot, repoList, repoOf, resetWorkspace, resolveCitePath, scopeRepo, uniqueLabel, withScope } from './repos.js';
import { claimLabel, selectedTokens } from './ingest.js';
import { buildSaveRecord } from './memory.js';
import { closeViewer } from './viewer.js';
import { afterWorkspaceIngest, pendingLabelFor } from './workspace.js';
import { projectSig } from './drift.js';
import { stEntry } from './selftest-fixture.js';
/* multi-repo workspace — two repos that share a relative path (src/util.js), a
   dependency (react), a package link (beta depends on alpha's @acme/alpha) and an
   exported name (formatDate). Runs on its own scratch state and restores it. */
function workspaceFixture() {
  return {
    'alpha/package.json': '{ "name": "@acme/alpha", "dependencies": { "react": "^18.0.0", "lodash": "^4.17.0" } }',
    'alpha/README.md': '# alpha\nthe shared library',
    'alpha/src/index.js': "import { formatDate } from './util.js';\nexport function startAlpha() { return formatDate(1); }",
    'alpha/src/util.js': 'export function formatDate(d) { return String(d); }\n// ALPHA_ONLY_MARKER',
    'beta/package.json': '{\n  "name": "beta-web",\n  "dependencies": {\n    "react": "^18.2.0",\n    "@acme/alpha": "1.0.0"\n  }\n}',
    'beta/src/index.js': "import { startAlpha } from '@acme/alpha';\nexport function startBeta() { return startAlpha(); }",
    'beta/src/util.js': 'export function formatDate(d) { return "beta" + d; }\n// BETA_ONLY_MARKER'
  };
}
function workspaceCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty, bytes: st.totalBytes, skipList: st.skippedFiles, skipped: st.skipped,
    ctxMode: st.ctxMode, groundMode: st.groundMode, pins: st.pinnedEv };
  var W = workspaceFixture();
  function inv(q) { var it = classifyIntent(q); return runInvestigation(q, it); }
  function load() {
    resetWorkspace();
    st.files = new Map(); st.totalBytes = 0; st.pinnedEv = [];
    st.skippedFiles = []; st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
    Object.keys(W).forEach(function (p) { st.files.set(p, stEntry(p, W[p])); st.totalBytes += W[p].length; });
    registerRepo('alpha', null); registerRepo('beta', null);
    invalidateAll();
  }
  try {
    /* one project, no repos: nothing changes for single-project users */
    resetWorkspace();
    ok('workspace · single project stays unlabelled', !isMulti() && citeText('src/x.js', 1, 2) === 'src/x.js:1–2' && displayPath('src/x.js') === 'src/x.js'
      && displayText('`alpha/src/x.js` line 2') === '`alpha/src/x.js` line 2');
    load();
    /* add / remove */
    ok('workspace · two repos registered with live counts', isMulti() && repoList().length === 2 && repoList()[0].files === 4 && repoList()[1].files === 3,
      repoList().map(function (r) { return r.label + ':' + r.files; }).join(' '));
    var added = claimLabel('alpha', null, null); /* a second folder also named "alpha" */
    st.files.set('alpha-2/src/util.js', stEntry('alpha-2/src/util.js', 'export const THIRD = 3;')); st.totalBytes += 'export const THIRD = 3;'.length;
    invalidateAll();
    ok('workspace · same-name folder joins as a new repo (alpha-2)', added === 'alpha-2' && repoList().length === 3 && repoOf('alpha-2/src/util.js') === 'alpha-2', added);
    var bytesBefore = st.totalBytes;
    var removed = dropRepoFiles('alpha-2');
    ok('workspace · removing a repo unloads only its files', removed === 1 && repoList().length === 2 && !st.files.has('alpha-2/src/util.js')
      && st.files.has('alpha/src/util.js') && st.files.has('beta/src/util.js') && st.totalBytes === bytesBefore - 'export const THIRD = 3;'.length, removed + ' removed');
    st.ws.active = 'beta';
    claimLabel('beta', 'beta', null); /* RELOAD: refill beta in place */
    ok('workspace · reload empties the repo in place, keeps it active', !st.files.has('beta/src/util.js') && repoList().some(function (r) { return r.label === 'beta'; }) && st.ws.active === 'beta');
    load();
    /* path namespacing */
    ok('workspace · identical relative paths never collide', st.files.has('alpha/src/util.js') && st.files.has('beta/src/util.js')
      && st.files.get('alpha/src/util.js').content !== st.files.get('beta/src/util.js').content);
    ok('workspace · unique labels + root remap', uniqueLabel('alpha') === 'alpha-2' && uniqueLabel('gamma') === 'gamma' && uniqueLabel('a/b:c') === 'abc'
      && remapRoot('alpha/src/x.js', 'alpha-2') === 'alpha-2/src/x.js', uniqueLabel('alpha'));
    ok('workspace · citations read repo:path:line', citeText('beta/src/util.js', 2, 2) === 'beta:src/util.js:2–2' && displayPath('alpha/README.md') === 'alpha:README.md');
    ok('workspace · cited paths resolve (repo:path · unique bare · ambiguous kept)', resolveCitePath('beta:src/util.js') === 'beta/src/util.js'
      && resolveCitePath('README.md') === 'alpha/README.md' && resolveCitePath('src/util.js') === 'src/util.js', resolveCitePath('README.md'));
    /* cross-repo query scope */
    st.ws.scope = 'all';
    var allHits = inv('search ONLY_MARKER');
    ok('scope · ALL searches every repo', /ALPHA_ONLY|alpha\/src\/util\.js/.test(JSON.stringify(allHits.steps)) && /beta\/src\/util\.js/.test(JSON.stringify(allHits.steps)));
    st.ws.scope = 'repo'; st.ws.active = 'beta';
    var filesRef = st.files;
    var scopedHits = withScope(function () { return inv('search ONLY_MARKER'); });
    var scopedEv = JSON.stringify(scopedHits.steps);
    ok('scope · active repo only searches that repo', scopeRepo() === 'beta' && /beta\/src\/util\.js/.test(scopedEv) && scopedEv.indexOf('alpha/') === -1);
    ok('scope · the swap is restored after the call', st.files === filesRef && st.files.size === 7);
    ok('scope · budget counts only the scoped repo', selectedTokens().count === 3, selectedTokens().count + ' files');
    st.ctxMode = 'full'; st.groundMode = false;
    st.ws.scope = 'all';
    var cbAll = buildContextBlocks('where is formatDate');
    var allText = cbAll.blocks.map(function (b) { return b.text; }).join('\n');
    ok('scope · model context (ALL) carries both repos + workspace note', allText.indexOf('FILE: alpha/src/util.js') !== -1 && allText.indexOf('FILE: beta/src/util.js') !== -1
      && /WORKSPACE: 2 repositories are in scope/.test(allText) && /2 REPOS/.test(cbAll.note || ''), cbAll.note);
    st.ws.scope = 'repo';
    var cbOne = buildContextBlocks('where is formatDate');
    var oneText = cbOne.blocks.map(function (b) { return b.text; }).join('\n');
    ok('scope · model context (one repo) sends only that repo', oneText.indexOf('FILE: beta/src/util.js') !== -1 && oneText.indexOf('FILE: alpha/') === -1
      && /scoped to the repository "beta"/.test(oneText) && /REPO BETA ONLY/.test(cbOne.note || ''), cbOne.note);
    st.ws.scope = 'all';
    var pk = packSmartContext('startBeta', 1000);
    ok('scope · SMART packing seats the best file of every repo', pk.included.length >= 2 && repoOf(pk.included[0].p) !== repoOf(pk.included[1].p)
      && pk.included.slice(0, 2).every(function (x) { return x.why.indexOf('best in repo') !== -1; }), pk.included.map(function (x) { return x.p; }).join(' '));
    /* repo-labelled evidence chips */
    var chip = evidenceChip({ file: 'beta/src/util.js', startLine: 2, endLine: 2, quote: 'BETA_ONLY_MARKER' });
    ok('chips · labelled repo:path:line', chip.textContent === 'ctx://beta:src/util.js:2–2' && chip.querySelector('.repo') && chip.querySelector('.repo').textContent === 'beta'
      && !chip.disabled && /^Open beta:src\/util\.js at 2–2/.test(chip.title), chip.textContent);
    chip.click();
    var vt = document.getElementById('vtitle').textContent, vb = document.getElementById('vbody').textContent;
    closeViewer();
    ok('chips · open the right file in the right repo', vt === 'beta:src/util.js' && vb.indexOf('BETA_ONLY_MARKER') !== -1 && vb.indexOf('ALPHA_ONLY_MARKER') === -1, vt);
    var mt = extractTrace('x\n```meridian-trace\n{"steps":[{"action":"a","evidence":[{"file":"alpha:src/util.js","startLine":1,"endLine":1},{"file":"src/util.js","startLine":1,"endLine":1}]}]}\n```');
    var mev = mt.trace.steps[0].evidence;
    ok('chips · model "repo:path" citation maps to the loaded file; ambiguous stays dead', mev[0].file === 'alpha/src/util.js' && mev[1].file === 'src/util.js'
      && evidenceChip(mev[1]).disabled === true, mev[0].file + ' · ' + mev[1].file);
    /* the cross-repo intent */
    ok('intent · workspace routes only with 2+ repos', classifyIntent('compare the repos').kind === 'workspace');
    var wsInv = inv('workspace');
    ok('intent · workspace finds the shared dependency', /`react` \(`alpha`, `beta`\)/.test(wsInv.answer), wsInv.answer.slice(0, 80));
    ok('intent · workspace finds the repo link + cross-repo import', /`beta` → `alpha` via `@acme\/alpha`/.test(wsInv.answer) && /`beta` → `alpha` ×1/.test(wsInv.answer));
    ok('intent · workspace finds names exported in both repos', /`formatDate` \(`alpha`, `beta`\)/.test(wsInv.answer));
    ok('intent · workspace evidence points at real files', wsInv.steps.some(function (s) { return (s.evidence || []).some(function (e) { return e.file === 'beta/package.json' && e.startLine > 1; }); }));
    /* LOCAL answer text reads repo:path like the chips, never the internal repo/path */
    var wdef = inv('where is formatDate defined');
    var wdefText = displayText(wdef.answer);
    ok('workspace · LOCAL answer text shows repo:path', wdefText.indexOf('`alpha:src/util.js`') !== -1 && wdefText.indexOf('`beta:src/util.js`') !== -1
      && wdefText.indexOf('alpha/src/util.js') === -1 && wdefText.indexOf('beta/src/util.js') === -1, wdefText.split('\n').slice(2, 4).join(' '));
    ok('workspace · display leaves non-path text and URLs alone', displayText('`alpha` and `beta` share https://x.io/alpha/y') === '`alpha` and `beta` share https://x.io/alpha/y');
    st.ws.scope = 'repo'; st.ws.active = 'beta';
    var wsScoped = withScope(function () { return inv('workspace'); });
    ok('intent · workspace reads every repo even when scoped', /`alpha`/.test(wsScoped.answer) && /2 repos/.test(wsScoped.answer));
    st.ws.scope = 'all';
    ok('drift · a workspace is identified by its repo labels', projectSig() === 'workspace:alpha+beta', projectSig());
    /* saved workspace: metadata only */
    st.files.get('beta/src/util.js').checked = false;
    var rec = buildSaveRecord('ws selftest');
    var recJson = JSON.stringify(rec);
    var TOP = ['name', 'savedAt', 'fileCount', 'totalTokens', 'unchecked', 'ignore', 'prefs', 'handle', 'kind', 'repos', 'loose'];
    ok('saved workspace · records repos, counts and selection', rec.kind === 'workspace' && rec.repos.length === 2 && rec.repos[0].label === 'alpha' && rec.repos[0].fileCount === 4
      && rec.repos[1].fileCount === 3 && rec.unchecked.length === 1 && rec.unchecked[0] === 'beta/src/util.js', rec.repos.map(function (r) { return r.label + ':' + r.fileCount; }).join(' '));
    ok('saved workspace · persists no file contents', Object.keys(rec).every(function (k) { return TOP.indexOf(k) !== -1; })
      && rec.repos.every(function (r) { return Object.keys(r).every(function (k) { return ['label', 'fileCount', 'totalTokens', 'handle'].indexOf(k) !== -1; }); })
      && Object.keys(W).every(function (p) { return recJson.indexOf(W[p]) === -1; }) && recJson.indexOf('ONLY_MARKER') === -1 && recJson.indexOf('formatDate') === -1, recJson.length + ' chars');
    /* restore: re-picked folders join under their saved labels, selection comes back */
    st.files.get('beta/src/util.js').checked = true;
    st.pendingWorkspace = { rec: { name: 'ws selftest', unchecked: ['beta/src/util.js'], prefs: { active: 'beta', scope: 'repo' } }, waiting: [{ label: 'beta', handle: null, fileCount: 3 }] };
    var pend = pendingLabelFor('beta');
    afterWorkspaceIngest();
    ok('saved workspace · re-picked repo restores its selection + scope', pend === 'beta' && st.pendingWorkspace === null
      && st.files.get('beta/src/util.js').checked === false && st.ws.scope === 'repo' && st.ws.active === 'beta');
    st.files.get('beta/src/util.js').checked = true;
    st.ws.scope = 'all';
    /* share: repo labels travel, untrusted labels are dropped */
    var spl = buildSharePayload(['alpha/src/util.js', 'beta/src/util.js'], { name: 'ws', now: 1 });
    var sback = parseBundleText(bundleText(spl));
    ok('share · a workspace share carries its repo labels', JSON.stringify(spl.repos) === '["alpha","beta"]' && JSON.stringify(sback.repos) === '["alpha","beta"]');
    var bogus = parseBundleText(JSON.stringify({ format: 'meridian-share', v: 1, name: 'x', repos: ['alpha', '../x', 'nope', 'a/b', 42], files: [{ p: 'alpha/a.js', c: 'x' }] }));
    ok('share · repo labels are validated against the shared paths', JSON.stringify(bogus.repos) === '["alpha"]', JSON.stringify(bogus.repos));
    resetWorkspace();
    ok('intent · workspace with one project is honest', !isMulti() && classifyIntent('compare the repos').kind !== 'workspace' && /Only one project is loaded/.test(inv('workspace').answer));
  } finally {
    resetWorkspace();
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty; st.totalBytes = keep.bytes;
    st.skippedFiles = keep.skipList; st.skipped = keep.skipped; st.ctxMode = keep.ctxMode; st.groundMode = keep.groundMode; st.pinnedEv = keep.pins;
    st.contextDirty = true; st.mapDirty = true;
  }
}
export { workspaceCases };
