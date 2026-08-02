# Open decisions awaiting Sam

**Purpose:** one place for every question that needs Sam's judgement. Agents kept surfacing these
correctly and then leaving them scattered across seven research docs, where each new session had to
re-discover them. This is the canonical list. When Sam answers one, record the answer here with a
date, and update the doc that raised it.

**Last updated:** 2026-08-02.

---

## Blocking a public launch

### 1. Lower `MONTHLY_MATCH_LIMIT` before sharing
**Raised by:** `docs/security/abuse-surface.md`; arithmetic now in `dev/research/cost-model.md`
**Update 2026-08-02.** The missing input is supplied. At the standard rate a round costs **~$0.076**
(input measured, output assuming the old 3,000-token figure), so the 2000 cap ceilings at
**$152/month** — $100 until the introductory rate lapses on 2026-08-31, and **$236** if thinking runs
hotter than assumed. The argument for lowering it is headroom, not dollars: 2,000 rounds is ~250
couples using the app weekly. A cap of **200** bounds exposure to ~$15/month and still supports ~25
couples. Sam picks the number; the arithmetic is now there to pick against.
The default is 2000 matches/month, which **models out** to roughly $80/month typical and $320 worst
case. That was never a considered number, and neither is the model precise: it rests on a per-round
output size of ~3,000 tokens that is **estimated, not measured** (see #11). Published input/output
rates are real; the token count they are multiplied by is not. Treat the figures as an order of
magnitude, and re-derive once a deployed match has produced a real `tokens_out`. Per-user limits now
exist (see below), so the global cap is the remaining exposure.

### 2. Are the four rate-limit numbers right?
**Raised by:** `docs/security/abuse-surface.md`
`match` 30/24h · `profileSave` 20/10min · `titleSearch` 120/10min · `groupJoin` 10/10min (pre-existing).
Each has a written justification in `src/lib/rate-limit.ts`. The daily match cap still lets one account
reach ~45% of the global monthly budget — a per-user *monthly* share was deliberately not invented.

### 3. Edge IP limiting for unauthenticated routes
**Raised by:** `docs/security/abuse-surface.md`
The OAuth callback forces one outbound Google token exchange per hit. No IP keying was added anywhere,
deliberately: user-keyed rows are bounded and self-pruning, IP-keyed rows are attacker-chosen and
unbounded, so an IP limiter in D1 becomes the amplifier. This belongs at Cloudflare's edge, not in the
app.

### 4. The live adversarial prompt-injection pass
**Raised by:** `docs/security/prompt-injection.md` §4 — **this is a stated launch gate and is NOT satisfied.**
The offline corpus (603 cases) is green and four real vulnerabilities were fixed. What remains needs a
real key: 12 specified rows, under $5, one afternoon. Rows 1–5 failing keeps the gate closed.

### 14. The engine invents a taste profile when it has nothing to go on — **PROMPT FIXED, OUTCOME UNMEASURED**
**Raised by:** the review of #12, 2026-08-02

**Status 2026-08-02.** The instruction is fixed (`PROMPT_VERSION` `p1.2` → `p1.3`); **whether the model
ever confabulated, and whether it now stops, is still unmeasured.** That distinction is the whole of
this entry's honesty: what shipped removes a directive that is wrong on its face, it does not repair a
behaviour anyone observed. `src/lib/matching.eval.test.ts` now carries a `solo with nothing saved` case
asserting empty `primaryVibes`/`genreAffinities` and a summary that admits the absence — it is skipped
until `ANTHROPIC_API_KEY` exists, and it is the measurement this entry is waiting on.

**What the problem was.** For an account with nothing saved the member block rendered three
`None selected` values and two `None` ones, and the mood line `No specific mood` — an absence that reads
as a description. There was no empty-profile branch anywhere in the engine, and `thin_results` does not
cover it: that fires on fewer than three surviving ids, which is about id resolution, not input richness.

**The pressure is the prompt directive, not the schema — an earlier draft of this entry had it
backwards and would have sent the next reader to fix the wrong file.** The solo directive at
`src/lib/matching.ts:355` instructs: *"summary restates the viewer's taste in your own words,
sharedVibes lists their strongest vibes"* — an imperative to describe a taste that has not been
stated. The schema's contribution is narrower than it first looks: `MATCHING_RESPONSE_SCHEMA`
(`src/types/matching.ts:52`, `:63`) marks `summary`, `primaryVibes`, `genreAffinities` and
`overlap.summary` **required**, and the call sends `output_config.format: json_schema`
(`src/lib/matching.ts:580-583`) — but there is **no `minItems` or `minLength` anywhere in the file**.
So the model can satisfy the schema exactly with `primaryVibes: []` and a `summary` that says there is
nothing to go on. Structured output compels the fields to be *present*; it does not compel their
contents. No schema change fixes this.

This is where F1's real defect lives, and fixing it here covers every path in — including the ritual
abandoner whose saved-but-empty profile a routing change would never have caught, since the predicate
reads `PromptMember`, downstream of every entry path.

**What shipped.** A `NOTHING SAVED:` marker line the builder alone writes; a taste-map directive built
for the members present rather than stated and then overridden; a predicate that reads what the prompt
will *render* rather than array length (`validateTagList` enforces a type and a maximum but no minimum,
so `vibes: [""]` is storable and would otherwise have suppressed the marker); and coverage of the
rough-day weighting, which could otherwise favour a member the prompt had just declared has no
preferences. The marker is unquoted because the injection corpus pins benign system prompts at zero
double quotes — that test caught the first wording.

**The cost, measured in characters:** the rule is 657 chars and the marker 68 per member, ~2% of a
representative prompt but **~30% of the system prompt**, making it the longest paragraph there. Dollar
cost is negligible (~$0.0006/round); instruction-weight dilution is the real cost and is unquantified.
`docs/security/prompt-injection.md` §4's rows 1–5 were specified against a system prompt without it.

---

## Design calls

### 5. The genre-chip grid's `ash` borders
**Raised by:** `dev/handoff-2026-07-28.md`, screenshots in `dev/reports/screenshots/`
Raising every interactive border `slate` → `ash` is WCAG-conformant (verified) but a real visual change
to a deliberately quiet design. Corrected facts since it was first raised: the grid is **30 chips**
(16 mood + 14 genre), not the "~18" the older audit note claims, and they sit on **charcoal (5.44:1)**,
not midnight (6.21:1). Fallback if too loud: a mid-tone token, now a one-line edit.

### 6. The skipped-titles notice colour
**Raised by:** PR #29, sharpened by `dev/reports/design-qa.md` (queue item 7)
The notice uses `text-amber`. DESIGN.md maps `--warning` to amber, and the concern was that every
other `text-amber` is a link, so it may read as interactive. `text-cream` is the one-line alternative.

**The sweep changed the shape of this.** Classifying all 18 `text-amber` sites: 13 interactive, 5 not.
"Amber is otherwise links-only" is not true — the invite-code display is static amber at 28px semibold
and nobody reads it as a link, because size and letter-spacing say otherwise. So the distinguishing
variable looks like **type treatment, not colour**, which adds a third option: keep amber and change
the notice's type treatment.

And a correction that matters to the choice: there is a **third** 14px-regular static amber site, the
session-summary line at `mood-screen.tsx:140`. Whatever is decided has to cover it too. (The report
first named only two; an independent review caught the miscount.)

### 7. The `users.name` scrub collateral
**Raised by:** `dev/research/2026-08-01-name-scrub-collateral.md`
Account deletion does word-boundary replacement of the departing user's display name across stored
prose. A user named Will, Grace or May rewrites that word throughout prose in every group that invited
them. **The framing that matters: this is an accident waiting to happen, not an attack** — it needs no
intent and has the same blast radius. Recommendation in the doc is render-time name resolution rather
than rewriting stored text, landed while there are zero production rounds to backfill. Explicitly *not*
recommended: a stop-word heuristic, which trades a visible garbling bug for a silent privacy-promise
failure for exactly the users with the commonest names.

### 12. What `/tonight` should offer an account with nothing saved — **SETTLED 2026-08-02**
**Raised by:** `dev/reports/first-run-experience.md` (queue item 6)

**Answered 2026-08-02** under Sam's delegated authority, after two independent design reviews with
opposed briefs (one to recommend a change, one to steelman leaving the screen alone). Both are
summarised in `dev/implementation-log.md`; the decisions are in DESIGN.md's log.

- **(a) Does a first visit route to the ritual? — No.** Declined, and the finding relocated. The
  motivating claim is that quick match "looks like the product working" for an empty account; the
  report that makes it also discloses it never saw that screen, because reaching it needs a live
  Anthropic call. Its supporting evidence does not close the gap either — the match route records the
  rate-limit hit *before* `runMatching` ("the round is billed the moment we ask"), so 30 `daily_limit`
  hits are equally consistent with 30 failed calls. Against it: the ritual is 3.77 screens with its
  Continue at y=2693 and nothing `sticky` anywhere (`dev/reports/mobile-qa.md`); `advance()` at step 0
  has no validation, so an abandoner saves five empty arrays and lands on the identical prompt having
  paid that scroll; and the predicate does not exist — `GET /api/user/profile` returns
  `emptyProfile()` for a missing row, so the "no profile row" this entry originally named is not
  observable through any API. **`dev/reports/first-run-experience.md` §F1 and
  `dev/reports/mobile-qa.md` §MQ-2 are findings from the same session pointing opposite ways, and
  neither cites the other.**
- **(b) Does "Invite someone" belong on `/tonight`? — Yes.** Both reviewers agreed it is separable and
  carries none of (a)'s problems. Shipped: it takes the existing footer slot when `groups.length === 0`
  and the fetch succeeded, as an outlined control, keyed off a fetch the hub already makes.
- **The two copy strings are fixed** — but *not* as a consequence of (a), which is how this entry
  originally framed them. Both are reachable without passing through the hub, and both had an honest
  reword available. `/quick` now reads "No vibe set — surprise us."; the no-round results branch reads
  "This session was set up but never matched. It just needs a run."
- **F5 is fixed** — a radiogroup of one is stated rather than offered.
- **Also fixed, and outside this entry's scope:** the entry CTAs were live before `/api/groups`
  resolved while `target` was still `""`, so a user with exactly one group who pressed Quick match in
  that window got a **solo** match, silently.

**What this decision moved rather than closed → see #14.**

**The finding as originally written, retained** — the answer above is the current state, and this is
what it was answering. Note that its closing claim, that settling (a) also settles the two copy
strings, is one of the things the reviews corrected:

Measured on a brand-new account: **Quick match** is the amber primary, the full ritual is the outlined
secondary, and "Groups & invites" is the smallest, lowest-contrast element on the page. Quick match
reads saved profiles and this account has none — nothing blocks it, and `matching.ts` renders the empty
lists as `"None selected"`, so the engine answers from popularity and mood alone and the result looks
like the product working. The ritual *is* the onboarding and it is good; it is simply not what a new
account is pointed at. Nothing on the screen invites the second person either, in an app whose premise
is two people.

Two decisions, both reversible and both cheap now: (a) does a first visit route to the ritual, with one
line saying why; (b) does "Invite someone" belong on `/tonight` rather than behind a footer link.
Settling (a) also settles two copy strings that currently assert a profile that isn't there — `/quick`'s
"from your saved profiles" and the no-round results branch's "Everything we need is saved".

### 12b. Does the design system get a named destructive control level? — **SETTLED 2026-08-02: yes**
**Raised by:** `dev/reports/design-qa.md` (queue item 7)

**Answered 2026-08-02.** `destructiveBoundaryClasses`, `destructiveControlClasses`,
`destructiveButtonClasses` and `compactDestructiveButtonClasses` now live in `control-classes.ts`,
pinned by `control-classes.test.ts` including a call-site guard against re-spelling the ember pair.
DESIGN.md's log carries the reasoning. Two corrections to how this was originally framed:

- **The omitted inert treatment was latent, not live.** The delete-account trigger at
  `profile/page.tsx` never sets `disabled` — it is unmounted by `{!confirming && …}` instead. So the
  divergence had no rendered consequence yet, which is precisely the state the 2026-08-01
  consolidation was in before it acquired one.
- **Nothing renders differently.** The composed strings carry the same utilities the three call sites
  spelled out, so this is consolidation with no visual change to review.

Contrast recomputed rather than inherited: ember boundary **4.70:1** on midnight and **4.12:1** on
charcoal against 1.4.11's 3:1; cream label 16.52:1; midnight-on-ember hover fill **4.70:1** against the
4.5:1 text floor. Ember never carries the label — that same 4.12:1 fails as text, which is why the
level is an outline that inverts on hover rather than a fill.
Three hand-rolled buttons — the leave confirm and both delete-account controls — share a
near-identical string that `control-classes.ts` does not name, and one of the three omits the inert
treatment the other two carry. That is the same shape as the 2026-08-01 consolidation (eight sites,
five strings, nothing able to say which was canonical). Not done in the sweep, because naming a
fourth control level extends DESIGN.md's decisions log rather than applying it. Recommendation:
`destructiveButtonClasses` + a compact sibling, pinned like the other four.

### 13. Should the pre-results screens adopt the per-kind error headings?
**Raised by:** PR for queue item 6
The error *behaviour* is now consistent across all three screens — no screen offers a retry that cannot
succeed. Only the heading differs: `/results` names the failure ("That's today's last round",
"You've left this group"), while `/ritual` and `/quick` keep their own "Not tonight, apparently" for
every kind. Deliberately left alone: that heading is voice, not correctness. One-line change either way.

---

## Phase 2 — the post-watch rating loop

**Raised by:** `dev/plans/phase-2-design.md`, which lists all nine in full. The two that most shape the
product:

### 8. Is the three-point scale right, and are these the labels?
`not for me / good / loved it`. Cheap to change now, expensive after real data exists.

### 9. Should the Taste Autopsy question be rewritten?
It asks *"what surprised you about your partner's reaction"* — one member's evaluation of another,
persisted and fed to a model. The design agent's judgement is that it is the one genuinely bad idea in
the reserved schema, and notes plainly that Sam approved it, so it is his to keep or cut.

The remaining seven (rating undo, reveal expiry, tension-axis gates, per-user vs group exclusion,
"you keep not watching what we suggest", 3+ member reveal, watch-log undo) are in the design doc under
§Open questions.

---

## Provider and cost

### 10. Does the provider question stay closed?
**Raised by:** three spikes — `2026-08-01-cloudflare-ai-spike.md`, `-openrouter-spike.md`,
`-subscription-arm-bakeoff.md`, `-gpt56-effort-sweep.md`
All four conclude **stay on Anthropic direct**. The strongest single argument against migrating is not
cost: with the JSON Schema removed from the prompt, *both* frontier models scored 0/8, so
`output_config.format` is load-bearing and any swap that loses strict structured-output enforcement
loses more than it saves. Guardrail effectiveness is also model-specific, so a second provider must
clear the injection gate independently, forever.

### 11. The one measurement that would firm up every cost table
**Update 2026-08-02.** Sharpened by `dev/research/cost-model.md`: the 3,000-token output figure is
not an estimate of the *response*, it is an unlabelled **thinking** budget. The call sends
`thinking: adaptive` at `effort: "medium"`, so billed output is thinking + JSON, and the JSON alone
measures at ~836 tokens. What one served match reveals via `tokens_out` is therefore the thinking
volume — the only genuinely unknown term left in the cost model.
`ANTHROPIC_API_KEY` unblocks four things at once: the `effort` sweep against Anthropic, real
`tokens_out` to replace the **estimated** 3,000-output-token figure that every cost table pivots on,
the live eval suite (stale since `PROMPT_VERSION` moved to `p1.2`), and the injection launch gate.
The GPT-5.6 sweep predicts the Anthropic effort sweep will find effort is a latency dial, not a
quality dial — so the economical setting is likely the low end.
