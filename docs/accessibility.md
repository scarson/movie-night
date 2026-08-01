# Accessibility — WCAG 2.2 AA conformance

**Target: WCAG 2.2 Level AA.** Set by Sam on 2026-07-19. This is a shipping requirement, not an aspiration: a surface that doesn't meet it isn't done.

This doc is the audit state and the remediation queue. `DESIGN.md` holds the design-system rules that follow from it (measured contrast values, the token constraints); this doc holds per-criterion status and open work.

## Status summary

| | Count | |
|---|---|---|
| ❌ Open — must fix for AA | 0 | the 1.4.11 / 2.4.2 / 2.4.1 queue was closed on 2026-07-27 |
| ✅ Verified passing | see below | measured or exercised, not assumed |
| ➖ Not applicable | 3 | no drag, no help mechanism, no cognitive-function auth test |
| ❓ Not yet audited | — | full AT/screen-reader pass; see Not yet verified |

---

## Remediation closed on 2026-07-27

All three open items were fixed, each test-first, and then verified in a real browser
at 375px and 1280px. The browser pass is what makes them credible — it caught three
defects that the unit tests could not, described below.

### 1.4.11 Non-text Contrast — control borders ✅

`--slate #2d3548` was the border on every input, textarea, and outlined control:
**1.53:1** on midnight, **1.34:1** on charcoal, against a 3:1 requirement.

The resting border on *interactive* controls is now `--ash #8b95a8` — measured in-browser
at **6.21:1** on midnight and **5.44:1** on charcoal. `slate` is kept for what 1.4.11
does not govern: dividers, panel edges, hover washes, and disabled controls (explicitly
exempt as inactive components). `hover:border-ash` became a no-op once resting was ash,
so those hovers moved up to `cream`.

**A fourth gap, not in the original audit:** `ToggleRow`'s switch track. Knob position is
the only visual carrier of on/off, and the off state drew a slate track on a charcoal
panel (**1.34:1**) with a midnight knob on that track (**1.53:1**) — two failures the
`border-slate` grep never surfaced, because they are `bg-` utilities. Off now has an inset
ash ring (**5.44:1**) and an ash knob (**4.06:1**). The on state already cleared via amber
(**7.34:1** track over the composited amber-glow panel, **9.04:1** knob).

**On the aesthetic risk:** the densest surface is the genre chip grid, ~18 outlined pills
at once. Checked at both widths — it reads as a calm outlined set, not a shout, and the
hierarchy still holds (amber owns selected and primary; kept-slate dividers stay visibly
fainter than control boundaries, which is the intended distinction). If it ever does read
too hot, the documented fallback is a dedicated mid-tone token between slate and ash.

### 2.4.2 Page Titled ✅

Each client-component route now has a small server `layout.tsx` supplying its title, and
the root layout carries a `%s — Movie Night` template so segments name only their surface.

The audit listed six pages; **`groups/join/[code]` was a seventh**, and it would have
inherited "Groups" from its parent segment. Verified against the served HTML: all nine
routes return distinct titles.

Non-obvious Next.js behavior worth keeping: **a title template applies only to a segment's
children, and a plain-string title passes none further down.** `groups` setting
`title: "Groups"` left its *grandchild* with no template, so `/groups/join/[code]` rendered
without the app name. Any segment with route segments beneath it must restate the template;
both spellings come from `src/app/title-template.ts` so they cannot drift.

### 2.4.1 Bypass Blocks ✅

A `SkipLink` is the first focusable element in `<body>` — `sr-only` until focused, then a
44px amber-outlined control at the top-left. Two defects found only in the browser:

- **The link moved nothing.** A bare `<main id="main">` is not focusable, so activating it
  scrolled while `activeElement` stayed on `<body>` — the next Tab returned to the banner
  the user had just asked to skip. All 20 `<main>` branches now carry `tabIndex={-1}`.
  (20, not 9: pages return separate `<main>` branches for loading/error/empty/content, and
  a partial pass would leave the link dead on exactly the states a struggling user hits.)
- **The focused link had no padding.** Tailwind's `not-sr-only` resets `padding` to 0, so
  the unprefixed `px-md` lost the cascade and the text sat against the border. Every layout
  utility on the link is now focus-prefixed.

### Guards left behind

- `src/test/contrast.ts` — WCAG relative luminance, with the palette read live from
  `globals.css` so assertions track the real tokens rather than a copy. Validated against
  `#fff`/`#000` → 21.00:1 and `#777`/`#fff` → 4.48:1, and it reproduces every figure in
  this document.
- `control-contrast.test.tsx` — renders each primitive and asserts its boundary, then pins
  every remaining `-slate` use to a documented allowlist, so a new slate boundary fails
  loudly and forces the interactive-or-not call to be made deliberately.
- `page-titles.test.tsx` / `skip-link.test.tsx` — per-segment titles, template forwarding,
  and a source scan requiring `id="main" tabIndex={-1}` on every `<main>`.

---

## ✅ Verified passing

Measured or exercised during Phases 6–8, not assumed:

- **1.4.3 Contrast (Minimum)** — all text tokens clear 4.5:1 on their actual backgrounds. Measured values are in DESIGN.md §Accessibility. **One constraint to preserve: `ember` on `charcoal` is 4.12:1 and would fail.** It is currently only ever used on `midnight` (4.70:1). Keep it that way for normal-size text.
- **1.4.11 Non-text Contrast — focus indicator** — the global focus ring is amber (9.04:1 on midnight, 7.92:1 on charcoal), far above 3:1. Verified in-browser with real Tab traversal, measured as `rgb(232,168,73)`.
- **1.4.11 Non-text Contrast — control boundaries** — remediated 2026-07-27, see above. Every interactive resting boundary measured ≥3:1 in-browser against its actual painted backdrop.
- **1.4.3 / 1.4.11 — the taste-map person colors** — swept on 2026-08-01 across every surface they actually land on, replacing the earlier spot measurement. All five (`person-a` `#6b8cce`, `person-b` `#ce7b8c`, `person-c` `#6fae9f`, `person-d` `#b3a06a`, `overlap` `#9b7ec8`) are painted on one opaque backdrop — `midnight`, the body background — because every use of them (the results-page taste map, the landing vignette, the dealbreaker chips on `/profile` and `/ritual`) renders inside a bare `<main>` with no panel, card or wash between it and `body`. On midnight they measure **5.59 / 6.10 / 7.34 / 7.27 / 5.54**, against 4.5:1 for the 12px tag labels, the 20px member headings and the 16px vignette copy, and 3:1 for the legend swatches and section rules. The one composited surface is the selected dealbreaker chip's own `#ce7b8c20` fill, flattened over midnight to `#271f27`: its 14px `person-b` label reads **5.21:1** there and its border **6.10:1** against the page. Two placement-dependent constraints came out of the sweep and are recorded in DESIGN.md §Accessibility — the rose chip must stay off `charcoal` (**4.45:1**), and person-color text must stay out of an amber-glow wash (`overlap` over `amber-glow`-on-midnight is **4.49:1**). The landing hero's starfield is the only such wash near person-colored text; measured in-browser at 375px and 1280px, its ellipse fades out at y≈263px and y≈235px while the vignette's colored spans begin at y≈434px and y≈432px, so the alpha under them is zero at both widths.
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

---

## Method note

Contrast figures here were computed with the WCAG relative-luminance formula, validated against reference pairs (`#ffffff`/`#000000` → 21.00:1, `#777777`/`#ffffff` → 4.48:1). Earlier figures in DESIGN.md (cream 13.2:1, amber 7.1:1) did not match the formula and were corrected on 2026-07-19. **Recompute rather than copying a remembered number** — the wrong values sat in the design system for months and would have justified a bad decision eventually. The maths now lives in `src/test/contrast.ts` rather than in anyone's head.

Three traps met while measuring in-browser on 2026-07-27:

- **Composite alpha before comparing.** `--amber-glow` is `#e8a84920`. Comparing a border against the raw `getComputedStyle` value of a translucent background yields a meaningless number (an amber track against an amber-glow panel measured "1.00:1"). Walk up the tree, composite each layer over the next, and compare against the resulting solid color. `composite()` in `src/test/contrast.ts` does the flattening; `person-color-contrast.test.tsx` is the sweep that uses it, and it pins the person-color enumeration to an allowlist so a use on a new surface has to be measured rather than assumed.
- **`:focus` does not match when the browser window lacks OS focus,** even though `document.activeElement` is set. A programmatic `.focus()` in a background pane reports the element as focused while none of its `focus:` styles apply, which reads exactly like a broken style. Check `document.hasFocus()`, or drive it with a real Tab keypress.
- **jsdom cannot verify any of this.** It has no layout, no fragment-navigation focus, and no CSS cascade. Both skip-link defects and the switch-track gap passed a green suite. Anything about focus movement, painted color, or size needs a real browser.
