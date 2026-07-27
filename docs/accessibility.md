# Accessibility — WCAG 2.2 AA conformance

**Target: WCAG 2.2 Level AA.** Set by Sam on 2026-07-19. This is a shipping requirement, not an aspiration: a surface that doesn't meet it isn't done.

This doc is the audit state and the remediation queue. `DESIGN.md` holds the design-system rules that follow from it (measured contrast values, the token constraints); this doc holds per-criterion status and open work.

## Status summary

| | Count | |
|---|---|---|
| ❌ Open — must fix for AA | 3 | 1.4.11 control borders, 2.4.2 page titles, 2.4.1 skip link |
| ✅ Verified passing | see below | measured or exercised, not assumed |
| ➖ Not applicable | 3 | no drag, no help mechanism, no cognitive-function auth test |
| ❓ Not yet audited | — | full AT/screen-reader pass; see Not yet verified |

---

## ❌ Open items (must fix)

### 1.4.11 Non-text Contrast — `slate` control borders (systemic)

`--slate #2d3548` is the border on every input, textarea, and outlined control. Measured against its backgrounds:

- on `--midnight #0f1219` → **1.53:1**
- on `--charcoal #1a1f2e` → **1.34:1**

The requirement is **3:1** for the visual boundary of a user-interface component. Both fail, and not marginally.

**Why it passes casual inspection:** every control is still *identifiable* by its label, placeholder, or glyph, all of which clear 4.5:1. Only the boundary itself is decorative-strength. This was noticed during the Phase 7 close-out review and deliberately left open then, because the fix touches every form in the app and the conformance target hadn't been set. It is now set, so this must be fixed.

**Scope:** 45 occurrences of `border-slate` across 21 files under `src/`.

**Recommended fix:** promote the *resting* border on interactive controls to `--ash #8b95a8` (6.21:1 on midnight, 5.44:1 on charcoal — clears 3:1 with headroom). Keep `slate` for non-interactive dividers and panel edges, which 1.4.11 does not govern. Do not reach for a new token; `ash` already exists and is already used for secondary text, so promoting it costs no palette surface.

**Watch out:** this is a visual change to the app's calmest surfaces, and DESIGN.md's aesthetic is deliberately quiet. Verify in a real browser at both 375px and 1280px that the forms don't start shouting. If `ash` reads too hot on large form surfaces, the alternative is a dedicated mid-tone token between slate and ash that still clears 3:1 — but try `ash` first.

### 2.4.2 Page Titled — six pages share one generic title

`tonight`, `quick`, `ritual`, `groups`, `profile`, and `results/[sessionId]` are all client components (`"use client"`) with no `export const metadata` and no route-segment `layout.tsx`. Every one of them inherits the root layout's `<title>Movie Night</title>`.

A screen-reader user tabbing between browser tabs, or anyone scanning history/bookmarks, gets six identical entries. `privacy` is the only non-root page with a real title (`Privacy — Movie Night`).

**Fix:** a client component cannot export `metadata`. Add a small server `layout.tsx` per route segment exporting `metadata: { title: "..." }` — the page stays a client component underneath. Titles should name the surface: "Tonight", "Quick match", "The full ritual", "Groups", "Profile", "Tonight's picks".

### 2.4.1 Bypass Blocks — no skip link

There is no skip-to-content mechanism. Every page repeats the `Nav` before `<main>`.

The repeated block is genuinely small (a wordmark plus one auth control), which is why this is listed third rather than first — some auditors would pass it on the "not a block" reading. Don't rely on that. A skip link is a handful of lines and removes the argument entirely.

**Fix:** a visually-hidden-until-focused anchor to `#main` as the first focusable element in `<body>`, plus `id="main"` on each page's existing `<main>`. Note the `<main>` elements live in the individual pages, not the root layout — so either add the id per page or lift `<main>` into the layout (the latter is cleaner but touches every page's wrapper).

---

## ✅ Verified passing

Measured or exercised during Phases 6–8, not assumed:

- **1.4.3 Contrast (Minimum)** — all text tokens clear 4.5:1 on their actual backgrounds. Measured values are in DESIGN.md §Accessibility. **One constraint to preserve: `ember` on `charcoal` is 4.12:1 and would fail.** It is currently only ever used on `midnight` (4.70:1). Keep it that way for normal-size text.
- **1.4.11 Non-text Contrast — focus indicator** — the global focus ring is amber (9.04:1 on midnight, 7.92:1 on charcoal), far above 3:1. Verified in-browser with real Tab traversal, measured as `rgb(232,168,73)`.
- **2.4.11 Focus Not Obscured (Minimum)** *(new in 2.2)* — passes trivially: the app has **no** `position: sticky` or `position: fixed` elements, so nothing can overlay a focused control.
- **2.5.8 Target Size (Minimum)** *(new in 2.2)* — the requirement is 24×24px; the design system mandates 44×44px and this was measured in-browser across the flows (86 interactive elements checked in one pass during slice 7b).
- **2.1.1 Keyboard / 2.1.2 No Keyboard Trap** — flows were traversed with real Tab and Arrow keys in the browser; the results tabs are arrow-navigable; Escape closes the nav menu and restores focus to its trigger.
- **2.4.3 Focus Order / 2.4.7 Focus Visible** — focus is deliberately managed on step changes, error screens, and leave-confirm transitions (three separate focus-restoration bugs were found and fixed across the Phase 7 slice reviews).
- **3.1.1 Language of Page** — `<html lang="en">`.
- **1.3.1 Info and Relationships** — `<main>` on every page; headings verified non-skipping (an `h1 → h3` jump in two results tab panels was found and fixed in the Phase 7 close-out review); mood tags use `role="checkbox"` + `aria-checked`; loading uses `aria-live="polite"`.
- **2.3.3 Animation from Interactions** *(AAA, but we honor it)* — `prefers-reduced-motion` plus an in-app toggle. Note the fix here: `animation-duration: 0.01ms` does **not** fast-forward an animation (Chrome pins it at `currentTime: 0`, leaving `fill-mode: both` elements stuck on their `from` keyframe — this made whole pages invisible). The correct reduced-motion kill is `animation: none`.

## ➖ Not applicable

- **2.5.7 Dragging Movements** *(new in 2.2)* — no drag interactions exist anywhere in the app.
- **3.2.6 Consistent Help** *(new in 2.2)* — no help mechanism is offered, so there is nothing to place consistently. If a help/contact affordance is ever added, it must appear in a consistent relative order across pages.
- **3.3.8 Accessible Authentication (Minimum)** *(new in 2.2)* — sign-in is Google OAuth only. No cognitive-function test (no puzzle, no CAPTCHA, no transcription), and password entry is delegated to Google. Adding any bespoke challenge later would put this back in scope.

## Not yet verified

Be honest about the boundary of what's been checked:

- **No screen-reader pass has been run.** All ARIA work to date was verified structurally (roles, names, live regions in the DOM) — not by listening to VoiceOver/NVDA actually announce a flow. Worth doing once against the deployed app, especially the results page, where the taste map's meaning depends on reading order.
- **3.3.7 Redundant Entry** *(new in 2.2)* — believed to pass: the ritual pre-fills the profile from saved data rather than re-asking. Not explicitly audited end-to-end.
- **1.4.10 Reflow / 1.4.4 Resize Text** — no-horizontal-scroll was verified at 375px and 1280px, but 400% zoom (the actual 1.4.10 condition) was not tested.
- **Contrast of the person-a / person-b / overlap taste-map colors against every surface they land on** — spot-measured (5.5–6.1:1 on midnight) but not swept across all backgrounds.

---

## Method note

Contrast figures here were computed with the WCAG relative-luminance formula, validated against reference pairs (`#ffffff`/`#000000` → 21.00:1, `#777777`/`#ffffff` → 4.48:1). Earlier figures in DESIGN.md (cream 13.2:1, amber 7.1:1) did not match the formula and were corrected on 2026-07-19. **Recompute rather than copying a remembered number** — the wrong values sat in the design system for months and would have justified a bad decision eventually.
