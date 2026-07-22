/* ============ SHARED STATE ============
   The one mutable store shared across modules. Values are (re)assigned by their
   owning modules during init in the same order the old single-file script did;
   the defaults here only cover reads that could happen before that.
   A store object (rather than exported bindings) is deliberate: importers must
   be able to reassign wholesale — the self-tests swap files/projectIndex out
   and restore them, which read-only ESM import bindings cannot express. */
export var st = {
  /* context engine */
  files: new Map(),        /* path -> {content, lines, tokens, mtime, base, checked} */
  skipped: { dirs: 0, binary: 0, big: 0, over: 0, user: 0 },
  skippedFiles: [],        /* {path, reason, size, ref} */
  demoMode: false,
  /* provider + model */
  curProvider: null,
  model: null,
  /* context mode */
  ctxMode: 'full',
  groundMode: true,
  /* project memory */
  lastDirHandle: null,
  pendingProject: null,
  /* chat */
  history: [],
  transcript: [],
  streaming: false,
  aborter: null,
  spent: { in: 0, out: 0, cacheW: 0, cacheR: 0 },
  /* lazy caches + dirty flags — prime via getIndex()/buildProjectMap()/assembleContext(),
     invalidate via the helpers below, never by writing the flags directly */
  contextDirty: true, contextCache: '',
  mapDirty: true, mapCache: '',
  indexDirty: true, projectIndex: null,
};

/* selection changed (check/uncheck): context + map are stale, the index is
   selection-decoupled and survives */
export function invalidateSelection() { st.contextDirty = true; st.mapDirty = true; }

/* content changed (files added/removed/reloaded): everything is stale */
export function invalidateAll() { invalidateSelection(); st.indexDirty = true; }
