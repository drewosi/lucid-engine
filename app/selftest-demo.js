import { getIndex } from './indexer.js';
import { invalidateAll, st } from './state.js';
import { SAMPLE_PROJECT, wantsDemo } from './demo.js';
import { classifyIntent } from './local.js';
import { runInvestigation } from './intents.js';
import { app } from './helpers.js';
import { stEntry } from './selftest-fixture.js';
/* the landing page's demo link (app.html?demo): which URLs start the demo, and
   that a #share= link is never shadowed by it */
function demoLinkCases(ok) {
  ok('demo link · ?demo starts the demo', wantsDemo('?demo', '') === true);
  ok('demo link · ?demo=1 and a later ?x&demo param also work', wantsDemo('?demo=1', '') && wantsDemo('?x=1&demo', ''));
  ok('demo link · no param, no demo', wantsDemo('', '') === false && wantsDemo('?selftest', '') === false);
  ok('demo link · a longer param name is not a match', wantsDemo('?demolition', '') === false && wantsDemo('?nodemo', '') === false);
  ok('demo link · a #share= link wins over ?demo', wantsDemo('?demo', '#share=v1.abc') === false);
  ok('demo link · an unrelated hash does not block it', wantsDemo('?demo', '#top') === true);
}
/* the demo must show what the landing page sells: indexed on its own, the sample
   project's planted assistant mistakes are each caught, and nothing else is flagged
   as broken (post-merge audit finding 8) */
function demoCatchCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty };
  function inv(q) { return runInvestigation(q, classifyIntent(q)); }
  try {
    st.files = new Map();
    Object.keys(SAMPLE_PROJECT).forEach(function (p) { st.files.set(p, stEntry(p, SAMPLE_PROJECT[p])); });
    invalidateAll();
    getIndex();
    var sg = inv('signals');
    ok('demo catch · signals leads with the broken import, CRITICAL', /CRITICAL/.test(sg.answer.split('\n').slice(0, 4).join('\n')) && /broken relative import/.test(sg.answer), sg.answer.split('\n')[0]);
    ok('demo catch · signals shows the import cycle', /import cycle/.test(sg.answer));
    var br = inv('broken');
    ok('demo catch · broken names the wrong path, and only that one', /src\/remove-route\.js` line 3/.test(br.answer) && /\.\/utils`/.test(br.answer) && /^1 relative import/.test(br.answer), br.answer.split('\n')[0]);
    var cy = inv('cycles');
    ok('demo catch · cycles finds store.js and audit.js', /src\/store\.js/.test(cy.answer) && /src\/audit\.js/.test(cy.answer));
    var dp = inv('dupes');
    ok('demo catch · dupes finds json() rewritten in remove-route.js', /`json`/.test(dp.answer) && /src\/util\.js/.test(dp.answer) && /src\/remove-route\.js/.test(dp.answer), dp.answer.split('\n')[0]);
    var im = inv('what breaks if I change store.js');
    ok('demo catch · impact on store.js reaches the new route', /src\/remove-route\.js/.test(im.answer) && /src\/audit\.js/.test(im.answer));
  } finally {
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty;
    invalidateAll();
  }
}
export { demoLinkCases, demoCatchCases };
