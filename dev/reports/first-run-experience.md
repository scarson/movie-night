# First-run experience — what a brand-new account actually sees

**Date:** 2026-08-02
**Branch:** `claude/handoff-2026-08-02-continue-93175c`
**Queue item:** 6 in `dev/plans/2026-08-01-next-queue.md`
**Method:** local `wrangler dev` on the OpenNext build with real D1 and real secrets, signed in
via the runbook in `dev/reports/2026-08-01-authenticated-a11y-verification.md`. Every claim below
about what a person sees was taken from a browser at 375×812 and 1280×800, not from a test.

---

## The persona

The fixture is one `users` row and nothing else — no `profiles` row, no `group_members` row, no
sessions. That is exactly what the OAuth callback leaves behind on a first sign-in
(`src/app/api/auth/google/callback/route.ts` upserts the user and redirects to `returnTo`; there is
no first-run branch), and it is the state nothing in the codebase had previously been evaluated
from.

Verified before measuring anything: `GET /api/auth/me` returns the user, `GET /api/groups` returns
`{"groups":[]}`, `GET /api/user/profile` returns every list empty. A bare request returns 401.

---

## Verdict per surface

| Surface, brand-new | What a first-timer sees | Verdict |
|---|---|---|
| `/` signed out | Hook, taste-map vignette, Google CTA | **Good.** See F6 on CTA position. |
| `/tonight` | One radio ("Just me tonight"), Quick match, The full ritual, a footer link to groups | **The main finding — F1** |
| `/profile` empty | Six tap-to-add quick picks above the comfort search, hints on every section | **Good.** The best empty state in the app. |
| `/groups` with none | "No groups yet." plus what to do about it, then both forms | **Good.** |
| `/ritual` step 0 | The profile editor with quick picks, a two-step stepper | **Good.** This is the onboarding, and it works. |
| `/quick` | Eight mood chips and a CTA | **F2** — asserts a saved profile that isn't there |
| `/results/<no rounds>` | "Nothing picked yet" | Was a dead end; **fixed** |
| `/groups/join/<bad code>` | "That code didn't match a group" | Was a dead end; **fixed** |
| `/privacy` | Unchanged by account state | Good. |
| Signed-out deep links | `router.replace("/")`, blank frame first | Acceptable. No explanation offered, and none is needed. |

---

## Fixed in this pass

All three under TDD (failing test first), all verified against the running Worker. Commit
`a7c707e`.

### The matching error taxonomy was applied on one screen out of three

`ERROR_FRAMING` in the results page maps each `kind` to a heading, whether a retry can succeed, and
whether to offer the dealbreaker escape. The ritual and quick-match screens had none of it —
`requestMatch()` returned the server's message and **discarded `kind`**, so those screens
structurally could not branch even if they wanted to. Every failure got one framing and a
"Try again" button underneath.

What that costs, observed against the running Worker:

- **`daily_limit`** — I tripped the real 30-per-24h `match` rule and pressed the button. Before:
  "Not tonight, apparently" with a primary **Try again** whose window is a *day*. The results page
  had already reasoned this exact case out in a comment and set `retry: false`; quick and ritual
  never saw it.
- **`monthly_cap`** — same shape, observed by setting `MONTHLY_MATCH_LIMIT=0`.
- **`thin_results`** — tells the reader to loosen a dealbreaker. `/quick` has no dealbreaker control
  on it at all; the results page offers a link to `/profile` and these two did not.
- **`left_group`** — a retry that 403s forever.

Every one of these is reachable on a **first** round from `/quick` or `/ritual`. (`round_limit` is
not — it needs ten prior rounds.)

The framing map moved to `src/lib/match-errors.ts`; all three screens read it, and `requestMatch`
carries `kind` through.

**Deliberately not changed:** the "Not tonight, apparently" heading. The behavioural defect was
controls that promise what they cannot do; the heading is voice, and the pre-results flows have
their own. Whether they should adopt the results page's per-kind headings is a design call — noted
under Open questions.

**Still weak, and left alone:** with `retry` withheld, the only remaining control on `/quick` is
"Change the vibe", which for `left_group` returns to a screen showing a group you are no longer in.
It is a way *off* the screen and nothing on it lies, which is the bar this pass was fixing to.

### An invite code that doesn't resolve was a dead end

`/groups/join/<bad>` showed the ember message under a heading that still read "Someone wants to
watch with you.", with nothing to do but press the button that had just failed. This is where the
app's *second-ever* user lands, arriving cold from a link. Added: what to do about it, and a link to
`/groups`.

### The no-round results branch had no way back

`/results/<id>` with `round === 0` offered only "Find our match →". Both sibling load-failure
branches on the same page already offer "Back to tonight"; this one now matches them.

---

## Reported, not changed — these are product calls

### F1 — `/tonight` makes the wrong thing primary for someone with nothing saved

Measured at 375×812, brand-new account:

```
one radio in the group picker: "Just me tonight / Your profile only" (pre-selected)
Quick match       — amber primary, y=339
The full ritual   — outlined secondary, y=395
Groups & invites  — small amber text link, y=608
```

Three things follow from that layout, and none of them is a bug:

1. **The primary CTA is the one that needs a profile.** "Quick match reads the saved profiles and
   goes" — this account has none. Nothing blocks it: I pressed it and a session was created and a
   match attempted. The prompt renders empty lists as `"None selected"`
   (`src/lib/matching.ts:378`), so the engine runs on popularity and mood alone. The user gets
   recommendations that look like the product working, produced from nothing they told it.
2. **The app is for two people and nothing on this screen invites the second one.** The only route
   to an invite is the smallest, lowest-contrast element on the page.
3. **`/profile` is reachable only from the avatar menu.** Nothing anywhere says the profile is
   empty.

The full ritual *is* the onboarding — it opens on the profile editor with tap-to-add quick picks and
it is genuinely good. It is just the secondary button, and nothing routes a new account to it.

**Recommendation, for Sam:** on a first visit (no profile row), make the ritual primary and say why
in one line, and put "Invite someone" on this screen rather than behind "Groups & invites". Both are
product decisions about whether solo-first is the intended shape, which is why this pass reports
rather than invents — the queue item names this exact case.

### F2 — copy that asserts a profile the account doesn't have

Two strings are false for a new account, and both sit at the moment the user is deciding whether to
trust the thing:

- `/quick`: *"No vibe set — surprise us, **from your saved profiles**."*
- `/results` no-round branch: *"**Everything we need is saved** — it just needs a run."*

The honest fix is not a reword; it is knowing whether the profile is empty, which means either a
profile fetch on `/quick` (one GET, ~2 ms measured) or the first-run routing in F1. Same decision,
so it is reported with F1 rather than patched separately.

### F3 — the loading narrative goes static well before the match returns

Measured on the real page with the match request held open (samples at 1 s):

| t | on screen |
|---|---|
| 1.1 s | "Reading your tastes..." |
| 2.4 s | "Finding the overlap..." |
| 3.2 s | "Weighing tonight's mood..." |
| 4.6 s | "Choosing tonight's picks..." |
| 7 s, 14 s, … | "Choosing tonight's picks..." — unchanged |

`PhasedLoading` stops advancing once `index === lastIndex` and there is no spinner, no progress and
no cancel. The page is one centred line of text and nothing else. Against the 5–15 s budget in
`dev/plans/design-doc.md` — still the only latency estimate the project has, per
`dev/reports/2026-08-01-performance-audit.md` — that is up to ~10 s of a motionless screen on the
app's slowest and most important path, before any network throttling.

Handed to **item 8** (mobile/touch QA), which is scoped to judge exactly this on a throttled
connection. Flagged rather than fixed because the remedy — more phases, a spinner, a "still going"
line, a cancel — is a design choice inside DESIGN.md's calm brief, not an obvious repair.

### F4 — the landing CTA sits on the fold at 375 px

"Sign in with Google" measures `top: 782, bottom: 830` in an 812 px viewport: 30 px of a 48 px
button visible. On a 667 px-tall viewport (iPhone SE) it is fully below. The header's "Sign in" link
is always visible and mitigates it, so this is a note for item 7's sweep rather than a defect.

### F5 — a radiogroup with one option

With no groups, `GroupPicker` renders a single radio, pre-selected, that cannot be changed. It reads
as UI debris rather than a choice. Folded into F1 — if `/tonight` gets a first-run shape, this
disappears with it.

---

## Open questions for Sam

1. **Should a first visit be routed to the ritual?** (F1) The ritual is already the onboarding; only
   the routing is missing.
2. **Should "invite someone" be on `/tonight`?** (F1) It is the app's premise and currently its
   least prominent control.
3. **Should the ritual and quick screens adopt the results page's per-kind error headings**, or keep
   "Not tonight, apparently"? Behaviour is now consistent; only voice differs.

---

## What this pass did not cover

- **The results page with real recommendations for a first-time solo user.** Reaching it needs a
  live Anthropic call. Every *other* results state was exercised.
- **`thin_results` and `malformed` end to end.** Both are engine outcomes. The UI branch for each was
  verified by the tests added in `a7c707e`; the framing change is structural and applies to every
  kind identically, and `daily_limit` plus `monthly_cap` were both observed live.
- **An empty `titles` catalog.** Quick picks were seeded here, matching a post-seed deploy. An empty
  catalog is already tracked as a deploy-day blocker in `docs/deploy.md`.
- **Screenshots.** Item 7 owns the before/after captures; the evidence here is measurements, which is
  the stronger form for the claims made.
