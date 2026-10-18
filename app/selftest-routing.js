import { classifyIntent } from './local.js';
import { INTENTS, LOCAL_MENU, LOCAL_STARTERS } from './intents.js';
import { trap } from './helpers.js';
import { summarize } from './analytics.js';
/* ============ SELF-TESTS: INTENT ROUTING ============
   Query → intent table, registry consistency and the LOCAL question menu. Runs inside the shared
   scratch project that runSelfTests (selftest.js) has already loaded. */
function routingCases(ok) {
  /* intent routing — the full query → kind table, command grammar + NL cascade.
     Order-sensitive: several rows exist purely to pin cascade precedence. */
  var ROUTES = [
    ['def addTodo', 'def'],
    ['where is addTodo defined', 'def'],
    ['refs addTodo', 'refs'],
    ['what references addTodo', 'refs'],
    ['who calls addTodo', 'refs'],
    ['importers store.js', 'importers'],
    ['what imports store.js', 'importers'],
    ['what does server.js import', 'imports'],
    ['what depends on store.js', 'importers'],       /* dependents, NOT imports — must beat the imports route */
    ['what does store.js depend on', 'imports'],     /* the "what does X depend on" form stays with imports */
    ['files related to store.js', 'related'],
    ['project structure', 'structure'],
    ['where are the tests', 'tests'],
    ['entry points', 'entries'],
    ['what changed recently', 'recent'],
    ['recent 5', 'recent'],
    ['list js files', 'listType'],
    ['search API_BASE_URL', 'search'],
    ['dir src', 'dir'],
    ['symbols', 'symbols'],
    ['help', 'help'],
    ['why is the store slow', 'reason'],
    ['summarize everything about it', 'plain'],
    /* niche intents — command + NL forms, including the cascade-collision pins */
    ['cycles', 'cycles'],
    ['are there circular dependencies', 'cycles'],   /* must beat importers' depend- regex */
    ['orphans', 'orphans'],
    ['show unused files', 'orphans'],                /* must beat listType's <word> files trap */
    ['dead code', 'orphans'],
    ['broken imports', 'broken'],                    /* must beat importers' import- regex */
    ['exports src/store.js', 'exports'],
    ['what does store.js export', 'exports'],
    ['todos', 'todos'],
    ['list the fixmes', 'todos'],
    ['env', 'env'],
    ['which environment variables are used', 'env'],
    ['hubs', 'hubs'],
    ['most imported files', 'hubs'],                 /* must beat importers' imported- regex */
    ['hotspots', 'hotspots'],
    ['largest files', 'hotspots'],
    ['untested', 'untested'],
    ['files without tests', 'untested'],             /* must beat the tests intent */
    ['dupes', 'dupes'],
    ['duplicate symbols', 'dupes'],                  /* must beat the symbols intent */
    ['path src/index.js src/store.js', 'path'],
    ['dependency path from index.js to store.js', 'path'],
    /* signals — command + NL, incl. pins vs hotspots ("biggest") and reason ("should i") */
    ['signals', 'signals'],
    ['top issues', 'signals'],
    ["what's wrong here", 'signals'],
    ['what should i look at', 'signals'],
    ['what matters', 'signals'],
    ['biggest problems', 'signals'],
    ['where is signalHandler defined', 'def'],
    /* drift — must beat recent's what-changed regex */
    ['drift', 'drift'],
    ['what changed since last session', 'drift'],
    /* command-grammar gate (audit F2) — prose that merely STARTS with a command
       alias must fall through to the NL cascade, never swallow the sentence as
       an argument. A trailing "why?" is interpretation → reason, always. */
    ['Help me understand the auth flow', 'reason'],
    ['Tests are failing after the refactor, why?', 'reason'],   /* trailing-why beats the tests route */
    ['Search performance is terrible, how do I fix it?', 'reason'],
    ['Dead simple question: why is login slow', 'reason'],
    ['Path forward for the auth rewrite?', 'plain'],            /* no interpretation marker — honest deterministic search */
    ['Imports are slow, why?', 'reason'],                       /* trailing-why beats the importers route */
    ['Related work on this?', 'plain'],
    ['Recent regressions in checkout?', 'recent'],
    ['Structure of payments confuses me, why?', 'reason'],      /* trailing-why beats the structure route */
    ['Exports keep breaking', 'plain'],                         /* two prose tokens — the gate declines */
    ['search "cache control"', 'search'],                       /* quoted arg = the literal escape hatch */
    ['why do we have circular imports', 'cycles'],              /* leading why stays with the cascade */
    /* natural-language collision & edge cases (audit: routing robustness pass) */
    ['what uses store.js', 'importers'],                        /* "what uses" — was falling to plain */
    ['what uses addTodo', 'importers'],                         /* symbol arg — the run redirects to references */
    ['who uses addTodo', 'importers'],
    ['who uses the store', 'importers'],                        /* determiner + usage verb — arg must be the noun */
    ['what depends on the store', 'importers'],
    ['who imports util.js', 'importers'],
    ['show the dependency graph', 'hubs'],                      /* was falling to plain — fan-in is the honest answer */
    ['list all files', 'listType'],                             /* determiner guard lists everything */
    ['list every file', 'listType'],
    ['show all python files', 'listType'],
    ['list all functions', 'symbols'],                          /* not listType — no real extension present */
    ['uses of json', 'refs'],                                   /* bare "uses of" stays with refs, not importers */
    ['what calls listTodos', 'refs'],
    ['where is the config', 'def'],                             /* determiner question still lands on def */
    ['what does the server import', 'imports'],                 /* determiner + no extension resolves via basename */
    /* blast radius / transitive impact — must beat importers' depend- regex and plain */
    ['impact src/store.js', 'impact'],
    ['blast radius of store.js', 'impact'],                     /* alias + prose rest declines the command gate */
    ['what breaks if I change store.js', 'impact'],
    ['what depends on store.js transitively', 'impact'],
    ['who would notice if store.js disappeared', 'impact']
  ];
  ROUTES.forEach(function (rc) {
    var got = classifyIntent(rc[0]) || {};
    ok('route · “' + rc[0] + '” → ' + rc[1], got.kind === rc[1], got.kind !== rc[1] ? 'got ' + got.kind : '');
  });
  ok('route · reason needs a model', classifyIntent('why is the store slow').needsModel === true);
  ok('route · def arg picks the symbol', classifyIntent('where is addTodo defined').arg === 'addTodo');
  ok('route · importers arg picks the path', classifyIntent('what imports store.js').arg === 'store.js');
  var qs = classifyIntent('search "cache control"');
  ok('route · quoted search arg unwrapped + literal', qs.arg === 'cache control' && qs.literal === true, qs.arg);
  ok('route · path keeps two tokens', classifyIntent('path src/index.js src/store.js').arg === 'src/index.js src/store.js');
  ok('route · trailing-why is not deterministic', classifyIntent('Imports are slow, why?').needsModel === true);
  ok('route · determiner arg picks the noun (who uses the store)', classifyIntent('who uses the store').arg === 'store', classifyIntent('who uses the store').arg);
  ok('route · determiner arg picks the noun (what depends on the store)', classifyIntent('what depends on the store').arg === 'store', classifyIntent('what depends on the store').arg);
  ok('route · def determiner arg (where is the config)', classifyIntent('where is the config').arg === 'config', classifyIntent('where is the config').arg);
  /* registry consistency — every reasoning instance is a complete entry */
  ok('registry · entries complete (kind/ground/run)', INTENTS.every(function (it) {
    return typeof it.kind === 'string' && it.kind && typeof it.ground === 'string' && typeof it.run === 'function'
      && (it.route === null || typeof it.route === 'function') && Array.isArray(it.aliases);
  }));
  ok('registry · kinds unique', new Set(INTENTS.map(function (it) { return it.kind; })).size === INTENTS.length);
  ok('registry · plain is the terminal fallback', INTENTS[INTENTS.length - 1].kind === 'plain');
  /* LOCAL question menu — the "what can I ask" catalog is well-formed and every
     ready-to-send (no-placeholder) entry routes to a real deterministic intent */
  ok('localmenu · catalog well-formed', LOCAL_MENU.length > 0 && LOCAL_MENU.every(function (g) {
    return typeof g.group === 'string' && g.group && Array.isArray(g.items) && g.items.length > 0
      && g.items.every(function (it) { return it && typeof it.label === 'string' && it.label && typeof it.fill === 'string' && it.fill; });
  }));
  ok('localmenu · no-placeholder fills route to a real intent', LOCAL_MENU.every(function (g) {
    return g.items.every(function (it) {
      if (it.fill.indexOf('<') !== -1) return true; /* templates need an arg — skip */
      var k = classifyIntent(it.fill).kind;
      return k !== 'plain' && k !== 'reason';
    });
  }), 'every menu command resolves');
  ok('localmenu · starters are non-empty strings', LOCAL_STARTERS.length > 0 && LOCAL_STARTERS.every(function (s) { return typeof s === 'string' && s.length > 0; }));
}
export { routingCases };
