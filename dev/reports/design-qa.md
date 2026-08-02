# Design-system QA sweep against DESIGN.md

**Date:** 2026-08-02
**Branch:** `claude/handoff-2026-08-02-continue-93175c`
**Queue item:** 7 in `dev/plans/2026-08-01-next-queue.md`
**Method:** a source-wide sweep of every `.tsx` under `src/` for token drift, then a browser pass on
the surfaces the sweep implicated — local `wrangler dev` on the OpenNext build, 375×812 and 1280×800.
Every contrast claim below comes from painted values read in the browser and re-derived with the
repo's own `src/test/contrast.ts`, not from a remembered figure.

More than twenty PRs touched UI on 2026-08-01, each reviewed in isolation. This is the first look at
the result as a whole.

---

## The parts that did not drift

Worth stating, because the sweep expected drift here and did not find it.

| Dimension | Result |
|---|---|
| **Border radius** | 16 `rounded-control`, 15 `rounded-panel`, 13 `rounded-pill`, 4 `rounded-tag`. **Zero** raw or arbitrary radii. DESIGN.md's "NOT uniform" rule holds by construction. |
| **Type scale** | `text-xs/sm/base/xl` plus `text-[1.75rem]` (28), `text-[2.5rem]` (40), `text-[3.5rem]` (56) — every one on the documented 12/14/16/20/28/40/56 ramp. No `text-lg` (18px is not on the scale) and no `text-2xl`/`3xl` anywhere. |
| **Spacing** | 328 uses of the named scale. Off-scale numerics: **five**, all benign — `mt-0` x2 and `pt-0` (resets), one `mt-2` positioning an `aria-hidden` 1px rule in the taste map, and `-space-x-2` on the avatar stack. All are on the 4px grid. (First written as three; the sweep's regex missed the negative utility.) |
| **Touch targets** | ~~No misses.~~ **This was wrong — see the correction below.** |
| **Anti-patterns** | No purple/violet gradients, no icon-in-circle feature grids, no decorative blobs, no system fonts. The only gradients are the landing starfield (documented decoration) and the taste map's meeting rule, which is semantic and carries a comment saying so. |
| **Focus** | One global `:focus-visible` rule in `globals.css`. No per-component divergence. |
| **Disabled treatment** | Centralised in `control-classes.ts`, inherited everywhere, pinned by `control-contrast.test.tsx`. One exception, below. |

The centralisation work of 2026-08-01 is why. `control-classes.ts` plus the two pinned contrast
tests mean most of what a sweep like this normally finds cannot be written in the first place.

### Correction — "no touch-target misses" was false when written

This report originally listed touch targets among the dimensions that did not drift. The very next
commit found three undersized targets (`dev/reports/mobile-qa.md`, MQ-1 and MQ-2), one of them an
input with no `min-h` at all. Both statements sat in the tree, on adjacent pages of the
implementation log, until an independent review put them side by side.

The cause is worth recording, because it is the difference between the two passes rather than
carelessness: this sweep read **source**, and every control it inspected named a size class or
inherited one from `control-classes.ts`. It never measured a rendered box. `ProgressSteps` carries
`min-h-11` and looks correct in source; it measured 32×44 because its *width* came from contents that
shrink below `sm:`. Reading class strings cannot find that. Item 8 measured
`getBoundingClientRect()` and found it in one pass.

**The rule this leaves behind:** a source sweep may report that a size class is present. It may not
report that a target is big enough. Those are different claims and only one of them is checkable
without a browser.

---

## Fixed — two contrast failures

Both under TDD, both verified from painted values. Commit `1d13f12`.

### DQ-1 — a removed pick's wash, visible only to reduced-motion users

`ranked-list.tsx` put `opacity-50` on a removed recommendation's `<li>`. DESIGN.md bans exactly this
("Opacity never expresses disabled: it is outside the token system and compounds with whatever sits
underneath"), and the measurements say why — against `midnight`, a 50% wash takes:

| Token | Opaque | At 50% |
|---|---|---|
| `cream` | 16.52:1 | 4.82:1 |
| `ash` | 6.21:1 | **2.46:1** |
| `amber` | 9.04:1 | **3.09:1** |
| `warm-white` | 17.53:1 | 5.08:1 |

But the interesting part is that **it was never dimming anything**, and source review cannot see that.
The same element carries `animate-rise-fade`, whose `both` fill holds `opacity: 1`, and animation
declarations outrank author-normal ones in the cascade. Isolated in the page, away from this
component:

```
.opacity-50                      → computed opacity 0.5
.animate-rise-fade.opacity-50    → 0 during the run, 1 once settled
```

And every pick in the list, removed or not, computed `1`.

Then the second half. Reduced motion sets `animation: none !important`, which removes the animation
declaration — and the utility starts working. Same DOM, one attribute flipped:

| `data-reduced-motion` | Removed pick | Others |
|---|---|---|
| absent | opacity **1** | 1 |
| `"true"` | opacity **0.5** | 1 |

So the wash appeared *only* for people who had asked for less motion. For them, the row's metadata
read 2.46:1, and — the sharper problem — the row's own **Keep** button, which is live and is how you
undo the removal, drew its `ash` boundary at 2.46:1 against 1.4.11's 3:1 floor. The exemption for
inactive components does not apply: nothing in that row is inactive.

Removal is already drawn by the struck-through title and the ember line beneath it, which is what
everyone with motion enabled has been seeing all along. The class is gone.

**Guard added:** the opacity ban is now swept repo-wide with an empty allowlist, in
`control-contrast.test.tsx` alongside the existing `-slate` sweep. An entry there has to argue why a
wash is right when the palette already has `slate` and `ash` for inactive.

### DQ-2 — ember text on charcoal, on `/groups`

The leave-failure alert rendered inside the group card. Measured live: colour `rgb(196, 101, 58)`
(`--ember`) on `rgb(26, 31, 46)` (`--charcoal`), 14px, weight 400 — normal-size text at **4.12:1**,
under the 4.5:1 floor.

DESIGN.md states the rule outright, and the file already knows it: the leave-confirm block thirty
lines above carries the comment *"Ember carries the destructive signal as the border; ember text on
charcoal is only 4.1:1, under AA"*. The alert below it then did the thing the comment forbids. Now
`text-cream` (14.47:1); the destructive signal stays with the ember-bordered control, as above.

The existing `contrast.test.ts` asserts the *token* relationship (`ember` clears 4.5:1 on midnight
and does not on charcoal) but nothing checked a call site's backdrop, which is why this survived. The
new test pins this one: it asserts the card is `bg-charcoal` and the alert is not `text-ember`, so
the two facts have to be read together.

---

## Presented, not resolved — Sam's calls

The queue item says to present these with evidence rather than settle them. Both are in
`dev/research/open-decisions.md`.

### Decision #5 — the genre-chip grid's `ash` borders

Nothing has changed since the captures were taken; they are still at
`dev/reports/screenshots/chip-grid-{375,1280}px-{resting,selected}.png`, and the numbers in
`dev/reports/2026-08-01-authenticated-a11y-verification.md` §Part 3 are still the right ones: chips
sit on **charcoal**, so the governing ratio is **5.44:1**, not the 6.21:1 midnight figure. This sweep
adds one observation from looking at the whole app rather than the grid alone: the grid is now the
only surface in the app where 30 identical outlined controls stack in one block. Every other
`ash`-bordered control appears in ones and twos. If the resting set reads too hot, it is a density
effect specific to that grid, not evidence against the `ash` boundary rule — which supports the
documented fallback (a mid-tone token moving only the chip's boundary) over reverting the rule.

### Decision #6 — the `text-amber` notice colour

The skipped-titles notice uses `text-amber` on a **non-interactive** element, in
`profile/page.tsx:203` and `ritual/page.tsx:345`. DESIGN.md maps `--warning` to amber, but the
concern was that every other `text-amber` is a link.

The sweep can now answer the factual half of that. Classifying all 18 `text-amber` sites:

- **Interactive (13)** — nav, footer, page-level tertiary links, and the selected states in `Chip`,
  `RoughDayToggle`, `GroupPicker`.
- **Non-interactive (5)** — the two skipped-titles notices; the invite code on
  `groups/join/[code]/page.tsx:86` (28px semibold with `tracking-[0.2em]`); the **current** step
  marker in `progress-steps.tsx:32`, which renders in a `<span>` because only *completed* steps are
  buttons; and the session-summary line in `mood-screen.tsx:140`, a `<dd>` inside the charcoal panel.

**Corrected after review.** This first named only three non-interactive sites against a tally of
five, and filed `ProgressSteps` and `MoodScreen` under "selected states" as though they were
controls. The correction matters to the decision rather than just tidying the count:
`mood-screen.tsx:140` is **14px regular amber static text** — precisely the shape this report told
Sam was unique to the skipped-titles notices. There are three of those, not two.

So "amber is otherwise links-only" is not true today. The invite-code display uses amber as static
emphasis and nobody reads it as a link, because 28px and letter-spacing say otherwise. The
distinguishing variable looks like **type treatment, not colour** — and by that reading the
session-summary line has the same problem the notices do.

That narrows the decision rather than making it: `text-cream` remains the one-line alternative, and
"keep amber but change the notice's type treatment" is now a third option that did not exist before
this sweep. Still Sam's call.

### DQ-3 — a destructive control level that is not in the design system

Three hand-rolled buttons share a near-identical string that `control-classes.ts` does not name:

| Site | Shape |
|---|---|
| `groups/page.tsx:329` (Yes, leave) | `min-h-11 … text-sm` + `disabledOutlinedClasses` |
| `profile/page.tsx:283` (Delete for good) | `min-h-12 … text-base` + `disabledOutlinedClasses` |
| `profile/page.tsx:237` (Delete my account) | `min-h-12 … text-base`, **no** `disabledOutlinedClasses` |

The 11/`sm` vs 12/`base` split mirrors the sanctioned `compactOutlinedButtonClasses` vs
`secondaryButtonClasses` pairing, so that is deliberate parallelism, not drift. The third row is the
inconsistency: `control-contrast.test.tsx` already contains a test asserting that a *never-disabled*
control ("Start over") still carries the inert treatment, on the reasoning that it stays inert until
`:disabled` matches. By that convention line 237 should carry it too.

This is the same shape as the disabled-treatment consolidation of 2026-08-01 — several copies of one
string with nothing able to say which is canonical. **Not done here**, because naming a fourth
control level would extend DESIGN.md's decisions log rather than apply it, and item 7's brief says
not to. Recommendation: add `destructiveButtonClasses` / `compactDestructiveButtonClasses` to
`control-classes.ts` and pin them the way the other four are.

---

## What this sweep did not cover

- **Before/after screenshots.** The two fixes are a deleted class and a colour token; both were
  verified from computed values in a browser, which is stronger evidence than an image of a dark
  page. The chip-grid captures decision #5 needs already exist and are unchanged.
- **Motion timings and stagger.** DESIGN.md specifies durations and an 80ms poster stagger. The
  tokens are declared in `globals.css` and used; nothing was timed frame by frame. Item 8's throttled
  pass is the better place for that.
- **Interaction and layout under touch.** Item 8 owns it.
- **The results page with a real matching response.** Rendered here from a seeded `recommendations`
  row, which is enough for appearance. Anything about the *content* of a real response is out of
  scope for both items.
