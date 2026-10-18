import { evAt, symLookup, pickSymbol, LOCAL_VERDICT, gatherTerrain, localHelp } from './intents-core.js';
/* ============ INTENTS: FALLBACK ============
   reason, plain (the terminal fallbacks). Entries are verbatim from the registry in intents.js; array order is the
   routing cascade, so intents.js concatenates the groups in a fixed order. */
var FALLBACK = [
  { kind: 'reason', aliases: [], ground: 'evidence', helpCmd: '', needsModel: true,
    route: function (s, lo, idx) { return /\b(why|how (do|does|is|should|can|would)|root cause|recommend|refactor|improve|architect(ure)?|risk|risks|should i|would you|best way|design|rationale|trade-?offs?|explain|understand(ing)?|help me\b)\b/.test(lo) ? { arg: pickSymbol(s, idx) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var t = gatherTerrain(q, steps);
      var sym = arg && symLookup(arg, idx).length ? arg : (t.terms[0] || '');
      if (sym) {
        var sd = symLookup(sym, idx);
        if (sd.length) steps.push({ action: 'locate “' + sym + '”', note: sd.length + ' definition' + (sd.length === 1 ? '' : 's'), evidence: sd.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
      }
      var actions = [];
      if (sym) actions.push({ kind: 'def', command: sym, why: 'inspect where ' + sym + ' is defined' }, { kind: 'refs', command: sym, why: 'see everywhere ' + sym + ' is used' });
      actions.push({ kind: 'recent', command: '10', why: 'check what changed recently' });
      var top5 = t.ranked.slice(0, 5).map(function (r) { return '- `' + r.p + '`'; }).join('\n');
      return {
        steps: steps, actions: actions,
        verdict: { local: false, text: 'REQUIRES MODEL REASONING' },
        answer: 'This question asks for **interpretation** (root cause / recommendation / explanation): that is where a model reasons, and Meridian will not fabricate it. What Meridian **can** tell you is the terrain: it gathered ' + (t.ranked.length) + ' relevant file' + (t.ranked.length === 1 ? '' : 's') + ' and ' + steps.reduce(function (a, s) { return a + (s.evidence ? s.evidence.length : 0); }, 0) + ' pieces of evidence.\n\n'
          + (top5 ? 'Most relevant files:\n\n' + top5 + '\n\n' : '')
          + 'Connect a model in settings to synthesize an answer. It receives your question, the files you ticked (SMART mode sends a project map and the most relevant of them) and this evidence. [ PREVIEW SEND ] shows the exact payload.'
      };
    } },

  /* plain: deterministic ranked search; synthesis optional. Terminal fallback. */
  { kind: 'plain', aliases: [], ground: 'evidence', helpCmd: '', needsModel: false,
    route: function (s, lo, idx) { return { arg: pickSymbol(s, idx) }; },
    run: function (arg, q) {
      var steps = [];
      var tp = gatherTerrain(q, steps);
      if (!tp.terms.length) return { steps: steps, verdict: LOCAL_VERDICT(), answer: 'That question has no distinctive terms to search for. Name a symbol, filename, or keyword, or use a command.\n\n' + localHelp() };
      var topSym = tp.terms[0];
      var actions = [{ kind: 'def', command: topSym, why: 'where “' + topSym + '” is defined' }, { kind: 'refs', command: topSym, why: 'every reference to “' + topSym + '”' }, { kind: 'recent', command: '10', why: 'recently modified files' }];
      return { steps: steps, verdict: LOCAL_VERDICT(), actions: actions,
        answer: tp.ranked.length ? 'Deterministic search: the files below best match your words (match count, then importance). Open a chip to inspect, or ask `def`/`refs`. Interpreting *why* would benefit from a model.\n\n' + tp.ranked.slice(0, 5).map(function (r, i) { return (i + 1) + '. `' + r.p + '`: ' + r.count + ' match' + (r.count === 1 ? '' : 'es'); }).join('\n') : 'None of your terms appear in the loaded files. Try different wording or check what is selected in CONTEXT.' };
    } }
];
export { FALLBACK };
