/* ============ LANGUAGE RELIABILITY TIERS (pure) ============
   Honest labels for how much to trust the index per language. The extraction is
   regex-based (a parser swap is planned, see README), so depth varies:
     core        regex rules with fixture tests and a measured precision (README table)
     best-effort rules exist and are fixture-tested, but not measured on real repos;
                 expect misses and the occasional wrong edge
     minimal     recognised and counted; only generic declaration rules apply
   Docs/config/markup languages are not code and carry no tier.                    */

var TIER_BY_LANG = Object.assign(Object.create(null), {
  js: 'core', ts: 'core', python: 'core', go: 'core', rust: 'core',
  java: 'best-effort', ruby: 'best-effort', php: 'best-effort', 'c#': 'best-effort', kotlin: 'best-effort', swift: 'best-effort',
  c: 'minimal', cpp: 'minimal', scala: 'minimal', elixir: 'minimal', lua: 'minimal', shell: 'minimal', svelte: 'minimal', vue: 'minimal'
});
var NOT_CODE = Object.assign(Object.create(null), { html: 1, css: 1, markdown: 1, json: 1, yaml: 1, toml: 1, other: 1 });

function tierOf(lang) { return TIER_BY_LANG[lang] || (NOT_CODE[lang] ? '' : 'minimal'); }

/* langs: { lang: fileCount } -> { core: [[lang,n]…], 'best-effort': […], minimal: […] } */
function tierSummary(langs) {
  var out = { core: [], 'best-effort': [], minimal: [] };
  Object.keys(langs || {}).forEach(function (l) {
    var t = tierOf(l);
    if (t) out[t].push([l, langs[l]]);
  });
  Object.keys(out).forEach(function (t) { out[t].sort(function (a, b) { return b[1] - a[1]; }); });
  return out;
}
/* the one-line overview text, only mentioning tiers actually present */
function tierLine(langs) {
  var s = tierSummary(langs), parts = [];
  if (s.core.length) parts.push('core ✓ ' + s.core.map(function (e) { return e[0]; }).join(', '));
  if (s['best-effort'].length) parts.push('best-effort ~ ' + s['best-effort'].map(function (e) { return e[0]; }).join(', '));
  if (s.minimal.length) parts.push('basic only ○ ' + s.minimal.map(function (e) { return e[0]; }).join(', '));
  return parts.length ? '// reliability: ' + parts.join(' · ') + ' (regex extraction; see README table)' : '';
}
/* answer note for graph analyses: how many indexed files sit in approximate languages */
function tierNote(langs) {
  var s = tierSummary(langs), n = 0, names = [];
  s['best-effort'].concat(s.minimal).forEach(function (e) { n += e[1]; names.push(e[0]); });
  if (!n) return '';
  return '\n\nNote: ' + n + ' file' + (n === 1 ? '' : 's') + ' in best-effort or basic languages (' + names.slice(0, 5).join(', ') + '): symbols and import edges there are approximate, so absences (orphans, unresolved, untested) may be misses, not facts.';
}

export { tierLine, tierNote, tierOf, tierSummary };
