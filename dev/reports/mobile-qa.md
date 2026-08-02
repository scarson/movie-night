# Mobile and touch QA of the full ritual

**Date:** 2026-08-02
**Branch:** `claude/handoff-2026-08-02-continue-93175c`
**Queue item:** 8 in `dev/plans/2026-08-01-next-queue.md`
**Method:** the whole ritual driven end to end in Chrome at 375×812, signed in via the local runbook,
against `wrangler dev` on the OpenNext build with real D1. Every number below was read from
`getBoundingClientRect()` on the running page. Nothing here rests on a jsdom test — the queue item
says not to accept one as evidence for a touch or layout claim, and it is right.

Group fixture: two members (`Sam Rivera`, `Jordan Ellery-Whitcombe` — deliberately long) so the
stepper carries three steps and the member names are the worst realistic case.

---

## Touch targets

Probe: every `button`, `a[href]`, `input`, `textarea`, `[role=button|checkbox|switch|tab|radio]` and
`label:has(input)`, excluding anything visually hidden (`display:none`, `visibility:hidden`,
`clip-path: inset(50%)`, or ≤2×2px) and the `sr-only` inputs whose `<label>` is the real target.

| Surface | Targets | Under 44px |
|---|---|---|
| `/tonight` | 8 | 0 |
| `/ritual` step 1 — profile editor | 86 | 0 |
| `/ritual` step 2 — partner + rough day | 7 | **1** |
| `/ritual` step 3 — mood, 30-chip grid | 42 | **2** |
| `/profile` (delete confirm open) | 91 | **1** |
| `/groups` | 12 | 0 |
| `/results` — Taste map | 9 | 0 |
| `/results` — The picks | 15 | 0 |
| `/results` — In words | 9 | 0 |

Three misses, two distinct causes, both now fixed.

### MQ-1 — the completed-step markers were 32×44, and only on mobile

`ProgressSteps` gives its buttons `min-h-11`, so height was never the problem. Width is whatever the
contents need — and below `sm:` the step label is `sr-only`, leaving the 28px marker as the entire
target. Measured **32×44** at 375px, and 44×44+ at ≥640px where the label paints.

Two individually correct decisions produced it. The `sr-only` label is the pattern the a11y report
singled out as *right*, because it stops a long member name forcing horizontal scroll at 320px. The
`min-h-11` shows the author thinking about touch. Neither could see the other.

Fixed with `min-w-11` (and `justify-center`, so the marker centres in the wider box). Both it and
the `min-w-0` it replaced are explicit minimums, so the button still shrinks past its content width
either way; this one stops at a thumb. Verified after the fix: **44×44 at both 375px and 320px, zero
overflowing elements, `scrollWidth === clientWidth` at both.**

**Corrected after review:** an earlier draft said `min-w-0` was what let a long name truncate rather
than force horizontal scroll at 320px. It is not — below `sm:` the label is `sr-only` and contributes
nothing to layout, so `sr-only` is what protects 320px and `min-w-0` only ever mattered at ≥640px.
The fix is right; that reason for it was not. The independent review also measured the headroom this
leaves: at 320px `scrollWidth === clientWidth` holds up to **seven members**, and overflow starts at
eight. No group-size cap exists anywhere, which is separately on the backlog.

This clears WCAG 2.2's 2.5.8 floor either way (24×24), so it was a house-rule miss, not a conformance
failure. DESIGN.md's 44px rule is stricter than the criterion on purpose.

### MQ-2 — the delete-confirmation field was 42px

`/profile`'s "Type delete to confirm" input measured **256×42**. Every other input in the app carries
`min-h-11`; this one was sized by `py-sm` plus its line box and landed 2px short. It is the control
that gates the least reversible action in the product. Fixed with `min-h-11`.

### Inputs and iOS auto-zoom

All seven text inputs across `/profile`, `/groups`, `/ritual` and `/results` compute **16px**, so none
triggers iOS's zoom-on-focus. DESIGN.md's rule holds without exception.

---

## Scroll depth, and the absence of anything sticky

At 375×812, measured on the running page:

| Surface | Height | Screens | Primary action at |
|---|---|---|---|
| `/tonight` | 1065px | 1.31 | y=339 |
| `/ritual` step 1 — profile editor | 3065px | **3.77** | Continue at y=**2693** |
| `/ritual` step 3 — mood | 2498px | 3.08 | bottom |
| `/results` — picks (**3** recommendations) | 2957px | 3.64 | steering y=2365, regenerate y=**2503** |
| `/profile` | 3931px | 4.84 | Save at bottom |

**Zero elements anywhere in the app use `position: sticky` or `position: fixed`.** So to advance from
the first step of the ritual, a phone user scrolls 2.7 screens past a form where every single field is
optional, to reach a button they could have pressed immediately. The results page is the same shape at
the moment the user most wants to act — and it was measured with only three recommendations; a real
round returns around five, which puts the refine controls closer to five screens down.

**Not fixed.** The remedy is a persistent affordance, and DESIGN.md already says where one would live
— which turns out to be a gap in its own right.

### MQ-3 — DESIGN.md specifies a bottom tab bar that does not exist

> §Layout — **UI chrome:** Bottom tab bar (mobile), side nav (desktop).
> §Elevation — **The only shadow:** Drop shadow on the bottom tab bar.

There is no bottom tab bar and no side nav; the app has a top header and a footer. A repo-wide search
finds those two lines and nothing else — no component, no decision-log entry, no note in `docs/`
explaining the omission.

Phase 1 has three real destinations, so YAGNI may well have been the right call. But the spec is
dangling: §Elevation describes the shadow of a component that was never built, and anyone
implementing mobile chrome later will find two rules that contradict the shipped app. This is also
exactly where a persistent primary action would sit, so the scroll-depth finding and this one are the
same decision wearing two hats. **Either build it or record the decision not to** — queued.

---

## The loading narrative on a slow connection

The queue asks whether `PhasedLoading` "reads as progress or as a hang". Measured on the real page
with the `/match` response held open, sampling the rendered text:

**Quick match (first wait):**

| t (from the click) | on screen |
|---|---|
| 1.1 s | Reading your tastes... |
| 2.4 s | Finding the overlap... |
| 3.2 s | Weighing tonight's mood... |
| 4.6 s | Choosing tonight's picks... |
| 7 s → 14 s | *unchanged* |

These are wall-clock from the button press, so they include the session-create round trip before the
loading screen mounts. `PhasedLoading` holds `HOLD_MS = 900` per phase, so it reaches its terminal
phase about **2.7 s after mounting** — the motionless window is longer than 4.6 s suggests, not
shorter. The refinement figure below is the one to quote, because there the component mounts
immediately.

**Refinement (second wait, after the user has invested effort):** terminal phase by **~3.0 s**, then
unchanged through 12 s.

After that the screen is one centred line of text. No spinner, no progress, no elapsed time, no
cancel. `PhasedLoading`'s effect deps are `[index, lastIndex]`, so once `index === lastIndex` nothing
re-schedules.

DESIGN.md's own spec is the sharpest framing available:

> **Loading sequence:** Phased text appears calmly. Minimum 1.5s for narrative to land, **otherwise
> adapts to actual API response time.** Not a progress bar.

It adapts *downward* — a fast response fast-forwards the remaining phases at 200ms each. It does not
adapt upward. Against the 5–15 s budget in `dev/plans/design-doc.md` (still the only latency estimate
the project has), that leaves between 0.4 s and 10 s of motionless screen on the app's slowest path,
before any network throttling, on both waits.

**Not fixed, and queued as a spec gap rather than a design request.** The shape of the upward
adaptation — more phases, a holding line, elapsed time — is a design choice that has to stay inside
"calm thinking, not a progress bar", and adding a spinner would fight the brief. But the current
behaviour is not what DESIGN.md describes, so this is a defect against a written spec and not a new
feature.

One incidental observation: when the loading screen replaces the results page, scroll collapses from
y=2121 to 0 and the document shrinks to one viewport. That is correct — there is nothing to scroll —
and on completion the user lands at the top of the new picks, which is where they should be.

---

## What this pass could not verify

Stated plainly rather than glossed, because two of these are the questions the queue actually asked.

- **Real touch input.** Every measurement is geometry from a desktop Chrome at a phone viewport.
  Sizes, spacing and reflow are exactly measurable that way and are what 2.5.5/2.5.8 are about.
  What is *not* covered: gesture conflicts, momentum scrolling, and 300ms tap delay. No `touch-action`
  or gesture handler exists anywhere in the app, so the surface for those is small, but it is not
  zero and it was not tested.
- **Whether the soft keyboard obscures inputs.** This needs a real device — an emulated viewport has
  no keyboard. The measurable half is done: every input is 16px, so iOS will not zoom, which is the
  mechanism that usually causes the obscuring. The remaining risk sits on `/results`, where the
  steering textarea is at y=2365 with the submit button 138px below it, so a ~300px keyboard would
  cover the button while the field is focused. **Flagged, not proven.**
- **A genuinely throttled network.** The match wait was simulated by holding the response open, which
  reproduces the thing that matters (a long wait) but not packet-level slowness on the first paint.
  The performance audit already covers the asset waterfall.
- **Thumb reach as ergonomics.** Scroll depths and control positions are measured; "can a thumb
  comfortably reach it" is a judgement about hand size and grip that a viewport cannot answer. The
  finding above is stated as scroll distance and the absence of a persistent affordance, both of
  which are facts.
