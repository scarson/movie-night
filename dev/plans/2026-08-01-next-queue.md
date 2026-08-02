# Next queue — items 6–10

**Written:** 2026-08-01, while items 1–5 of the current wave were in flight.
**Status:** item 6 shipped 2026-08-02. Items 7–10 remain planned and **not started**. Each is scoped to be dispatchable as a single agent.

**Update 2026-08-02.** Items 1–5 all shipped: prompt-injection threat model + corpus (PR #37),
abuse-surface and rate limits (#36), observability + deploy preflight (#39), Tier-2 cleanup (#35),
Phase 2 design + plan (#40). Two later results change the *context* for items below, not the items:

- **Item 10 (cost model) is now half-answered, and cheaper than scoped.** Four provider spikes landed
  (`dev/research/2026-08-01-cloudflare-ai-spike.md`, `-openrouter-spike.md`,
  `-subscription-arm-bakeoff.md`, `-gpt56-effort-sweep.md`) and establish the per-round comparison,
  concluding *stay on Anthropic direct*. What item 10 still owes is the **Anthropic-side** number: the
  3,000-output-token figure every cost table pivots on is an estimate, and only real `tokens_out` from
  the `matching_call` log line replaces it. Scope item 10 to that, not to a model built from scratch.
- **Item 7 (design QA) has two named inputs waiting.** Both open colour questions are catalogued in
  `dev/research/open-decisions.md` (#5 the 30-chip grid on charcoal, #6 the `text-amber` notice) — the
  sweep should present them with screenshots rather than resolve them.

The queue's sequencing note still holds, and its precondition is now met: item 7 was to start after the
design-adjacent PRs landed, and they have.

---

## The shape of what's left

Phase 1 is feature-complete, remediated, and verified end to end against a real Worker. What it has
never been is **experienced**. Every verification so far asked "does this behave correctly?" — none
asked "is this good to use, on a phone, by someone who has never seen it before?" Items 6–8 close
that gap. Items 9–10 are pre-public hygiene and the input to a spending decision.

**Deliberately NOT in this queue: executing Phase 2.** The design and plan are being written now, but
building the rating loop before anyone has used the recommender would be building on an unvalidated
base, and the plan's hardest questions are product judgments that need Sam. Phase 2 execution should
follow (a) Sam's review of the design doc and (b) the app actually shipping. Recorded here so the
omission reads as a decision rather than an oversight.

Everything below is unblocked by credentials. The remaining credential-blocked work (real TMDB seed,
live evals, the live adversarial injection pass, deploy) and the human-blocked work (screen-reader
pass) are tracked in `dev/handoff-2026-08-01.md`.

---

## 6. First-run experience and the states nobody designed — **SHIPPED 2026-08-02**

**Outcome:** `dev/reports/first-run-experience.md`. Three defects fixed under TDD (the matching error
taxonomy applied on one screen out of three; an unresolvable invite code with nowhere to go; the
no-round results branch with no way back). The main finding is a product call and is now
`dev/research/open-decisions.md` #12 — `/tonight` makes Quick match primary for an account with no
saved profile, and Quick match runs anyway. The loading narrative's 4.6-second freeze is measured in
the report and handed to item 8.


**Why this first.** A new user arrives with no profile, no group, no history, and no idea what the app
is for. Nothing in the codebase has ever been evaluated from that position. The smoke pass proved the
error *paths* work at the API level; it did not ask what the user sees. Empty, loading, and failure
states are where a pre-launch app is usually thinnest, and they are exactly what a first visitor hits.

**Scope.** Walk every route in the signed-out and brand-new-account states using the local-session
runbook (`dev/reports/2026-08-01-authenticated-a11y-verification.md`). For each surface, record what a
first-timer actually sees and whether it explains itself: the landing page, the ritual at step 0 with
an empty profile, `/groups` with no groups, `/tonight` with no group selected, `/results` for a session
with no rounds, the join-by-code page for an invalid or expired code. Then the failure states already
reachable without credentials: the typed matching errors (`provider_auth`, `left_group`, `monthly_cap`,
`round_limit`), a profile save that skips titles, and a slow or interrupted match.

**Judgment to apply.** Distinguish "missing" from "deliberately quiet" — this is a calm design by
intent, and the fix for an empty state is not always more words. Where copy is the answer, match
DESIGN.md's voice. Where the answer is a product decision (e.g. whether solo mode should be offered up
front), report rather than invent.

**Owns.** `src/app/**/page.tsx`, `src/components/**` for the surfaces it changes, plus a report at
`dev/reports/first-run-experience.md`. **Must not** change API contracts, auth, or matching logic.

**Verified by.** Real browser at both widths; jsdom for structure only. Any claim about what a user
sees must come from a browser, not a test.

---

## 7. Design-system QA sweep against DESIGN.md

**Why.** More than twenty PRs touched UI today — a new disabled treatment, a primary-button extraction,
`srcset`, an `aria-live` notice, two truncation fixes, chip caps. Each was locally correct and reviewed
in isolation. Nobody has looked at the result as a whole against DESIGN.md.

**Scope.** A designer's-eye pass for drift: spacing and rhythm, type scale, the amber hierarchy
(filled / outlined / text) used consistently for the same meaning, the `slate` vs `ash` boundary rule,
the new disabled treatment applied uniformly, and any control that has quietly diverged from its
siblings. Flag AI-slop patterns — gratuitous gradients, inconsistent radii, mixed icon weights — and
anything that reads as louder than the brief.

**Specifically open, and already flagged to Sam:** the `text-amber` notice colour introduced with the
skipped-titles message (DESIGN.md maps `--warning` to amber, but amber is otherwise links-only in this
app), and the genre-chip grid's `ash` borders at 30 chips on charcoal. Both are Sam's call; the sweep
should present them with screenshots rather than resolve them.

**Owns.** `DESIGN.md`, `src/components/**`, `src/app/**` presentation only, plus
`dev/reports/design-qa.md` with before/after screenshots. **Must not** change behaviour, and must not
re-litigate decisions already recorded in DESIGN.md's decisions log.

**Verified by.** Browser screenshots at 375px and 1280px. The contrast guard tests
(`control-contrast.test.tsx`, `person-color-contrast.test.tsx`) must stay green and must not be
weakened; their `ALLOWED` maps use exact-equality assertions.

---

## 8. Mobile and touch QA of the full ritual

**Why.** This is an app for two people on a sofa deciding what to watch. It is phone-first in every
way that matters, and phone behaviour has been verified only for reflow at 320px — a conformance
check, not a usability one.

**Scope.** Drive the entire ritual end to end on a phone viewport with touch emulation, signed in via
the local runbook: mood selection, the 30-chip grid, profile editing with the pickers' new caps, group
selection, the match request and its loading phases, the results tabs, and refinement. Check touch
target sizes against the 44px minimum, thumb reach for primary actions, scroll and sticky behaviour,
whether the keyboard obscures inputs, and whether `PhasedLoading` reads as progress or as a hang on a
slow connection. Include a throttled-network pass — the match path is inherently slow and that is where
a phone user decides the app is broken.

**Owns.** `src/app/**`, `src/components/**` for layout and interaction fixes, plus
`dev/reports/mobile-qa.md`. **Must not** change API or matching behaviour.

**Verified by.** Real browser with a mobile viewport and touch emulation. jsdom cannot evaluate any of
this; do not accept a jsdom test as evidence for a touch or layout claim.

---

## 9. Dependency and supply-chain review

**Why.** The app is about to be shared publicly and holds Google OAuth tokens, session material, and
an Anthropic key. Its dependency tree has never been reviewed. This is cheap and the right side of the
launch line.

**Scope.** Use the `dependency-check` skill's discipline on every production dependency: maintenance
status, known advisories, install-script behaviour, and whether anything is unnecessary. Pay attention
to the ones on the credential path — `arctic` and `jose` — and to `@opennextjs/cloudflare`, which sits
between the app and the platform. Note the postinstall scripts already surfaced by npm during installs
this session (`workerd` among them). Check lockfile integrity and whether any transitive dependency is
unmaintained. Also confirm no secret has ever been committed: scan history, not just the tree.

**Owns.** `package.json`, `package-lock.json`, plus `docs/security/dependencies.md`. **Must not** bump
majors or swap libraries without recording the reasoning; a version bump that breaks the Worker build
is worse than a stale-but-working dependency. Every gate plus the OpenNext build must pass after any
change.

---

## 10. Cost model and per-session spend projection

**Why.** `MONTHLY_MATCH_LIMIT` defaults to 2000 with no stated unit economics, and the abuse-surface
review (item 2, in flight) will surface per-user spend caps as a decision needing Sam. That decision is
unmakeable without knowing what a session actually costs.

**Scope.** Compute, offline and without calling Anthropic, what one match round costs in tokens: measure
the real assembled prompt at representative and worst-case sizes (a 200-title candidate block, two full
profiles, accumulated exclusions at the 100 cap), count tokens with the Anthropic tokenizer or a
defensible approximation, and multiply out by the published `claude-sonnet-5` rates. Then model a
session (up to 10 rounds, up to 4 calls per round on retry), a couple's month, and the current 2000-cap
ceiling. State clearly which numbers are measured and which are modelled.

**Deliverable.** `dev/research/cost-model.md`, with a recommendation for `MONTHLY_MATCH_LIMIT` and for a
per-user cap, expressed as "X sessions per couple per month costs Y" so Sam can pick a number against a
real budget rather than a round one. Note that prompt caching may apply to the static portions of the
prompt and say what that would change — verify against current Anthropic docs rather than assuming.

**Owns.** Documents only, plus a throwaway measurement script under `scripts/` if one helps. **Must not**
change `MONTHLY_MATCH_LIMIT` or any matching code; this informs a decision, it does not make it.

---

## Sequencing

6, 7 and 8 all touch presentation and would collide; run 6 first (it defines what the other two are
looking at), then 7 and 8 concurrently since one is static appearance and the other is interaction.
9 and 10 touch nothing either of them touches and can run alongside any of them.

None of the five depends on the in-flight wave landing, except that 7 should start after the
design-adjacent PRs from items 1–5 have merged, so it sweeps the final state rather than a moving one.
