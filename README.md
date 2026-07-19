# LUCID ENGINE

**Drew's personal design DNA — and MERIDIAN, the demonstration built to prove it.**

> Lucid Engine is the combination of **hospitable clarity**, **visible engineering**, and **cinematic depth**.
> *"The front door is a museum. The basement is a laboratory."*

## Live

| Page | URL |
|------|-----|
| **MERIDIAN** — demo landing page | https://drewosi.github.io/lucid-engine/ |
| **Design DNA** — the system itself | https://drewosi.github.io/lucid-engine/dna.html |

## What's in here

- **[index.html](index.html)** — MERIDIAN, a fictional AI instrument's launch page, built as a single dependency-free file. Live Canvas particle field (Fibonacci-lattice sphere with an orange meridian ring, projected by hand), command palette (`Ctrl-K`), interactive trace console, counter-rolled stats fed by the page's own machinery, FAQ accordion, toast queue, wayfinder, ceremony/daylight modes, and a debug panel (`d`) that operates the hero in real time. No frameworks, no build step, no external requests — except the waitlist form, which posts to Formspree once configured (see below).
- **[dna.html](dna.html)** — the Lucid Engine design system as a browsable page.
- **[DESIGN-DNA.md](DESIGN-DNA.md)** — the full system spec (v1.2): identity, ranked personality attributes, visual language, a named Motion Library, UX pattern library, UI component specs, design tensions, hard bans, reference library, decision rubric, and a paste-ready instruction block for AI design tools (§10).

## Make the waitlist real

The MERIDIAN page is a demand-validation funnel: it exists to answer *"should this product get built?"* Out of the box the waitlist form falls back to localStorage (entries never leave the visitor's browser, and the page says so). Two steps make it live:

1. **Email capture (required).** Create a free form at [formspree.io](https://formspree.io), copy the id from its endpoint (`formspree.io/f/<id>`), and paste it into the `FORMSPREE_ID` constant in `index.html` (search for `YOUR_FORM_ID`). Submissions — email plus optional tier interest — then land in your Formspree inbox with email notifications. The page's copy switches to disclose the transmission automatically.
2. **Analytics (optional).** Create a free site at [goatcounter.com](https://www.goatcounter.com) (privacy-friendly, no cookies, no consent banner needed), then uncomment the snippet at the bottom of `index.html` and replace `YOURCODE`. Now you can see visitors → signups conversion, not just signups.

**What to watch:** weekly signups, and the tier-interest split (Observer $0 / Operator $29 / Laboratory $120). Steady signups with real Operator/Laboratory interest is the go signal for building Meridian. Silence is an answer too — and it will have cost nothing but this page.

Nice-to-have later: an `og:image` (the head already carries Open Graph/Twitter tags, text-only for now).

## The three laws

1. **Clarity is the price of admission.** Mystery lives in the experience, never in the architecture.
2. **Every element must demonstrate thought.** Decoration that merely signals "designed" gets cut.
3. **Depth is a reward, not a requirement.** Casual users never pay for what explorers earn.

## Depth ladder (try it on the live page)

- **L1** — just read the page.
- **L2** — `Ctrl-K` palette · `t` mode · `g` grid · `d` field debug · `1–5` jump · `?` keymap.
- **L3** — open the browser console.

---

MERIDIAN is a fictional product; the page says so wherever it simulates anything (the honest-demo rule). The design system, the machinery, and the code are real.
