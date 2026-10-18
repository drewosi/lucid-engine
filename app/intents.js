import { st } from './state.js';
import { getIndex } from './indexer.js';
import { CAP_LOCAL, CAP_MODEL, localEvidence, evAt, resolveToFile, symLookup, pickSymbol, pickPathish, partialNote, listOrphans, computeSignals, registry, localHelp } from './intents-core.js';
import { OVERVIEW } from './intents-overview.js';
import { HEALTH } from './intents-health.js';
import { INVENTORY } from './intents-inventory.js';
import { SYMBOLS } from './intents-symbols.js';
import { FALLBACK } from './intents-fallback.js';
/* ============ INTENT REGISTRY (DETERMINISTIC REASONING INSTANCES) ============
   The single source of truth for every deterministic reasoning instance the
   LOCAL engine knows. Each entry is one self-contained intent:
     kind       — stable id used across router, dispatch and grounding
     aliases    — command-grammar first words (`def x`, `refs y`, …)
     ground     — evidence-kind label the grounding bridge attributes excerpts by
     helpCmd    — the command's entry in the LOCAL help text ('' = no command)
     needsModel — true only for intents that honestly require model reasoning
     route(s, lo, idx) — natural-language matcher; returns {arg} or null.
                  ARRAY ORDER IS THE ROUTING CASCADE — earlier entries win.
     run(arg, q, idx)  — the investigation: real operations over the index,
                  returning { steps, verdict, actions?, answer }. No fabrication.
   Adding a reasoning instance = adding ONE entry to the matching intents-*.js group
   (this file concatenates the groups in cascade order). DOM-free by design so
   the registry is reusable from the grounding bridge and the self-tests.     */

var INTENTS = [].concat(OVERVIEW, HEALTH, INVENTORY, SYMBOLS, FALLBACK);
/* derived lookups — built once from the registry */
var BY_KIND = {};
INTENTS.forEach(function (it) { BY_KIND[it.kind] = it; });
var ALIAS_TO_KIND = {};
INTENTS.forEach(function (it) { (it.aliases || []).forEach(function (a) { ALIAS_TO_KIND[a] = it.kind; }); });
var CMD_RE = new RegExp('^\\s*(' + Object.keys(ALIAS_TO_KIND).join('|') + ')\\b\\s*([\\s\\S]*)$', 'i');
/* A first word that happens to be an alias is not enough to make a command —
   "Exports keep breaking" is a question, not `exports keep breaking`. The rest
   must be argument-shaped: empty, one path/word token (two for `path`/`chain`,
   any single non-space token for `search` so regex patterns survive), or a
   quoted string (quotes stripped — the literal escape hatch). Anything
   prose-shaped declines and falls through to the natural-language cascade. */
var CMD_TOKEN_RE = /^[\w$./@-]+$/;
var CMD_MAX_TOKENS = { path: 2, chain: 2 };
function commandArg(kind, rest) {
  rest = rest.trim();
  if (!rest) return { arg: '' };
  var qm = rest.match(/^"([^"]*)"$/) || rest.match(/^'([^']*)'$/);
  if (qm) return { arg: qm[1], literal: true };
  var toks = rest.split(/\s+/);
  if (toks.length > (CMD_MAX_TOKENS[kind] || 1)) return null;
  if (kind === 'search') return { arg: rest }; /* one non-space token — regex metachars allowed */
  for (var i = 0; i < toks.length; i++) if (!CMD_TOKEN_RE.test(toks[i])) return null;
  return { arg: rest };
}
registry.intents = INTENTS;
var LOCAL_HELP = localHelp();

/* ---- The LOCAL "what can I ask" menu — a curated, grouped catalog of the
   questions the deterministic engine answers, kept next to the registry so a new
   intent and its menu line land in one file. `fill` is dropped into the composer:
   an `<arg>` placeholder means "name something, then send"; the rest are ready to
   send as-is. Filling (not auto-running) keeps it correct for every provider. ---- */
var LOCAL_MENU = [
  { group: 'NAVIGATE & DESCRIBE', items: [
    { label: 'Project structure', fill: 'project structure' },
    { label: 'Where a symbol is defined', fill: 'where is <name> defined' },
    { label: 'What uses a symbol', fill: 'who uses <name>' },
    { label: 'What a file imports', fill: 'what does <file> import' },
    { label: 'What depends on a file', fill: 'what depends on <file>' },
    { label: 'Files related to a file', fill: 'files related to <file>' },
    { label: "A file's exports", fill: 'what does <file> export' },
    { label: 'Find symbols by name', fill: 'symbols <name>' },
    { label: 'Where the tests are', fill: 'where are the tests' },
    { label: 'Entry points', fill: 'entry points' },
    { label: 'Summarize a directory', fill: 'dir <path>' },
    { label: 'Recent changes', fill: 'what changed recently' },
    { label: 'Search text or regex', fill: 'search <text>' }
  ] },
  { group: 'ANALYZE: DEPENDENCY GRAPH & HEALTH', items: [
    { label: 'Circular imports', fill: 'cycles' },
    { label: 'Orphan (never-imported) files', fill: 'orphans' },
    { label: 'Broken imports', fill: 'broken' },
    { label: 'Blast radius of a change', fill: 'what breaks if I change <file>' },
    { label: 'Most-depended-on files', fill: 'hubs' },
    { label: 'Dependency path between two files', fill: 'path <a> <b>' },
    { label: 'Change hotspots', fill: 'hotspots' },
    { label: 'TODO / FIXME tags', fill: 'todos' },
    { label: 'Environment variables used', fill: 'env' },
    { label: 'Files without tests', fill: 'untested' },
    { label: 'Duplicate symbol names', fill: 'dupes' }
  ] },
  { group: 'INSTRUMENTS', items: [
    { label: 'Signals: what deserves attention', fill: 'signals' },
    { label: 'Drift: what changed since last session', fill: 'drift' },
    { label: 'Workspace: compare the loaded repos', fill: 'workspace' }
  ] }
];
/* the empty-state starter set: broad, no-argument questions that give an
   immediate feel for the engine (they drop into the composer, ready to send) */
var LOCAL_STARTERS = ['project structure', 'signals', 'orphans', 'where are the tests', 'entry points', 'hotspots', 'todos'];

/* ---- Intent router: deterministic kinds vs. reasoning vs. plain fallback ---- */
function classifyIntent(q) {
  var s = q.trim(), lo = s.toLowerCase(), idx = st.files.size ? getIndex() : null;
  var cmd = s.match(CMD_RE);
  if (cmd) {
    var k = ALIAS_TO_KIND[cmd[1].toLowerCase()];
    var ca = commandArg(k, cmd[2]);
    if (ca) return { kind: k, arg: ca.arg, literal: !!ca.literal, deterministic: true, needsModel: false };
    /* prose-shaped rest — not a command; fall through to the NL cascade */
  }
  /* a question *ending* in "why" asks for interpretation — the honest verdict is
     REQUIRES MODEL REASONING, even when a niche keyword route would also match */
  if (/\bwhy\s*\??\s*$/i.test(s)) return { kind: 'reason', arg: pickSymbol(s, idx), deterministic: false, needsModel: true };
  for (var i = 0; i < INTENTS.length; i++) {
    var it = INTENTS[i];
    if (!it.route) continue;
    var m = it.route(s, lo, idx);
    if (m) return { kind: it.kind, arg: m.arg || '', deterministic: !it.needsModel, needsModel: !!it.needsModel };
  }
  /* unreachable — 'plain' is a catch-all — kept as a hard fallback */
  return { kind: 'plain', arg: pickSymbol(s, idx), deterministic: true, needsModel: false };
}

/* ---- Investigation engine: real operations over the index, collecting evidence.
   Returns { steps, verdict:{local,text}, actions, answer }. No fabricated work. ---- */
function runInvestigation(q, intent) {
  var idx = getIndex();
  var entry = BY_KIND[intent.kind] || BY_KIND.plain;
  var out = entry.run(intent.arg, q, idx, intent);
  if (idx.partial && out && typeof out.answer === 'string') out.answer += partialNote(idx);
  return out;
}

/* grounding label map for prompt.js — kind → evidence-kind, from the registry */
function groundKinds() {
  var out = {};
  INTENTS.forEach(function (it) { out[it.kind] = it.ground || 'evidence'; });
  return out;
}

export { partialNote, CAP_LOCAL, CAP_MODEL, INTENTS, LOCAL_HELP, LOCAL_MENU, LOCAL_STARTERS, classifyIntent, computeSignals, evAt, groundKinds, listOrphans, localEvidence, pickPathish, pickSymbol, resolveToFile, runInvestigation, symLookup };
