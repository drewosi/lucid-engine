# DREW'S PERSONAL DESIGN DNA SYSTEM
**Version:** 1.2 · July 2026
**Codename:** LUCID ENGINE

---

## 1. DESIGN IDENTITY

### Name: **LUCID ENGINE**

> **Lucid Engine is the combination of hospitable clarity, visible engineering, and cinematic depth.**

A Lucid Engine design is a bright, calm, immediately legible surface built on top of machinery so precise and so alive that discovering it produces awe. The surface welcomes everyone. The depth rewards obsession. The two layers are never in conflict — the surface is the *proof* that the machinery works.

The governing metaphor, in Drew's own words:

> **"The front door is a museum. The basement is a laboratory."**

Three laws derived from it:

1. **Clarity is the price of admission.** Nothing ships that a first-time user can't navigate. Mystery lives in the experience, never in the architecture.
2. **Every element must demonstrate thought.** If a detail doesn't show evidence of engineering or authorship, it's decoration — cut it. Awe comes from "how was a person capable of this?", never from expensive-looking surfaces.
3. **Depth is a reward, not a requirement.** The system reveals more the deeper someone goes: hidden interactions, technical details, the machinery itself. Casual users never pay for what explorers earn.

---

## 2. PERSONALITY ATTRIBUTES (ranked)

| # | Attribute | What it means in practice |
|---|-----------|---------------------------|
| 1 | **Engineered** | Precision is the aesthetic. Visible mechanism > applied ornament. Leica, not Rolex. |
| 2 | **Welcoming** | Immediately comfortable to enter. Intelligence reveals itself over time; it never gatekeeps. |
| 3 | **Layered** | Simple enough for everyone, deep enough to reward obsession. Progressive depth is the identity. |
| 4 | **Authored** | Every detail placed by a single deciding hand. Wes Anderson-grade compositional intent. No accidents. |
| 5 | **Alive** | The interface responds like matter responding to intelligence. Nothing is inert. |
| 6 | **Precise** | Hairline alignment, tabular numbers, exact easing. Sloppiness anywhere breaks trust everywhere. |
| 7 | **Cinematic** | Light, atmosphere, and pacing borrowed from film — Blade Runner 2049 scale, Nolan physicality. |
| 8 | **Substantive** | Dense with real information, beautifully organized. Substance over empty minimalism. |
| 9 | **Confident** | Knows exactly what it is; never proves it desperately. Quiet confidence, not announcement. |
| 10 | **Human** | Beyond-human intelligence, human empathy. The system is impossibly precise; the experience is considerate. |

**Priority rule:** when attributes conflict, the higher-ranked one wins. (E.g., a gorgeous cinematic moment that hurts welcome/clarity gets cut or moved deeper into the experience.)

---

## 3. EMOTIONAL GOAL

The exact sequence a person should feel:

**Awe → Curiosity → Trust → Desire → Excitement**

1. *"Wow."* (first 2 seconds — before reading a single word)
2. *"What is this?"* (leans in)
3. *"I understand this. I trust it."* (orientation is instant: where am I, what can I do, where do I go)
4. *"I want to use this."*
5. *"I want to see what else it can do."* (and it keeps answering, deeper and deeper)

The sentence they say to a friend afterward:

> **"You have to see this. It feels like something I've never seen before."**

The specific flavor of novelty: **obvious in hindsight**. Not random weirdness — the feeling of an inevitable invention. And the specific flavor of awe: **virtuosity** — awe at demonstrated human skill, not at scale, budget, or drama.

---

## 4. VISUAL LANGUAGE

### Color philosophy
**A restrained monochrome foundation with one violent, intentional accent.** Color is information, never decoration. If a color doesn't mean something (state, action, identity), it doesn't appear.

- **Foundation (≈90% of every surface):** warm paper-white and a disciplined gray ramp in light mode; deep near-black in ceremony mode. Never pure `#FFFFFF` or pure `#000000` — both feel unauthored.
  - Light: background `#FAFAF7`, surface `#FFFFFF` at 1 elevation only, ink `#111110`, gray ramp with a slight warm cast.
  - Dark (ceremony): background `#0A0B0D`, surfaces lifted by light, not by gray boxes.
- **Accent (≈2–5% of any view):** **Signal Orange** — the international-orange / McLaren-papaya family. Token: `--accent: #FF4F00` (light mode) / `#FF5C0A` (dark mode, slightly lifted for luminosity). Permitted range `#FF4400`–`#FF7A00`; never pastel, never gradient-filled. This is the color of test flights, prototypes, and instrument markings — engineering heritage, not fashion. Deployed like a signal flare: actions, live states, the single most important thing on screen. Its rarity is what makes it violent.
- **The mode rule — purpose decides the door:** products, tools, and dashboards default **light** (the workday world). World-sites, launches, and cinematic marketing moments default **dark** (the ceremony world). Both modes are always built and always user-switchable; context chooses which one greets you. Darkness is a purpose, never a lazy default.
- **Secondary/neutrals:** functional grays only. Semantic colors (success/warn/error) exist but stay desaturated relative to the accent — the accent must always be the loudest thing.

### Contrast strategy
High contrast for content and controls (WCAG AA minimum, AAA for body text). Atmosphere is created with *light and depth*, never by lowering text contrast. Low-contrast text is the costume of fake sophistication — banned.

### Typography personality
The voice of an intelligent instrument: technical, exact, warm in scale rather than in curliness.

**Pairing logic (two voices, occasionally three):**
1. **Primary — a precise grotesque** (class: Neue Haas Grotesk, Söhne, Suisse Int'l, ABC Diatype). Does 90% of the work: UI, headings, body. Set tight, confident, with real typographic care (true quotes, optical sizes, `tnum` for data).
2. **System voice — a monospace** (class: JetBrains Mono, ABC Diatype Mono, Berkeley Mono). This is the machinery speaking: data, coordinates, timestamps, technical annotations, easter-egg layer. Its presence *is* the visible engineering.
3. **Optional ceremony voice** — used only when a project's world demands it (an editorial serif or a custom display face). Never appears in utility surfaces.

Scale: strong hierarchy without giant-empty-word posturing. Big type is allowed when it's *doing* something (orienting, landing a moment), never as a substitute for content.

### Spacing & grid philosophy
- 4px base unit. Density is a feature: **dense, beautifully organized > sparse and empty.** Whitespace is used to *group and pace* information, not to replace it.
- 12-column grid as the civic infrastructure; full-bleed "ceremony breaks" are permitted for cinematic moments — the grid is a system you leave *deliberately and briefly*.
- Alignment is sacred. Optical alignment beats mathematical when they disagree — that's authorship.

### Shape, borders, radius
- Shape language: **machined, not inflated.** Small radii (2–6px) on interactive elements; sharp corners welcome on structural containers. No pill-shaped cards, no rounded-everything softness.
- Borders: hairline (1px) and meaningful — a border marks a real boundary in the system. Prefer borders + light over drop shadows.

### Shadows & lighting
- Shadows are physics, not decoration: shallow, tight, only where elevation is real. Most depth comes from **light behaving cinematically** — golden-hour warmth in human moments, overcast Scandinavian calm as the resting state, neon only after dark and only when the environment has earned it.
- In dark/ceremony mode, light is the primary material: glows are emitted by things that are genuinely *on*, never applied as ambience.

### Texture & materials
- Subtle grain/noise is allowed (film, not grunge) to keep engineered surfaces from feeling sterile — the "raw with soul" note under the produced-to-perfection track.
- Materials read as real: glass that refracts, metal that reflects, particles that obey (or deliberately defy) physics. No faux-3D bevels, no glassmorphism-as-wallpaper.

### Imagery
Cinematic photography with authored light (golden hour, overcast gray, earned neon). No stock photography, no corporate lifestyle shots, no AI-generated filler imagery. If imagery can't be authored, use the system's own machinery (generative/procedural visuals) instead.

### Iconography & illustration
- Icons: geometric, hairline-consistent, drawn on the same grid — instrument markings, not stickers.
- Illustration: essentially banned in the Memphis/corporate sense. When representation is needed, prefer diagrams, cutaways, exploded views — *engineering drawings as art.*

### 3D & generative systems
3D is the crown jewel, spent like one. It must be **procedural, physical, or interactive** — a system on display, never a rendered decoration. The engineering behind it should be discoverable (an annotated corner, a debug view, a "how this works" layer). The system itself is part of the art.

**The product ceremony budget:** in actual products (dashboards, SaaS, tools), ceremony lives **in the seams** — loading, empty states, onboarding, and major transitions. Working screens stay instrument-calm; no particle rendering competes with someone's task. World-sites and marketing pages carry the full spectacle.

### Gradients
Only as *light* — the falloff of a source, an atmosphere, a horizon. Never as decoration floating in space. Gradient blobs are permanently banned.

---

## 5. INTERACTION LANGUAGE

**Motion philosophy:** *Motion should feel like matter responding to intelligence.*
Dominant register: **supernatural** — particles, dissolves, materialization, morphing, trails — but always *responsive*: triggered by, and proportional to, what the user did. Motion is never a show playing at the user.

- **Hover:** everything interactive acknowledges the user within ~100–150ms — a material response (lift of light, particle stir, precise underline draw), not a bounce. Hover is where quiet confidence lives.
- **Scroll:** native scroll physics are never hijacked. Scroll may *drive* reveals, particle assembly, and camera moves, but position and speed always belong to the user.
- **Page transitions:** utility navigation is instant (<200ms). Ceremony transitions may dissolve content into particles that re-form as the destination — the signature move — but never exceed ~600ms and never twice in a row.
- **Microinteractions:** the #1 premium signal. Toggles, inputs, confirmations each get one precisely engineered response. Easing is custom (no default ease-in-out); durations 120–240ms in-product.
- **Loading states:** never spinners. Loading is a chance to show the machinery: skeleton structures assembling, data streaming in as it arrives, a progress readout in the system's mono voice.
- **Reveals:** content materializes with intent — masked draws, particle assembly, staggered precision (20–40ms stagger). Everything arrives *placed*, nothing "floats up."
- **Parallax:** depth-of-scene only (cinematic camera), never gratuitous layer-drift.
- **Cursor:** default cursor in products. Custom cursors only inside authored world-sites, and only when the cursor *is* an instrument (a probe, a light source) — never a decorative blob follower.
- **Sound:** off by default; earned in world-sites as tactile feedback (mechanical, quiet, Nothing-like). Never ambient music autoplay.
- **Moments of surprise — the Depth Ladder.** Every significant project ships three levels:
  - *Level 1 (everyone):* flawless clarity, beautiful responses.
  - *Level 2 (the curious):* hidden hover details, keyboard shortcuts, annotations in the mono system voice, data revealed on inspection.
  - *Level 3 (the obsessed):* easter eggs, a debug/machinery view, console messages, an interaction that shows how the thing was built.
- **How much is too much:** one hero motion per view. If two things demand attention simultaneously, one of them is wrong. All motion respects `prefers-reduced-motion` with a fully functional static experience — a Lucid Engine design is never *dependent* on motion.

---

## 6. DESIGN TENSIONS (the signature)

These contrasts are not compromises — they are the identity. Each one is a rule with a direction.

1. **Warmth + Virtuosity** — the trade nobody makes. Hospitable on arrival, virtuosic underneath. *Rule: welcome first, awe seconds later. Never intimidate at the door.*
2. **Density + Calm** — Cyberpunk's information, Overwatch's readability. *Rule: any screen may hold a lot, but must answer "where am I / what can I do / where next?" in under 3 seconds.*
3. **Supernatural motion + Physical response** — particles and dissolves that still obey the user's hand. *Rule: impossible behavior, believable causality.*
4. **Light world + Dark ceremony** — a calm bright default that becomes technologically expressive after dark. *Rule: purpose decides the door — tools open light, spectacles open dark, both modes always exist. Darkness is never the lazy default.*
5. **Beyond-human system + Human empathy** — impossibly precise machinery, considerate experience. *Rule: the system may feel more advanced than a human could build; the experience must feel like a human anticipated you.*
6. **Mystery + Clarity** — "mystery in the experience, clarity in the architecture." *Rule: users may wonder how it works; they must never wonder how to use it.*

---

## 7. WHAT TO AVOID (hard bans)

**Colors & atmosphere**
- Dark-mode-with-purple-glow "AI aesthetic" — the mass-produced costume of the identity Drew earns authentically
- Gradient blobs; decorative gradients of any kind
- Gold/luxury-status coding; anything whose message is "this is expensive"
- Low-contrast gray-on-gray text posing as sophistication

**Layout & UI patterns**
- Bento grids used as a trend rather than demanded by content
- Oceans of rounded cards; pill-shaped everything
- Empty minimalism: one enormous word + whitespace posing as design
- Unclear navigation, unrecognized paths, experiences with no obvious direction
- Spectacle that costs usability (the Amazon inversion: functional but careless is equally banned)

**Typography**
- High-fashion luxury serifs as a primary voice; novelty display fonts doing a system font's job
- Default system-stack sameness with no typographic decisions visible

**Imagery & illustration**
- Corporate Memphis illustrations
- Stock photography; AI-generated sameness of any kind — anything a viewer could clock as "generated, not authored"

**Motion**
- Scroll-hijacking; autoplaying ambience; decorative cursor followers
- Bouncy/cute easing on serious surfaces; motion that plays *at* the user
- Any animation that runs when nothing happened

**Branding & tone**
- Fake friendliness; exclamation-point copywriting
- Prestige signaling (Porsche/LV/Gucci register)
- Any visual shortcut that signals "modern design" without a point of view

**The meta-ban:** *Don't decorate the interface to make it look designed. Design the system so beautifully that the design is inseparable from its function.*

---

## 8. AWWWARDS REFERENCE LIBRARY

### Category A — Engineering as Spectacle
**References:** [Igloo Inc](https://www.awwwards.com/sites/igloo-inc) (SOTY 2024, by Abeto — procedural crystal growth, shader-rendered UI), [Lusion.co](https://lusion.co), Lusion client work.
- **Study:** how the technology itself is the aesthetic; procedural systems built to scale; real-time iteration culture.
- **Borrow:** particle/volume systems as identity; the "how the hell did they build this" reaction; custom tooling pride.
- **Don't copy:** all-WebGL UI (accessibility and usability cost), dark-void-as-default.
- **Principle extracted:** *the machinery can be the beauty — if it's real machinery.*

### Category B — Cinematic Personal Worlds
**References:** [Lando Norris](https://www.awwwards.com/sites/lando-norris) (SOTY 2025, by OFF+BRAND — WebGL + Rive hybrid).
- **Study:** how conventional navigation coexists with immersive hero moments; hybrid stacks (spectacle where it counts, HTML where it doesn't).
- **Borrow:** the structure — legible spine, cinematic organs; a single loud accent doing brand-scale work.
- **Don't copy:** celebrity-brand loudness; sports-energy pacing.
- **Principle extracted:** *immersion and orientation are not enemies when the spine stays conventional.*

### Category C — Committed Playfulness
**References:** [Don't Board Me](https://www.awwwards.com/sites/dont-board-me) (two-color palette, bounce-the-ball entry gate).
- **Study:** total commitment to one idea; interaction as a front door; a 2-color system carrying an entire brand.
- **Borrow:** the earned entry (a tiny interaction that makes users complicit before content starts); commitment over hedging.
- **Don't copy:** the cartoon register, the toy tone.
- **Principle extracted:** *commitment is the style. Half-measures read as generic.*

### Category D — Instrument Interfaces
**References:** Nothing OS, Teenage Engineering products/site, Leica product pages, Pip-Boy / in-world device UIs.
- **Study:** hardware honesty; dot-matrix/mono voices; controls that feel like physical mechanisms.
- **Borrow:** the mono "system voice"; interfaces that feel like real devices existing in a world; transparency about the machine.
- **Don't copy:** retro-gadget nostalgia as a costume; lo-fi for its own sake.
- **Principle extracted:** *an interface can be an object with a physics of its own.*

### Category E — Dense Information, Calm Surface
**References:** Cyberpunk 2077 UI (density + identity), Overwatch (instant readability), Linear (product craft), high-craft data tools and terminal aesthetics reinterpreted.
- **Study:** information hierarchy under pressure; how density becomes atmosphere instead of noise.
- **Borrow:** tabular precision, mono data voices, color-as-state; the feeling that there's a lot beneath the surface, intelligently organized.
- **Don't copy:** sci-fi HUD clutter; decoration disguised as data (fake graphs, meaningless readouts — the machinery must be real).
- **Principle extracted:** *density is premium when organization is visible.*

---

## 9. DESIGN DECISION FRAMEWORK

### The question: **"Does this feel like me?"**

Score any design (a screen, a component, a whole product) 0–2 on each:

| # | Test | 0 | 2 |
|---|------|---|---|
| 1 | **The 3-Second Test** — does a first-timer instantly know where they are and what to do? | lost | instant |
| 2 | **The Virtuosity Test** — is there at least one moment that makes a builder ask *"how did they do that?"* | none | yes, and it's real |
| 3 | **The Decoration Audit** — does every visual element demonstrate thought or carry information? | ornamental filler | everything earns its place |
| 4 | **The Depth Ladder** — is there something for the curious that casual users never pay for? | one flat layer | 3 working levels |
| 5 | **The Response Test** — does every interaction respond beautifully within 150ms? | inert / laggy | matter responding to intelligence |
| 6 | **The Costume Check** — would any part be mistaken for a trend template (purple-glow AI, bento, blob, Memphis)? | yes | unmistakably authored |
| 7 | **The Warmth Check** — would a non-technical person feel welcome, not intimidated? | intimidating/cold | welcoming |
| 8 | **The Hindsight Test** — is the novel part "obvious in hindsight" rather than weird for its own sake? | random weirdness | inevitable invention |

**Scoring:** 14–16 = ship it. 11–13 = fix the lowest scores; usually the Decoration Audit or Depth Ladder. ≤10 = it isn't Lucid Engine; restart from the system, not the surface.
**Veto rule:** a 0 on Test 1 (clarity) or Test 6 (costume) fails the design regardless of total.

---

## 10. CLAUDE DESIGN SYSTEM INSTRUCTIONS (paste-ready)

```
YOU ARE DESIGNING FOR DREW — DESIGN DNA: "LUCID ENGINE"

Drew's design DNA is a two-layer system: a calm, bright, immediately legible
surface over dense, virtuosic, visibly engineered depth. "The front door is a
museum. The basement is a laboratory." Apply this to everything you design for
him: websites, dashboards, apps, SaaS, AI interfaces, marketing pages, internal
tools, brand systems.

CORE LAWS
1. Clarity is the price of admission. First-time users must know where they
   are, what they can do, and where to go within 3 seconds. Mystery lives in
   the experience, never in the architecture.
2. Every element must demonstrate thought. No decoration that merely signals
   "designed." Awe must come from craftsmanship ("how did a person build
   this?"), never from expensive-looking surfaces.
3. Progressive depth: Level 1 = flawless clarity for everyone. Level 2 =
   hidden details, shortcuts, mono-voice annotations for the curious.
   Level 3 = easter eggs and visible machinery for the obsessed.

VISUAL SYSTEM
- Color: restrained monochrome foundation (~90%) + Signal Orange accent
  (#FF4F00 light / #FF5C0A dark; range #FF4400–#FF7A00) used at 2–5% like a
  signal flare. Light mode: warm paper-white (#FAFAF7-class), near-black
  ink, warm gray ramp. Dark "ceremony mode" (#0A0B0D-class) where light is
  the material. MODE RULE: products/tools/dashboards open light;
  world-sites/launches/cinematic marketing open dark; both modes always
  built and switchable. Never pure #FFF/#000. Never purple-glow AI
  aesthetics.
- Type: precise grotesque (Neue Haas/Söhne/Suisse class) for 90% of work +
  monospace "system voice" (JetBrains/Berkeley Mono class) for data,
  timestamps, technical annotation. Tabular figures for numbers. High
  contrast always (AA minimum); no gray-on-gray sophistication.
- Density: dense, beautifully organized information > empty minimalism.
  4px base unit, 12-col grid, full-bleed cinematic breaks used briefly.
- Shape: machined, not inflated. 2–6px radii on controls, sharp structural
  corners, hairline 1px borders, minimal true-elevation shadows. No pill
  cards, no rounded-everything.
- Light: cinematic — golden-hour warmth for human moments, overcast calm as
  resting state, neon only in dark mode and only when earned. Gradients only
  as light falloff, never decoration.
- Imagery: authored cinematic photography or the system's own
  procedural/generative output. No stock, no corporate Memphis, no
  AI-generated filler.
- 3D: only procedural, physical, or interactive — a real system on display,
  with its engineering discoverable. Never rendered decoration. In products,
  3D/particle ceremony lives only in the seams (loading, empty states,
  onboarding, major transitions); working screens stay instrument-calm.
  Marketing pages and world-sites carry the full spectacle.

MOTION SYSTEM
"Motion should feel like matter responding to intelligence."
- Register: supernatural (particles, dissolves, materialization, morphs)
  but always triggered by and proportional to user action.
- Hover response within ~100–150ms; product micro-interactions 120–240ms
  with custom easing; ceremony transitions ≤600ms, never consecutive.
- Never hijack scroll. No spinners — loading shows the machinery assembling.
- One hero motion per view. Full prefers-reduced-motion support.
- Default cursor in products; custom cursors only as instruments in
  authored world-sites. Sound off by default.

HARD BANS
Purple-glow AI dark mode; gradient blobs; bento-as-trend; corporate Memphis;
empty one-word minimalism; luxury/prestige coding (gold, fashion serifs);
stock photos; scroll-hijack; decorative cursor followers; fake data or fake
machinery; low-contrast text; anything recognizable as a template or trend.

EMOTIONAL TARGET
Awe → curiosity → trust → desire → excitement. The viewer's sentence must be
"You have to see this — it feels like something I've never seen before,"
and the novelty must feel obvious in hindsight, like an inevitable invention.
Drew should appear to be: someone who sees the future early, builds it
meticulously, and makes it feel obvious once everyone else sees it.

RISK CALIBRATION
7/10 boldness everywhere — distinctive and unconventional for both personal
and client work, calibrated to context but never diluted to a "safe
professional" variant. Commitment over hedging: fully commit to the idea.

MOTION LIBRARY (use only these named patterns; unnamed animation = cut)
Easing: --ease-out-engine cubic-bezier(.16,1,.3,1) arrivals;
--ease-inout-engine cubic-bezier(.65,0,.35,1) state; --ease-snap
cubic-bezier(.3,0,0,1) micro. Durations: feedback 120 / state 200 /
entrance 400 / ceremony 600ms cap. Stagger 20-40ms, max 8 staggered.
Patterns: Particle Dissolve (ceremony nav), Materialize (scroll-once
reveal, mask + <=8px, 400ms), Assembly Stagger, Signal Trace (accent
line-draw 150ms hover/focus), Light Lift (hover via light, <=2px),
Scramble Readout (mono decode 300ms, labels only), Machinery Reveal
(loading — spinners banned), Camera Drift (<=6% parallax), Flare Pulse
(only real live state; the one idle animation), Magnetic Acknowledge
(primary CTA, ceremony only). Transform+opacity only; interruptible;
reduced-motion degrades to instant opacity, experience stays complete.

UX PATTERNS
Legible spine: <=5 destinations, location always marked, spine survives
ceremony. Orientation contract answered <3s on every view. Cmd-K palette
in products (every action also visible in UI). Forms: label above field;
validate on blur then per-keystroke; errors in mono voice stating what +
how to fix; submit never disabled. Feedback <150ms; toasts bottom-right,
one at a time, 4s; undo (8s) over confirm dialogs. Empty states =
ceremony seams with one next action. Onboarding = one guided real action,
no tour modals. Focus: 2px accent outline. Touch targets >=44px.

COMPONENTS (key specs)
Buttons 36/44px h, r3: Signal (accent bg, one per view), Hairline
(1px border -> accent on hover), Ghost (Signal Trace). Inputs 40px,
mono uppercase label above, focus = accent border no glow. Cards r3,
hairline, Light Lift only if interactive. Tables 40px rows, mono
11.5px headers, tabular-nums, sticky header. Modals <=560px, backdrop
60% ceremony no blur, Esc closes. Tabs = sliding 2px underline, no
pills. Chips 20px mono uppercase; Flare Pulse if live. Tooltips
inverted mono 12px with shortcut hints. Toggles 36x20 (circular thumb
sanctioned — mechanical switch exception). Progress = 2px accent bar +
mono readout, never spinner.

v1.2 ADDITIONS
Motion: Counter Roll (stats 0->value, 600ms, once), Threshold Wipe
(section hairline draws on enter), Constellation Link (hover draws
hairlines to genuinely related nodes), Orbit Focus (siblings recede to
.55 opacity when one expands), Signal Sweep (one scanline per real data
refresh, never idle), Type Feed (12-18ms/char terminal text, skippable).
UX: Cmd-K palette (grouped, fuzzy, kbd hints, toast ack, never the only
path); wayfinder dots desktop-only; HONEST-DEMO RULE — anything simulated
says so in place in mono voice; local-persistence forms state what is
stored and where. Components: palette (560px, 40px rows, accent-edge
selection), accordion (+ rotates to ×, one open, Orbit Focus siblings),
stat tile (Counter Roll), terminal block (always ceremony-dark — a
terminal is an object), timeline row, kbd chip, wayfinder dots.

DECISION CHECK (run before presenting any design)
1. 3-second orientation? 2. One real virtuoso moment? 3. Zero unearned
decoration? 4. Depth ladder present? 5. Everything responds <150ms?
6. Nothing mistakable for a trend template? 7. Non-technical people feel
welcome? 8. Novelty obvious-in-hindsight?
A failure on #1 or #6 fails the design outright.
```

---

## 11. MOTION LIBRARY

Named, reusable patterns. Every animation in a Lucid Engine design must be one of these (or earn a new named entry). Anything unnamed is decoration — cut it.

### Tokens

```css
/* Easing — never default ease/ease-in-out, never bounce/elastic */
--ease-out-engine:   cubic-bezier(0.16, 1, 0.3, 1);   /* arrivals, reveals */
--ease-inout-engine: cubic-bezier(0.65, 0, 0.35, 1);  /* state changes, morphs */
--ease-snap:         cubic-bezier(0.3, 0, 0, 1);      /* micro feedback */

/* Duration scale */
--t-feedback: 120ms;   /* press, toggle, acknowledge */
--t-state:    200ms;   /* tab switch, expand, theme change */
--t-entrance: 400ms;   /* content arrival */
--t-ceremony: 600ms;   /* signature transitions — hard ceiling */
--stagger:    30ms;    /* range 20–40ms */
```

### Patterns

| Pattern | Trigger | Spec | Allowed where |
|---------|---------|------|---------------|
| **Particle Dissolve / Re-form** | Ceremony navigation | Content dissolves to particles, re-forms as destination. ≤600ms, never twice in a row. | World-sites; product seams only |
| **Materialize** | Scroll into view (once) | Mask/clip wipe + ≤8px translate, 400ms `--ease-out-engine`, IntersectionObserver at 0.2 threshold. Never re-runs on re-scroll. | Everywhere |
| **Assembly Stagger** | Group arrival | Children 20–40ms apart, max 8 staggered — the rest arrive as one batch. Everything lands *placed*. | Everywhere |
| **Signal Trace** | Hover / focus / active | Accent line draws left→right, 150ms. Links, tabs, active nav. | Everywhere |
| **Light Lift** | Hover on interactive surface | Background lifts toward surface tone + border brightens, 120ms. Translate ≤2px, no shadow growth. | Everywhere |
| **Scramble Readout** | First reveal of a data label | Mono text decodes over ~300ms, once per element. Data/labels only — never body copy. | L2 flavor; ceremony + product data surfaces |
| **Machinery Reveal** | Loading | Structure assembles: skeleton lines draw, real data streams in as it arrives, mono progress readout. Replaces every spinner. | Everywhere — spinners are banned |
| **Camera Drift** | Scroll (native) | Depth-of-scene parallax, ≤6% translate differential, transform-only. | Ceremony surfaces |
| **Flare Pulse** | Genuinely live state | Accent dot opacity 0.4→1.0, 1.6s loop. The only permitted idle animation; one per view; only for things that are actually live. | Everywhere |
| **Magnetic Acknowledge** | Pointer within ~24px of primary CTA | CTA translates ≤3px toward pointer, `--ease-snap`. One CTA per view. | Ceremony surfaces only |
| **Counter Roll** | First reveal of a stat | Number rolls 0 → value, 600ms `--ease-out-engine`, `tabular-nums` so layout never shifts. Once per element. | Stat tiles, data surfaces |
| **Threshold Wipe** | Section enters viewport | The section's boundary hairline draws across, 400ms. Once; marks a real structural boundary. | Everywhere |
| **Constellation Link** | Hover/focus on a node | Hairlines draw from the node to its related nodes, 150ms. Relations must be real. | Data/trace surfaces only |
| **Orbit Focus** | One item in a set focused/expanded | Siblings recede to opacity 0.55 (scale never below 0.98), 200ms. Restores instantly on blur. | Everywhere |
| **Signal Sweep** | Data surface refreshes | A 1px accent scanline sweeps the surface exactly once. Never idles, never loops. | Data surfaces |
| **Type Feed** | Demo/answer text begins | Terminal-style character feed, 12–18ms/char, skippable by click/keypress. | Demo & terminal surfaces only |

### Global dosage rules
- One hero motion per view. Transform + opacity only — never animate layout.
- Every animation is interruptible; user input always wins mid-animation.
- `prefers-reduced-motion`: every pattern degrades to instant opacity; the experience must remain complete.

---

## 12. UX PATTERN LIBRARY

### Navigation & orientation
- **The legible spine:** persistent wordmark-as-home, ≤5 top-level destinations, current location always visibly marked (Signal Trace or accent dot). The spine never dissolves, even mid-ceremony.
- **The orientation contract:** every view answers *where am I / what can I do / where next* within 3 seconds — page titles, active states, and a marked path are mandatory, not optional.
- **Command palette (products):** Ctrl/Cmd-K opens fuzzy command search — the L2 power path. Every palette action also exists as a visible L1 control.
- Breadcrumbs appear at depth ≥3. The footer is a sitemap, never a link dump.

### Forms
- Label above field, always. Placeholder text is example content, never the label.
- Validate on blur; after a field's first error, re-validate on every keystroke.
- Errors speak in the mono system voice and always say *what's wrong + how to fix it*: `EMAIL — missing @. format: name@domain.com`. No apologies, no vagueness.
- Submit buttons are never disabled — clicking surfaces the errors and focuses the first one.
- Success = Materialize a confirmation stating exactly what happened and what happens next.

### Feedback & state
- Every action acknowledged within 150ms — visually, before any network round-trip resolves.
- Toasts: bottom-right, one visible at a time (queue the rest), 4s auto-dismiss paused on hover, hairline border with a 2px accent left edge (semantic color for status toasts).
- Prefer **undo (8s window)** over confirmation dialogs. Reserve typed-confirmation for the truly irreversible.
- Buttons state what happens ("Publish"), then confirm it happened ("Published").

### Empty, loading, error
- **Empty states are ceremony seams:** a small particle/machinery moment + one clear next action. Never a blank void, never a sad illustration.
- **Loading is Machinery Reveal:** show real progress when knowable; stream content in as it arrives; skeleton structure assembles in place.
- **System errors:** plain-language what-happened + how-to-fix, with technical detail collapsed in the mono voice for L2/L3 readers.

### Depth & disclosure
- Default view serves the 80% case. Advanced controls live behind mono-labeled expanders (the "machinery" affordance), not buried in settings.
- Onboarding = one guided first action in the real interface. No tour modals, no coach-mark confetti.
- Shortcut policy: Ctrl/Cmd-K palette, `?` reveals the shortcut map, single-letter shortcuts only when no text input has focus. Shortcuts surface contextually in hover tooltips (L2).

### Command palette (full spec)
- Ctrl/Cmd-K opens; also reachable from a visible nav control. Fuzzy match on action names and synonyms.
- Actions grouped (Navigate / Mode / Machinery / External), each row carrying its kbd hint. Arrow keys + Enter; Esc closes; typing filters instantly.
- Executing an action fires a toast acknowledgment. Every palette action must also exist as a visible L1 control — the palette is a shortcut, never the only path.

### Wayfinder
- Desktop only: a fixed right-edge column of section dots; current section marked with the accent; labels appear on hover in the mono voice. Clicking navigates. Hidden below 1000px — the nav carries orientation alone on small screens.

### The honest-demo rule
- Anything simulated must say so, in place, in the mono voice (`// simulated core — real traces ship with the beta`). Fake-but-labeled machinery is theater; fake-and-unlabeled machinery is fraud. Lucid Engine designs never gamble their trust sequence on a viewer not noticing.

### Local persistence forms
- When a form stores data locally (waitlist demos, preferences), the interface states exactly what is stored and where (`// stored in this browser only — localStorage`). Clearing is one visible action away.

### Accessibility floor (non-negotiable)
- AA contrast everywhere, AAA body text. Visible focus: 2px accent outline, 2px offset, on everything interactive.
- Complete keyboard paths through every flow. Touch targets ≥44px. Reduced-motion experience is complete, not a stub.

---

## 13. UI COMPONENT SPECS

All values in both modes unless noted. Radii 2–6px per shape language; hairline = 1px `--line`.

**Buttons** — heights 36px (default) / 44px (hero); radius 3px; padding 0 16–20px.
- *Signal (primary):* accent bg, accent-ink text. Hover: brightness 1.08. Press: scale 0.985 @ `--t-feedback`. Max one per view.
- *Hairline (secondary):* transparent bg, 1px `--line-strong` border. Hover: border → accent + Light Lift.
- *Ghost:* text only + Signal Trace underline on hover.
- All: `focus-visible` 2px accent outline / 2px offset; disabled = 40% opacity, never hidden.

**Inputs & selects** — 40px height, 1px `--line-strong` border, radius 3px, surface bg. Label: 12px mono uppercase, 6px above. Focus: border → accent (no glow). Error: desaturated semantic red border + mono error line below (12.5px).

**Cards** — surface bg, hairline border, radius 3px, padding 20–24px. Interactive cards get Light Lift; static cards get nothing. Optional mono corner annotation as L2. Never shadow stacks.

**Data tables** — 40px rows, hairline row dividers, header in 11.5px mono uppercase letterspaced, `tabular-nums` throughout, sticky header, hover row = surface tint, sort marker = small accent triangle.

**Modals** — max-width 560px, radius 4px, hairline border, backdrop = ceremony color at 60% (no blur). Enter: Materialize 200ms; exit: instant. Focus-trapped; Esc always closes.

**Toasts** — 320px, bottom-right, hairline border + 2px left edge (accent = info, semantic = status), body in grotesque + mono timestamp.

**Tabs** — text labels + 2px Signal Trace underline; underline slides between tabs 200ms `--ease-inout-engine`. No pill segments.

**Nav bar** — 64px (ceremony) / 56px (product), solid ground color, hairline bottom border, active anchor marked with accent.

**Status chips** — 20px height, 11px mono uppercase, hairline border, radius 3px. Live chips get Flare Pulse. Semantic colors desaturated; accent reserved for *the* one thing.

**Tooltips** — inverted (ink bg / paper text), 12px mono, radius 3px, 400ms show delay (instant for siblings once one is open). Carry shortcut hints.

**Toggles** — 36×20px track, 16px thumb, 200ms `--ease-snap`. On = accent track. *(Circular thumb permitted — a toggle is a mechanical switch, the one sanctioned exception to the pill ban.)*

**Progress** — 2px linear accent bar on `--line` track + mono percentage readout. Indeterminate states use Machinery Reveal, never a spinner.

**Command palette** — 560px max, centered at 20vh, hairline border, radius 4px, backdrop 60% ceremony. Input 48px with mono placeholder; rows 40px with group label (11px mono uppercase), action name (14px), kbd chip right-aligned. Selected row = surface-2 bg + 2px accent left edge.

**Accordion** — hairline dividers between items, 56px collapsed row, question in 15px grotesque, mono index left (`Q.01`). Chevron is a mono `+` that rotates 45° to `×`, 200ms `--ease-snap`. Height animates 200ms; one item open at a time; open item gets Orbit Focus on siblings.

**Stat / metric tile** — mono label (11px uppercase) above, Counter Roll value (clamp 32–44px, 700, `tabular-nums`), hairline top border, optional mono unit suffix in `--ink-3`.

**Terminal block** — always ceremony-dark bg regardless of mode (a terminal is an object, not a surface), mono 12.5px, 1.6 line-height, radius 4px, hairline border. Answer text arrives by Type Feed with a 1ch block cursor. Header row: instrument name + status chip.

**Timeline / changelog row** — mono date column (fixed width, `tabular-nums`), hairline left rule with node dot, title 14.5px, body 13.5px `--ink-2`. Latest entry's dot gets Flare Pulse only if genuinely current.

**Kbd chip** — mono 11px, 1px `--line-strong` border, radius 3px, 2px 7px padding, baseline-aligned. Used in tooltips, palette rows, and shortcut maps.

**Wayfinder dots** — 6px dots, `--line-strong`; active = accent + 2px scale-safe ring. Hover reveals mono label chip to the left, 150ms.

---

*Version 1.2. Turn 4 decisions locked: mode rule = purpose decides the door; accent = Signal Orange (#FF4F00); type = grotesque + mono, pure instrument; in-product ceremony = small moments in the seams; sound = off by default, earned only in world-sites. v1.1 added §11 Motion Library, §12 UX Pattern Library, §13 UI Component Specs. v1.2 adds 6 motion patterns (Counter Roll, Threshold Wipe, Constellation Link, Orbit Focus, Signal Sweep, Type Feed), the command palette + wayfinder + honest-demo UX rules, and 7 component specs. Reference implementation: the MERIDIAN landing page in this repo.*
