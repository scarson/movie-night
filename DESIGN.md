# Design System — Movie Night

## Product Context
- **What this is:** A group movie/TV recommendation app where AI reasons about taste compatibility between people
- **Who it's for:** Couples and friend groups. Primary: Alice (medical resident, 18h shifts) and Bob. Shared publicly via movienight.scarson.io.
- **Space/industry:** Film recommendation, adjacent to Letterboxd, MUBI, Criterion Channel
- **Project type:** Mobile-first web app (Next.js + Cloudflare Workers)

## Aesthetic Direction
- **Direction:** Cinematic Editorial
- **Decoration level:** Intentional (subtle starfield/grain texture on dark backgrounds, not decorative blobs)
- **Mood:** "A24's restraint meets the warmth of a staff-curated bookstore shelf. Designed for the couch at 9pm." Intimate, unhurried, warm. Not corporate, not techy, not performative.
- **Design thesis:** Discovery energy, not reveal energy. Things appear naturally, inviting exploration. If a recommendation misses the mark, it should feel like "hmm, interesting thought, but not tonight" — not a failed magic trick.
- **Reference points:** A24 (Swiss restraint, nuance over noise), MUBI (each film displayed like a painting), Criterion (monochrome authority), Headspace/Calm (evening pacing, spacious UI for wind-down moments)

## Content Density Principle
Text earns its place by being personally meaningful or action-enabling. Everything else is visual.

- **Text-heavy (by design):** Taste Map prose analysis, Conversational recommendation view. The text IS the product here. Reading about your own taste profile is inherently engaging.
- **Visually led (minimal text):** Quick Match (tags + button), Recommendations (poster-dominant, 1-2 sentence explanations max), Landing page (one sentence + visual + CTA), Session history (poster thumbnails + dates), Onboarding (movie poster browsing).
- **Principle:** The overall experience is "browsing a curated film festival program with beautiful imagery," not "reading a blog post." The Taste Map is the exception that proves the rule.

## Typography
- **Display/Hero:** Fraunces (variable serif, Google Fonts, optical size 9-144, weight 100-900)
  Why: Editorial warmth with personality. Soft serifs feel literary, not corporate. Variable optical size means it works at 14px AND 56px. The italic is distinctive ("What are we feeling tonight?"). Nobody in the film app space uses it.
- **Body/UI:** Satoshi (geometric sans, Fontshare, free, weight 300-900)
  Why: Clean but not boring. Geometric proportions read well on mobile. More personality than Inter/DM Sans without being distracting. Works at small sizes for labels and tags.
- **Data/Tables:** Satoshi with tabular-nums (for match scores, dates, counts)
- **Code:** JetBrains Mono (admin/debug views only)
- **Loading:** Google Fonts (Fraunces), self-hosted woff2 (Satoshi). Download Satoshi from Fontshare, serve from the Workers app to eliminate third-party CDN dependency. font-display: swap, async loading.
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40 / 56px (mobile base 16px, desktop base 16px)
- **Weights:** Body 400/500, emphasis 600, headings 700-900. High contrast pairing (400 body + 800 display).

## Color
- **Approach:** Restrained warm on dark
- **Philosophy:** The app feels like a dimly lit room. Amber is the candlelight. Cream is what you read. Person colors only appear in taste analysis contexts.

### Core palette
| Token | Hex | Role |
|-------|-----|------|
| `--midnight` | `#0f1219` | Primary background (deep navy-black) |
| `--charcoal` | `#1a1f2e` | Surfaces, panels, input backgrounds |
| `--slate` | `#2d3548` | Borders, subtle dividers |
| `--ash` | `#8b95a8` | Muted text, secondary info |
| `--cream` | `#f5f0e8` | Primary text, headings |
| `--warm-white` | `#faf7f2` | Bright emphasis text |

### Accents
| Token | Hex | Role |
|-------|-----|------|
| `--amber` | `#e8a849` | Primary accent. Three treatments for hierarchy: **fill** (CTAs, primary buttons), **border/outline** (selected mood tags, active states), **text-only** (tertiary interactive, links). One hue, three levels of visual weight. |
| `--amber-glow` | `#e8a84920` | Ambient glow (12% opacity), focused/active states |
| `--ember` | `#c4653a` | Secondary accent, warmth, error-adjacent |
| `--sage` | `#7a9e7e` | Positive/success states |

### Taste map colors (contextual, not app-wide)
| Token | Hex | Role |
|-------|-----|------|
| `--person-a` | `#6b8cce` | Cool blue, first member's taste |
| `--person-b` | `#ce7b8c` | Warm rose, second member's taste |
| `--overlap` | `#9b7ec8` | Where tastes converge |

For groups > 2, additional person colors assigned from a curated set that maintains contrast on dark backgrounds.

### Semantic
| Token | Hex | Role |
|-------|-----|------|
| `--success` | `#7a9e7e` | Same as sage |
| `--warning` | `#e8a849` | Same as amber |
| `--error` | `#c4653a` | Same as ember |
| `--info` | `#6b8cce` | Same as person-a blue |

### Dark mode
This IS the dark mode. No light mode planned. The app is designed for evening use on the couch. A light mode would work against the cinematic atmosphere.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (evening app, not productivity tool)
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64) 4xl(96)
- **Principle:** Generous on mobile. 44px touch targets. 16px horizontal body padding. The app should feel spacious, like Headspace, not cramped like a news feed.

## Layout
- **Approach:** Creative-editorial for content, grid-disciplined for UI chrome
- **Content:** Asymmetric, generous whitespace. Prose flows like a magazine. Posters are large and dominant.
- **UI chrome:** Bottom tab bar (mobile), side nav (desktop). Standard, predictable placement.
- **Max content width:** 680px (matches comfortable reading width)
- **Breakpoints:** 375px (mobile, primary), 768px (tablet), 1280px (desktop)
- **Border radius:** 4px (small elements like tags), 8px (inputs, buttons), 16px (panels, modals), 9999px (pills, avatars)
- **NOT uniform:** Different elements get different radii.

### Cards policy
**Recommendations and the taste map do NOT use card-based layouts.** These use large poster images with text flowing around/below, magazine-style.

**Cards ARE appropriate for:** settings panels, group management, onboarding steps, admin/utility surfaces, and any list view with 10+ repeating items (session history, Letterboxd import results). In these contexts, cards serve a structural purpose: grouping related info into scannable, repeatable units.

**The rule is about the core experience, not a universal ban.** The recommendation view and taste map are the emotional center of the app. They get editorial treatment. Everything else can use cards where cards make sense.

## Motion
- **Approach:** Unhurried clarity (NOT dramatic reveals)
- **Philosophy:** Things appear naturally, inviting reading. The loading sequence is calm thinking, not dramatic buildup. Discovery energy, not reveal energy.
- **Easing:** cubic-bezier(0.16, 1, 0.3, 1) for entrances, ease-out for exits
- **Duration:** micro(100ms), short(200ms), medium(400ms), long(800ms)
- **Loading sequence:** Phased text ("Reading your tastes...", "Finding the overlap...") appears calmly. Minimum 1.5s for narrative to land, otherwise adapts to actual API response time. Not a progress bar.
- **Taste map entrance:** Content fades/slides in gently, section by section. NOT a curtain-drop reveal. More like a page turning.
- **Recommendation cards:** Posters appear with subtle entrance animation, 80ms stagger between items. No bounce, no scale-up. Just fade + slight upward drift.
- **Utility actions:** No animation. Saves, toggles, navigation are instant.
- **Reduced motion:** Respect prefers-reduced-motion at the system level. Replace all animations with instant transitions.
- **In-app animation toggle:** Profile settings includes a "reduce animations" option. When enabled, animation durations drop to near-instant (50ms). This lets users who find the motion fatiguing after repeated use dial it down without changing their OS setting. Also useful for testing during development.

## Elevation & Depth
- **No box-shadows for elevation.** Use background color layering: midnight < charcoal < slate.
- **Active/focused states:** Subtle inner glow using inset box-shadow with amber-glow.
- **The only shadow:** Drop shadow on the bottom tab bar (very subtle, midnight to transparent, 4px blur).

## Iconography
- **Style:** Outlined, 1.5px stroke, rounded joins. Warm, not sharp.
- **Heart icon:** Used for the rough-day toggle. Empty outline → filled amber when active. The heart communicates "this is an act of care."
- **Size:** 20px default, 24px for navigation.
- **Source:** Lucide or Phosphor icon set (both are open, consistent, and support rounded style).

## Rough-Day Toggle (special design note)
The "[partner] had a rough day" toggle is private. It is only visible to the person setting it. The other group members never see it. The heart icon (empty → filled amber) is the visual indicator. The generosity stays invisible. This is a design principle, not just a data model decision.

**The weighting is never narrated in shared output.** An earlier draft of this doc suggested the taste map could say "tonight's picks lean toward [name]'s preferences" as a supposedly-anonymous hint. That is not anonymous in the common case: in a group of two, the favored member is by definition the one who did *not* toggle, so naming them tells the recipient their partner made the gesture. The matching prompt therefore marks the weighting PRIVATE and forbids surfacing it in any model output field. The only weighting line in the UI is shown exclusively to the person who set the toggle, describing their own choice back to them.

## Accessibility

**Conformance target: WCAG 2.2 Level AA.** This is a firm requirement, not an aspiration — see `docs/accessibility.md` for the per-criterion audit and the open remediation. Any new surface must meet it before it ships.

- **Contrast (measured, not estimated):** on `midnight` — cream 16.52:1, amber 9.04:1, sage 6.26:1, ash 6.21:1, ember 4.70:1. On `charcoal` — cream 14.47:1, amber 7.92:1, sage 5.49:1, ash 5.44:1, ember 4.12:1. *(An earlier revision of this doc listed cream at 13.2:1 and amber at 7.1:1; those figures were wrong — understated — and were corrected against the WCAG relative-luminance formula.)*
  - **`ember` must never carry normal-size text on `charcoal`** — 4.12:1 is below the 4.5:1 floor. It passes on `midnight` (4.70:1) only. Use it for text on midnight, or for large text / non-text elements elsewhere.
  - **`slate` is never a control boundary** — 1.53:1 on midnight, 1.34:1 on charcoal, against the 3:1 that 1.4.11 requires of a UI component's visual boundary. Interactive controls draw their resting boundary in **`ash`** (6.21:1 / 5.44:1); `slate` is for what the criterion does not govern — dividers, panel edges, hover washes, and disabled controls. This applies to `bg-` fills that carry state as much as to borders: a switch track is a control boundary even though it is a background. Enforced by `src/components/control-contrast.test.tsx`, which pins every remaining `-slate` use to a documented allowlist.
  - **A disabled control leaves the amber hierarchy.** It is not a dimmed CTA; it is chrome. Filled controls drop the amber fill to `slate` with an `ash` label. Outlined controls drop their `ash` boundary to `slate`, again with an `ash` label. Hover is neutralised in both cases — `:hover` still matches a disabled button, and Tailwind resolves same-specificity variants by stylesheet order rather than class-attribute order. **Opacity never expresses disabled**: it is outside the token system and compounds with whatever sits underneath. This is one rule stated at two levels, each in its own vocabulary — never a fill change on an outlined control, never a boundary change on a filled one. 1.4.3 and 1.4.11 both exempt inactive components, so `ash` on `slate` at 4.06:1 is a legibility judgement, not a conformance gate. Defined once in `src/components/control-classes.ts` as `disabledFillClasses` and `disabledOutlinedClasses`, inherited by every composed control; call sites do not restate it.
- **Person colors (measured on `midnight`, the only backdrop they are painted on):** person-a 5.59:1, person-b 6.10:1, person-c 7.34:1, person-d 7.27:1, overlap 5.54:1. Swept across every use on 2026-08-01 and enforced by `src/components/person-color-contrast.test.tsx`, which pins the set of files allowed to paint them.
  - **The selected dealbreaker chip stays on `midnight`.** Its `#ce7b8c20` fill flattens to `#271f27` there and the `person-b` label reads 5.21:1; the same fill over `charcoal` gives 4.45:1, below the 4.5:1 text floor.
  - **Person-color text never sits in an amber wash.** `overlap` over `amber-glow`-on-midnight is 4.49:1. The landing hero's starfield ellipse fades out roughly 200px above the taste-map vignette, so nothing is washed today; moving it, or putting a person color on an `amber-glow` surface, needs remeasuring first.
- **Touch targets:** 44x44px minimum on all interactive elements (comfortably above WCAG 2.2's 2.5.8 floor of 24x24). Visual size can be smaller if tap area extends.
- **Keyboard nav:** Tab order follows visual hierarchy. Enter/Space activates. Escape closes overlays. Arrow keys navigate mood tags and recommendation lists.
- **Screen readers:** ARIA landmarks on major sections. Alt text on all posters ("[Movie title] poster"). Match scores announced ("Arrival, 92% match"). Mood tags: role="checkbox" with aria-checked. Loading: aria-live="polite".
- **Font sizes:** Minimum 14px for any text. Inputs ≥ 16px to prevent iOS auto-zoom.

## Anti-Patterns (never do these)
- Purple/violet gradients
- 3-column feature grids with icons in colored circles
- Centered-everything layouts
- Uniform bubbly border-radius on all elements
- Emoji as design elements (except the heart on rough-day toggle)
- Generic hero copy ("Welcome to...", "Unlock the power of...")
- Card grids as the default content container
- Inter, Roboto, Arial, system fonts as primary typeface
- Decorative blobs, floating circles, wavy SVG dividers
- Cookie-cutter section rhythm (hero → 3 features → testimonials → pricing → CTA)

## Known Risks (validate during implementation)
- **Dark-only in bright environments.** Primary use is evening/couch, but users may open the app in daylight. High contrast (cream on midnight = 13.2:1) helps. Validate ash (#8b95a8) readability on a sunny screen.
- **Animation fatigue.** Elegant on first use, potentially sluggish by the 20th. The in-app animation toggle mitigates this. Consider auto-reducing durations after N sessions if data supports it.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-29 | Initial design system created | /design-consultation based on /office-hours design doc, CEO review, and competitive research (Letterboxd, MUBI, Criterion, A24) |
| 2026-03-29 | Dark-only, no light mode | Evening use case on the couch. Light mode works against cinematic atmosphere. |
| 2026-03-29 | Fraunces + Satoshi typography | Editorial warmth (Fraunces) + clean utility (Satoshi). Neither is an AI-default font. |
| 2026-03-29 | Amber "candlelight" accent | Emotional specificity: warmth, evening, intimacy. Differentiates from Letterboxd green, MUBI blue. |
| 2026-03-29 | No card-based recommendation layout | Magazine-style poster + text. Film festival program, not search results. |
| 2026-03-29 | Discovery energy, not reveal energy | Recommendations might miss. Gentle curiosity > dramatic buildup. Staff-curated bookshelf, not surprise party. |
| 2026-03-29 | Rough-day toggle is private, uses heart icon | Generosity framing. The selfless gift stays invisible to the recipient. |
| 2026-03-30 | Text density calibration | Taste Map is text-heavy by design. Everything else is visually led. Poster images, tags, and icons over prose. |
| 2026-03-30 | Self-host Satoshi font | Eliminates Fontshare CDN dependency. Serve woff2 from Workers. |
| 2026-03-30 | Amber state hierarchy | Fill (CTAs), border (selected), text-only (tertiary). One hue, three levels. |
| 2026-03-30 | Cards policy clarified | Ban is on core experience (recs, taste map), not universal. Utility surfaces use cards where appropriate. |
| 2026-03-30 | In-app animation toggle | Profile setting to reduce animations. Mitigates fatigue, aids testing. |
| 2026-07-19 | **WCAG 2.2 AA is the conformance target** | Set by Sam. Converts the previously-open "promote `slate` borders or accept them" question into a required fix — 1.4.11 is not optional. Per-criterion audit in `docs/accessibility.md`. |
| 2026-07-19 | Corrected the stated contrast figures | The doc's cream (13.2:1) and amber (7.1:1) numbers did not match the WCAG formula; real values are 16.52:1 and 9.04:1. Wrong numbers in a design system propagate into wrong future decisions, so they were recomputed and the method recorded. |
| 2026-07-27 | `ash` is the resting boundary for interactive controls | Closes the 1.4.11 remediation. `slate` at 1.53:1 could not be a control boundary under a 2.2 AA target, and `ash` clears 3:1 with headroom without adding a token. Checked at 375px and 1280px: the densest surface (the genre chip grid) still reads calm, and kept-slate dividers stay visibly fainter than control boundaries — which is the distinction the rule is drawing. |
| 2026-07-27 | Hover on outlined controls moves to `cream` | `hover:border-ash` became a no-op once the resting border was ash. Cream keeps the affordance and is already the vocabulary for a pressed outline. |
| 2026-07-19 | Weighting is never narrated in shared output | The doc's own "picks lean toward [name]" example was itself the privacy leak — in a couple it identifies the toggler. Removed and replaced with the invariant the shipped prompt enforces. |
| 2026-08-01 | Disabled controls leave the amber hierarchy | Eight sites across five files carried five distinct strings — two different opacity values and three different slate spellings — and nothing in the doc could say which was right. slate/ash is already the sanctioned inactive vocabulary (2026-07-27); opacity is outside the token system. Centralised in `control-classes.ts` and pinned by `control-contrast.test.tsx`. |
