# Open decisions awaiting Sam

**Purpose:** one place for every question that needs Sam's judgement. Agents kept surfacing these
correctly and then leaving them scattered across seven research docs, where each new session had to
re-discover them. This is the canonical list. When Sam answers one, record the answer here with a
date, and update the doc that raised it.

**Last updated:** 2026-08-02.

---

## Blocking a public launch

### 1. Lower `MONTHLY_MATCH_LIMIT` before sharing
**Raised by:** `docs/security/abuse-surface.md`
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

---

## Design calls

### 5. The genre-chip grid's `ash` borders
**Raised by:** `dev/handoff-2026-07-28.md`, screenshots in `dev/reports/screenshots/`
Raising every interactive border `slate` → `ash` is WCAG-conformant (verified) but a real visual change
to a deliberately quiet design. Corrected facts since it was first raised: the grid is **30 chips**
(16 mood + 14 genre), not the "~18" the older audit note claims, and they sit on **charcoal (5.44:1)**,
not midnight (6.21:1). Fallback if too loud: a mid-tone token, now a one-line edit.

### 6. The skipped-titles notice colour
**Raised by:** PR #29
The notice uses `text-amber`. DESIGN.md maps `--warning` to amber, but every other `text-amber` in the
app is a link, so it may read as interactive. `text-cream` is the one-line alternative.

### 7. The `users.name` scrub collateral
**Raised by:** `dev/research/2026-08-01-name-scrub-collateral.md`
Account deletion does word-boundary replacement of the departing user's display name across stored
prose. A user named Will, Grace or May rewrites that word throughout prose in every group that invited
them. **The framing that matters: this is an accident waiting to happen, not an attack** — it needs no
intent and has the same blast radius. Recommendation in the doc is render-time name resolution rather
than rewriting stored text, landed while there are zero production rounds to backfill. Explicitly *not*
recommended: a stop-word heuristic, which trades a visible garbling bug for a silent privacy-promise
failure for exactly the users with the commonest names.

### 12. What `/tonight` should offer an account with nothing saved
**Raised by:** `dev/reports/first-run-experience.md` (queue item 6)
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
`ANTHROPIC_API_KEY` unblocks four things at once: the `effort` sweep against Anthropic, real
`tokens_out` to replace the **estimated** 3,000-output-token figure that every cost table pivots on,
the live eval suite (stale since `PROMPT_VERSION` moved to `p1.2`), and the injection launch gate.
The GPT-5.6 sweep predicts the Anthropic effort sweep will find effort is a latency dial, not a
quality dial — so the economical setting is likely the low end.
