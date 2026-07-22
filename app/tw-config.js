/* Tailwind Play CDN configuration — DESIGN-DNA v1.2 tokens, utilities only.
   Loaded as a same-origin file (not inline) so script-src stays free of
   'unsafe-inline'. Preflight is disabled: Tailwind must never reset the
   workbench's own base styles — app/app.css is the source of truth for all
   load-bearing design; Tailwind supplies spacing/flex/visibility utilities.
   Colors map to the CSS custom properties so ceremony/daylight mode switching
   keeps working through any utility class. */
/* If the CDN is blocked or offline the workbench must keep working on
   app/app.css alone — never throw over a missing utility layer. */
if (typeof tailwind !== 'undefined') tailwind.config = {
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        /* Signal Orange — #FF4F00 light / #FF5C0A ceremony, via the mode-aware token */
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        err: 'var(--err)',
        ok: 'var(--ok)'
      },
      borderRadius: { engine: '3px', 'engine-lg': '4px' },
      transitionTimingFunction: {
        'out-engine': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'inout-engine': 'cubic-bezier(0.65, 0, 0.35, 1)',
        snap: 'cubic-bezier(0.3, 0, 0, 1)'
      },
      transitionDuration: { feedback: '120ms', state: '200ms', entrance: '400ms', ceremony: '600ms' },
      fontFamily: {
        grotesk: ['"Helvetica Neue"', '"Segoe UI"', '-apple-system', 'Arial', 'sans-serif'],
        mono: ['"Cascadia Code"', '"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace']
      }
    }
  }
};
