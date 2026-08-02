# Phase 2 Design — The Post-Watch Rating Loop

**Date:** 2026-08-01
**Base:** `origin/dev` @ `f09d375`
**Companion:** `dev/plans/phase-2-implementation-plan.md` (the *what*; this document carries the *why*)
**Status:** **DRAFT — input to a brainstorming conversation, not a substitute for one.**

---

## 0. Read this first — what this document is, and what it is not

`CLAUDE.md` requires `superpowers:brainstorming` before any new feature or creative work, and
brainstorming is a dialogue with Sam. Sam is away. That conversation could not happen, so **this
document is written as input to it, not as its output.**

Two consequences, both deliberate:

1. **Where the code or an approved design document clearly implies an answer, I take a position and
   say why.** Those are marked **POSITION**. A reviewer should be able to check each one against the
   cited evidence and either agree or overrule it in one step.
2. **Where the answer is a genuine product judgment, I leave it open** — collected in §9, with my
   recommendation and a stated default so the plan is executable if Sam never answers. Those are
   marked **OPEN**. A plan that quietly resolved them would be worse than no plan, because it would
   hide the decision inside an implementation detail where nobody reviews it.

One position in this document (§4.4) **contradicts a decision in the approved design doc**. It is
called out as a challenge, not as a resolution. Sam decides.

**Also for the record:** `CLAUDE.md`'s skill-routing rule says to ask Sam whether to use superpowers
or gstack when both systems cover a domain. Brainstorming is such a domain (`superpowers:brainstorming`
vs. `/office-hours`). That question could not be asked either — which is the second reason this is
framed as input. `/office-hours` remains available to Sam.

---

## 1. Why this is the next increment

`migrations/0001_initial_schema.sql:115-145` creates `watch_history`, `watch_ratings` and
`tension_axes` empty, under the comment *"Phase 2 tables (empty in Phase 1; avoids a migration
later)"*. Nothing in `src/` reads or writes any of the three. The schema is a promise Phase 1 made
and did not keep.

Phase 1 is a one-shot recommender: every session starts from the same two inputs (saved profiles,
tonight's mood) and the app forgets everything the moment you close it. The design doc's own success
criteria include *"After 4+ sessions, the matching visibly improves"* (`dev/plans/design-doc.md:454`)
— which is currently unachievable by construction. The rating loop is what closes the circle.

**Scope of this document.** The design doc's Phase 2 list is much larger than the rating loop —
Vectorize, embeddings, candidate pre-filtering, a Sonnet/Opus A/B, TV support. This design covers
**only the post-watch rating loop**: logging what was watched, capturing how it landed, and feeding
that back into matching. Everything else on that list is explicitly out (§8) and independent — the
rating loop does not depend on embeddings, and embeddings do not depend on ratings.

---

## 2. The loop, end to end

The premise of the product is reducing friction on a night in. A rating loop is the single easiest
feature in this app to turn into a chore, so the shape below is driven by one rule: **the app must
never stand between the couple and the film.**

### 2.1 The five steps

```
  ┌── /results, after a round ──────────────────────────────────────┐
  │  Each pick already has ♥ keep / ✕ remove.                       │
  │  A third control appears: "We watched this" (solo: "Watched")   │
  │  → one tap, no dialog, no rating. writes watch_history.         │
  └────────────────────────────────────┬────────────────────────────┘
                                       │  they watch the film
                                       ▼
  ┌── next visit to /tonight ───────────────────────────────────────┐
  │  Above "who's watching tonight?", one quiet question:           │
  │      "How was Arrival?"   [ not for us ] [ good ] [ loved it ]  │
  │      + optional one-line note, + "skip"                         │
  │  → one tap ends it. writes watch_ratings.                       │
  └────────────────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
  ┌── the reveal (groups of 2+ only) ───────────────────────────────┐
  │  Once BOTH have rated, both see both ratings — never before.    │
  │  If your partner hasn't rated, you see "Ben hasn't said yet".   │
  └────────────────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
  ┌── the next matching round ──────────────────────────────────────┐
  │  Watched titles are gone from the candidate pool (code, not     │
  │  prompt). The last ≤10 watches and their ratings enter the      │
  │  prompt as reasoning material.                                  │
  └────────────────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
  ┌── weekly, in the existing cron ─────────────────────────────────┐
  │  Groups with ≥3 both-rated nights get their tension axes        │
  │  recomputed. Those enter later prompts and the taste map.       │
  └─────────────────────────────────────────────────────────────────┘
```

### 2.2 Why the rating is asked later, not at logging time

**POSITION: logging a watch and rating it are two different moments, separated by the film itself.**

Tapping "we watched this" happens as the couple gets up to put it on. Asking "how was it?" then is
nonsense — they haven't seen it. Asking immediately *after* the film is worse: it is 11pm, and the
last thing a good evening needs is a form.

The design doc already specifies the right moment: *"Next time the couple opens the app after
watching a recommendation, prompt: 'How was [movie]?'"* (`dev/plans/design-doc.md:518`). `/tonight`
is exactly that surface — it is the signed-in hub, it already loads the caller's groups, and the
question sits naturally above "who's watching tonight?" as the thing you deal with on the way in.

Consequences that follow from this and are worth stating:

- **The rating prompt never appears on `/results`.** A couple who has just logged a watch and
  reloads the page must not be asked to rate a film they are about to start.
- **At most one question at a time.** The newest unrated watch, nothing else. A queue of five
  questions is a chore; one is a greeting.
- **Questions expire.** A watch older than `RATING_PROMPT_WINDOW_DAYS` (default 21) stops being
  asked about. Nobody remembers how a film felt five weeks ago, and a stale question that will never
  be answered is permanent clutter on the hub.

**One tap by either member logs the watch for the group** — not a two-sided confirmation. Requiring
both to confirm doubles the friction on the one action that has to be frictionless, and gets the
answer wrong in the common case where only one phone is in reach. The cost is that a member can be
asked to rate something the group logged and they did not personally see (§2.5 raises the same case
for the off-app path). **Skip is the answer**, and it costs one tap. That is the right trade at this
scale, but it is a trade, and it is the reason skip has to be a first-class control rather than
buried.

### 2.3 What they rate

Two fields, one of which is optional:

| Field | Column | Shape |
|---|---|---|
| How it landed | `watch_ratings.rating` | `1` not for us · `2` good · `3` loved it · `NULL` skipped |
| An optional note | `watch_ratings.surprise_feedback` | free text, ≤200 chars, private to its author (§4.4) |

**POSITION on the three-point scale, held lightly** — see **OPEN-1**, this is a genuine product
judgment and the integers are cheap to change now and expensive later.

The argument for three: the consumer of this signal is a language model, not a statistics engine.
"Alice: loved it. Ben: not for us." plus one sentence gives Claude far more to reason with than
"3.5 vs 4.0", and a five- or ten-point scale invites the deliberation the product exists to remove.
DESIGN.md's 44px touch targets and mobile-first layout also mean three controls fit on one row at
375px and five do not without shrinking below the floor.

**POSITION: `NULL` means *skipped*, and that is what the nullable column is for.**
`watch_ratings.rating` is nullable in the reserved schema. Reading that as "skipped" rather than
"not yet rated" is what makes the whole prompt loop terminate: a skip writes a row, the row means
"don't ask me again", and no new column or dismissal state is needed. §4.3 shows why this also
happens to be the privacy-safe reading.

**POSITION: a submitted rating is frozen.** No edit affordance. If ratings were editable after the
reveal, the second rater could see the first rating and revise — reintroducing exactly the anchoring
the blind rating exists to prevent, just later. A mis-tap is a real cost; **OPEN-5** asks whether an
undo window is worth the machinery.

### 2.4 What they get back for it

This is the question a rating loop usually fails. The honest answer has to be visible without a new
surface, because a stats page is both scope and the wrong idea (§4.5).

1. **The reveal.** For a couple, the moment where both ratings appear at once is itself the reward.
   It is small, it is about the two of them, and it costs one read.
2. **The next round reads different.** The matching prompt is told about the last watches and is
   instructed to use them in its reasoning. The payoff shows up as
   *"you two didn't get on with the last slow-burn we sent, so this one earns its running time"* in
   the same `explanation` and `conversational` fields the app already renders. No new UI, and it is
   the payoff the product actually promised.
3. **Nothing comes back twice.** Watched titles leave the candidate pool. That is a silent benefit,
   but it is the one users notice when it is missing.

### 2.5 Watching something the app didn't suggest

`watch_history.recommended_in_session_id` is **nullable** in the reserved schema. That is not an
accident of convenience — it is the schema anticipating a watch that no session produced.

**POSITION: include the off-app path, as a quiet secondary entry on `/tonight`.** Without it the
history the engine learns from contains only the app's own successes, so the engine can never learn
about its misses — the couple ignored all seven picks and watched something else, and the app records
that as *nothing happened*. That is the single most informative event the loop can capture, and
dropping it biases every downstream signal.

It reuses `TitleSearch` and `/api/titles/search`, which already merges TMDB results beyond the seeded
catalog, so an arbitrary film is findable. The one non-obvious requirement is that logging a watch of
an off-catalog title must enrich it into `titles` the same way `PUT /api/user/profile` already does
(`src/app/api/user/profile/route.ts:152-192`) — otherwise the title never hydrates and the prompt
cannot name it. The plan extracts that block into a shared helper rather than copying it.

This is marked droppable in the plan (task G5-5) because it is the only part of the loop that adds a
new entry point rather than an affordance on an existing one.

**Its sharpest edge:** a watch is the *group's*, so one member logging a film they watched alone
under the shared group produces a question for a partner who never saw it. Skip handles it, and the
alternative — a per-member "was I there?" confirmation — is a second question in service of avoiding
a first. Accepted, and worth watching if it turns out to be common.

---

## 3. Solo mode

`__solo__` is a real path, not a degenerate one. Everything below falls out of "a group of 1" without
special-casing, except for two things that need care.

| Concern | Behaviour |
|---|---|
| `watch_history` | Unchanged. `group_id` is the solo group. |
| `watch_ratings` | One row. There is no second rater, so no reveal machinery runs. |
| The question | Identical, in first person: *"How was Arrival?"* — not "how was it for you two". |
| `tension_axes` | **Structurally zero.** The table is pairwise (`user_a_id`, `user_b_id`); a group of one has no pairs. No guard needed — the schema is right here. |
| The prompt | `buildMatchingPrompt` already branches on `input.solo` for the role line, taste map and tone. The watch-history block takes the same branch and renders in first person. |

**The trap: do not reuse the session-scoped `solo` flag for a group-scoped feature.**
`getSessionForMember` derives `solo: member_count < 2` from `session_members` for *that session*
(`src/lib/movie-sessions.ts:262`). Watch history is keyed on **group**, not session, and the two can
disagree — a group that gained a second member since the session was created is not solo today. The
rating UI must derive "is there anyone else to reveal to" from the group's live membership. Getting
this wrong is exactly the shape of bug B9, where a `member_count` that counted the wrong rows made
`solo` disagree with the prompt's actual membership.

**Second trap: a partner who deleted their account can never complete a pair.** `deleteAccount`
anonymizes `session_members.user_id` to a random sentinel and deletes the `users` row
(`src/lib/account.ts:148-156`); the same treatment applies to `watch_ratings`. The reveal gate must
count members with a **live `users` row**, or the survivor sits at "Ben hasn't said yet" forever for
a Ben who no longer exists.

---

## 4. The privacy shape

This is the hard part, and it is hard for a specific reason: **a rating is an opinion about a shared
experience, held by one person, in a product whose whole subject is the relationship between two
people.** The rough-day toggle established the codebase's precedent for that class of data; the
lesson it taught is stronger than "hide the flag".

### 4.1 The precedent, stated precisely

DESIGN.md:124 records what the Phase 1 bug hunt actually found:

> An earlier draft of this doc suggested the taste map could say "tonight's picks lean toward [name]'s
> preferences" as a supposedly-anonymous hint. That is not anonymous in the common case: in a group of
> two, the favored member is by definition the one who did *not* toggle.

So the invariant is not "don't display private inputs". It is:

> **No output field — value, presence, or absence — may be a readout of another member's private
> input.**

Bug B8 was the same shape a second time: a note whose *presence* was the leak. Both fixes live in
`computeWeightNote` (`src/lib/matching.ts:252-266`), which names the favoured member to the model,
marks the instruction PRIVATE, and forbids the model from surfacing it in any output field.

Every privacy decision below is that invariant applied to ratings.

### 4.2 Does each person see the other's rating? — POSITION: yes, but only simultaneously

Three candidate designs, and why two of them fail:

**(a) Ratings are private forever.** Each member sees only their own; the model sees both. Safe, and
wrong. They watched the film in the same room — they already know roughly how it landed for the other
person. Hiding it is theatre, and it kills the shared ritual that is the product's whole premise.

**(b) Ratings are visible as soon as they are given.** The second rater anchors on the first.
"Ben said good, I'll say good." The signal degrades to politeness, and — worse — the app becomes a
place where you can check what your partner thought before committing. That is a scoreboard.

**(c) Simultaneous reveal.** Each rates blind; both ratings become visible to both the moment both
exist. **This is the position.**

It is not a new idea in this project — it is Approach C from the design doc
(*"Neither sees the other's answers. Results drop as a shared 'reveal' moment"*,
`dev/plans/design-doc.md:127`), which was set aside for Phase 1 because it needed real-time
coordination. At this scale it needs none: the "reveal" is a read-time check for whether the sibling
row exists. The expensive part of Approach C was never the reveal; it was the live coordination, and
a rating asked days apart has no live coordination to do.

**The rule, precisely:**

- Before you have rated, the API tells you **nothing** about whether your partner has rated. Not the
  rating, not the fact of it. Knowing "Ben already answered" is mild pressure and is exactly the kind
  of presence-as-readout the rough-day bug was.
- Once you have rated: if your partner has a non-`NULL` rating, both are shown. Otherwise you see
  *"Ben hasn't said yet"* — which is true, and stays true.
- **There is no timeout reveal.** A reveal that fires after N days without the partner rating hands
  your rating to someone who gave nothing. Unrevealed simply stays unrevealed, and the copy is honest
  about it.
- **Separately, a *completed* reveal is only offered for a while.** There is no per-user "seen"
  state — adding one costs a column — so a completed reveal is surfaced on the hub for seven days and
  then stops. These two rules sound contradictory and are not: the first is about what *triggers* a
  reveal (nothing but both ratings ever does), the second about how long a triggered one is *offered*.
  **The window runs from when the pair completed, not from when the film was watched.** Measuring it
  from `watched_at` would mean a partner who answers on day eight produces a reveal nobody is ever
  shown — the loop would silently swallow its own payoff in exactly the case where the couple took
  their time.

**A residual risk, stated rather than papered over.** Even with the reveal held back, a member can
sometimes infer their partner's view from the *next round's prose*: the model reads the notes and the
ratings, and although it is forbidden to attribute or quote them, a paraphrase like "the ending is
what didn't work last time" narrows the field. This is the same residual risk the rough-day weighting
carries — the model reasons from private input, and reasoning leaves traces. It is not eliminable
without withholding the signal entirely, which would defeat the feature. What *is* eliminable, and is
eliminated, is attribution.

### 4.3 What a skip means, and why it is indistinguishable from silence

A skip writes `rating = NULL`. The reveal gate requires **both ratings non-`NULL`**, so a skip leaves
the pair unrevealed.

This is load-bearing in two directions:

- **It closes the extraction hole.** If a skip counted as "rated" for reveal purposes, tapping skip
  would buy you your partner's rating for free. It cannot.
- **It protects the skipper.** To the partner, a skip is indistinguishable from not-yet-answered, and
  the copy — *"Ben hasn't said yet"* — is literally true, because a `NULL` is not a rating. A UI that
  said *"Ben passed on this one"* would be more honest and would also broadcast "he didn't want to
  score it", which in a couple reads as "he hated it". The protective reading wins, and it costs no
  accuracy.
- Its author sees their own state as *"you skipped this one"*. Only they do.

### 4.4 The `surprise_feedback` column — a challenge to an approved decision

**This is the one place where I think the reserved schema encodes a bad idea, and it comes from a
decision Sam approved. I am flagging it rather than resolving it.**

The design doc's Taste Autopsy mechanic (`dev/plans/design-doc.md:104`, restated at :151 and :518)
specifies the second question as:

> *"what surprised you about your partner's reaction"*

That asks person A to write an evaluative statement **about person B** and persist it. Three problems,
in increasing order of seriousness:

1. **If it is ever shown to B**, it is by construction the most personal text this app holds, and the
   most likely to land badly. *"I was surprised you cried at that."*
2. **If it is never shown to B**, the app is storing one partner's covert commentary on the other,
   under a privacy policy that opens with *"This data deserves respect"*
   (`dev/plans/design-doc.md:50`).
3. **It feeds the prompt.** Claude will paraphrase it. The rough-day bug was precisely this shape — a
   private input reaching shared prose through model output — and it shipped despite the guardrail
   being written down, because nobody had asked what the model would *do* with the field.

**RECOMMENDATION (needs Sam's decision — see OPEN-2): keep the column, change the question.**
Ask about the film and the evening, in the first person — *"Anything catch you off guard?"* — and
treat the answer as private to its author. That keeps the rich free-text signal, which is the thing
that actually makes the model good, and drops the framing that makes it a liability.

If the recommendation is accepted, the handling is:

- **Never rendered to another member.** Not on reveal, not anywhere. (Whether it *should* appear on
  reveal is **OPEN-3**; the safe default is no.)
- **Does enter the prompt**, sanitized and clamped, under the same PRIVATE treatment `computeWeightNote`
  uses: available for reasoning, forbidden in output.
- **Nulled on account deletion.** It is the departing user's own text, not a shared record, and the
  privacy policy promises personal data is removed.

The column name stays `surprise_feedback`. Renaming a column in an empty table is free, but the name
still describes what it holds (something that surprised you), and `CLAUDE.md`'s naming rules forbid
renaming things to record that they changed.

### 4.5 Disagreement, `tension_axes`, and the scoreboard problem

`tension_axes` stores `axis_name`, `description`, `position_a`, `position_b`, `confidence`. That is a
deliberate choice to **model** disagreement rather than average it away, and it is right. The
question is what it is safe to *show*.

**The distinction that makes this tractable:**

| | A tension axis | A scoreboard |
|---|---|---|
| Subject | taste | outcome |
| Example | "Alice needs narrative payoff; Ben is at home in ambiguity" | "Alice 2, Ben 5 — Alice was wrong" |
| Symmetry | neither position is the correct one | one person picked badly |
| Provenance | many nights, abstracted | one film, raw |

The app **already ships** the left-hand column: `tasteMap.overlap.tensionPoints` is described in the
design doc as *"specific conflicts between members, referenced by name"*
(`dev/plans/design-doc.md:323`), it is generated on every round, and it is rendered by
`src/components/taste-map.tsx`. Naming a taste conflict in shared output is established, approved
behaviour. What is new in Phase 2 is that the axis becomes **persistent and evidence-backed** rather
than re-improvised each round.

**POSITION: tension axes are shared output. Individual ratings of a specific film are not, except
through the reveal.** The axis is the abstraction that makes disagreement safe to name — symmetric,
about taste, with no winner, and derived from enough nights that it is an observation rather than a
stereotype. That is precisely why `tension_axes` is its own table with a `confidence` column instead
of a view over `watch_ratings`.

Two guards this requires, both of which are invariants, not preferences:

1. **A minimum evidence bar, and a confidence floor.** An axis computed from one disagreement is a
   stereotype, and getting it wrong in shared output — *"Ben doesn't care about endings"* — is a real
   relational harm, not a UX defect. Default: **no axes computed at all below 3 nights rated by both
   members**, and **no axis shown below `confidence` 0.6**. Numbers are tunable (**OPEN-4**); the
   existence of both gates is not.
2. **An axis must never cite a specific title in shared output.** If the group has exactly one
   both-rated night and the axis names that film, the axis *is* the reveal. Even above the evidence
   bar, naming titles turns an abstraction back into raw evidence. This is a prompt constraint of the
   same class as the rough-day one, and it belongs in the same guardrail sentence.

**A property worth noticing, because it is what makes the whole thing safe.** The evidence bar and
the reveal gate are the *same predicate*: "this night was rated, non-`NULL`, by both members". So an
axis can only ever be built from nights whose ratings were **mutually disclosable** — every piece of
evidence behind an axis is something both members were entitled to see. The axis is therefore an
abstraction over disclosed material, not a back channel around the gate. That is not a coincidence of
the numbers; it is why the gate is defined on the same predicate, and it should stay that way if
either number is tuned (**OPEN-4**).

**And the corresponding output ban.** The matching prompt receives per-member ratings by name,
because "this worked for Alice and not for Ben" is the entire tension signal and an anonymized
aggregate destroys it. But the engine has no idea which pairs are revealed, and should not have to:

> **The prompt must forbid attributing any past rating to any member in any output field**, and
> forbid stating that anyone declined to rate. The model may say *"the last slow-burn didn't land"*.
> It may not say *"Ben didn't like the last slow-burn"*.

This is over-restrictive for revealed pairs, deliberately. It is one rule instead of a rule that
depends on state the engine cannot see — and every leak in this codebase so far has come from a rule
that depended on state somebody forgot to check.

### 4.6 Group-scoped, not user-scoped

`watch_history.group_id` — the reserved schema scopes history to the group, not the person. So a film
you watched with your partner can still be recommended to you in a solo session, and vice versa.

**POSITION: follow the schema.** The privacy argument is decisive in one direction and merely
inconvenient in the other: user-scoped history means what you watched with one group silently shapes
what another group is shown, and "what you watched with your ex" surfacing in a new group's reasoning
is a serious harm. Group-scoping is the safe default and it is what the schema says.

The cost is real — "never recommend what I've seen" is a per-person truth, and the group-scoped
version gets it wrong for anyone in two groups. **OPEN-6** asks whether a per-user *exclusion*
overlay (excluding without explaining) is worth adding later. It would be additive, not a rewrite.

---

## 5. How the signal feeds matching

### 5.1 Where it enters

Three seams, all of which already exist:

| Seam | File | Change |
|---|---|---|
| Candidate pool | `selectCandidates` (`src/lib/matching.ts:102`) | new required `watchedIds` parameter, filtered unconditionally |
| Round context | `getMatchRoundContext` (`src/lib/movie-sessions.ts:341`) | a sixth statement in the existing `db.batch` |
| Prompt | `buildMatchingPrompt` (`src/lib/matching.ts:269`) | a new block in the user message; guardrail extended |

The round-context read is free in round-trip terms: `getMatchRoundContext` already batches five
statements into one D1 request (the PLAT-2 pattern), and a sixth rides along. The one signature
change is that it needs the group id as well as the session id — history is group-scoped and the
route already holds `session.groupId`.

### 5.2 The exclusion is code, not prompt

The design doc states the contract flatly: *"Never re-recommend watched films"*
(`dev/plans/design-doc.md:153`). The campaign's D1 decision established what that has to mean here:
the identical guarantee for *removed* titles was prompt-only, and the fix
(`dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md`, G2-2) filtered the pool in code, made
the parameter **required rather than optional-with-a-default** — *"an optional parameter is how a
future call site silently opts out of the guarantee"* — and added no pool floor.

Watched titles get exactly the same treatment, with **one deliberate asymmetry that an implementer
copying G2-2 will get backwards:**

> A removed title is excluded **even if it is on a member's own list**. A watched title is excluded
> **unless it is on a member's comfort list**.

The reasoning is that the two lists mean opposite things. A removal is a rejection this session, and
"never return" has no exception. A comfort title is an explicit *"I rewatch this"* — it is the
existing, user-controlled escape hatch for a film you have seen and want again, and it is the reason
Phase 2 needs no "recommend it anyway" control. A **watchlist** title gets no exception: a watchlist
entry means "I haven't seen this", and once it has been watched it should stop coming back.

(Under `discoverNew`, comfort titles are already excluded from the pool anyway, so the exception is
moot there and the two filters cannot fight.)

**We do not remove a watched title from anyone's watchlist.** That would be a write into another
user's profile across a privacy boundary, for a cosmetic gain.

### 5.3 What enters the prompt

The design doc's Reviewer Concern #4 already set the bound: *"include only the last 10 watched movies
and the 3 strongest tension axes"* (`dev/plans/design-doc.md:529`). Honour it.

Sketch of the block, in the line-oriented style the rest of the user message already uses:

```
WHAT THEY'VE WATCHED (most recent first — never recommend any of these again):
- Arrival (tmdbId 329865), 3 weeks ago — Alice: loved it; Ben: good. Alice noted: the ending got me.
- Hereditary (tmdbId 493922), 5 weeks ago — Alice: not for us; Ben: hasn't said.

HOW TO USE THIS (PRIVATE — apply silently): these are evidence about why things work for
them, not a genre to repeat. Never attribute a past rating to a member in your output, never
say who liked or disliked anything, and never mention that someone did not rate something.
```

Cost is ~10 lines against a CANDIDATES block of 7,000–9,000 tokens. Negligible.

Every user-controlled string in it — titles, member names, notes — goes through `sanitizePromptText`
with a per-field cap, per D5. Notes are third-party-adjacent free text in a line-oriented block, and
that is exactly the surface D5 was written about.

`PROMPT_VERSION` moves from `p1.1` to `p2.0`. It is persisted per round in
`recommendations.prompt_version`, so Phase 1 rounds stay interpretable.

### 5.4 History versus the stated profile

The two can disagree — a profile is what you say you like, history is what you actually liked.
Leaving the model to guess the precedence is how you get a system that silently overrides a
dealbreaker because "they seemed to enjoy that one horror film".

**POSITION, stated in the prompt rather than implied:**

> **The stated profile sets the space. History adjusts within it. A dealbreaker is never overridden
> by history.**

Dealbreakers are the user's only hard control over the engine, and silently overriding one is the
worst failure mode this product has. History is also small-N and noisy for a long time — three
ratings is not a taste model.

### 5.5 What stops accumulated history from collapsing diversity

The real risk: they rate two thrillers highly, the engine leans thriller, they watch more thrillers,
the loop tightens, and by month three the app is a thriller vending machine.

Four guards, in descending order of how much I trust them:

1. **Watched-exclusion is itself anti-collapse.** The pool loses the engine's own past outputs every
   round. A recommender that cannot repeat itself cannot converge on a single film, and structurally
   resists converging on a narrow set.
2. **History never narrows the candidate pool.** `selectCandidates` pulls
   `popularity DESC LIMIT 250` plus member-referenced titles
   (`src/lib/matching.ts:108-113`). History **subtracts** (exclusions) and **explains** (prompt text).
   It is never allowed to become a filter or a ranking input at the SQL layer. This is the strongest
   structural guarantee and it is worth writing down as an invariant, because "just boost the genres
   they liked" is the obvious next change and it is the one that ruins this.
3. **An explicit instruction** that history explains *why* something worked rather than *what to
   repeat*, plus a standing requirement that at least one pick per round sits outside the pattern
   history suggests.
4. **`discover_new` already exists** as a per-session user control.

**Honesty about what is testable.** Guards 1 and 2 are provable in unit tests: assert a watched id is
absent from the pool, assert the pool query is unchanged. Guard 3 is **not** — a unit test can assert
the instruction is present in the prompt string, and nothing more. It cannot assert the model obeys
it. That belongs in `src/lib/matching.eval.test.ts` (live, `RUN_LIVE_EVALS=1`, currently never run
for want of an API key). The plan says so rather than dressing a string assertion up as a behavioural
one.

### 5.6 Where tension axes are computed

Options considered:

| Where | Verdict |
|---|---|
| Inline in the matching round | **No.** Adds a second Claude call to the app's most latency-sensitive request, and the response schema would have to carry it. |
| On rating submission | **No.** A 5–15s Claude call behind a one-tap "loved it" is the chore this design exists to avoid. |
| `ctx.waitUntil` after the round | **No.** `worker.ts:17-19` already records that `waitUntil` swallows failures into a successful invocation; and CLAUDE.md forbids guessing about Workers behaviour, which is what asserting its availability inside an OpenNext route handler would be. |
| **The existing weekly cron** | **Yes.** |

**POSITION: axes are computed by the weekly cron.** `worker.ts` already has `scheduled()` →
`runWeeklyRefresh` on `0 9 * * 1`. `tension_axes.computed_at` / `updated_at` are exactly the columns
a batch job writes. The cadence matches the product's own framing — *"gets better every Friday"* — and
it keeps a Claude call off every user-facing path.

This gives Phase 2 a **fast path and a slow path**, which is the right split rather than a compromise:

- **Fast (same night):** a rating enters the next round's prompt immediately, via the last-10 block.
- **Slow (weekly):** axes are a relationship model, and a relationship model that changes on Tuesday
  because of one film is not a model.

**Budget constraint, non-negotiable.** `STALE_TITLES_LIMIT = 200` in `src/lib/cron-handler.ts`
already assumes Workers Paid (10,000 subrequests); on Free it exceeds the 50-external limit. Axis
computation adds Anthropic subrequests to the *same* invocation's budget, so it needs its own cap
(default 20 groups per run) and must not silently eat the refresh's allowance.

---

## 6. The schema: where it is right, and where it needs migration

### 6.1 Where the reserved schema is right — do not "fix" these

- **`watch_history` is group-scoped** with `(tmdb_id, content_type)` mirroring `titles`'s composite
  primary key. Correct on both counts (§4.6, and TV support later needs no rename).
- **`recommended_in_session_id` is nullable.** The schema anticipated the off-app watch (§2.5).
- **`watch_ratings.rating` is nullable.** That is the skip state (§4.3).
- **`watch_ratings` is keyed on `(watch_history_id, user_id)` conceptually** — per-member ratings of
  one shared watch. Correct.
- **`tension_axes` is pairwise with `confidence` and `computed_at`/`updated_at`.** Pairwise means
  solo needs no special case; the timestamps mean a batch computer. Both correct.
- **No foreign keys on `watch_ratings.user_id` or `tension_axes.user_a_id`/`user_b_id`.** This looks
  like an oversight and is not: `session_members.user_id` has no FK either
  (`migrations/0001_initial_schema.sql:65`), because `deleteAccount` rewrites those columns to a
  random sentinel. A FK would forbid exactly the anonymization the privacy policy promises. **Do not
  add them.** SQLite cannot add a FK by `ALTER` anyway — it needs a table rebuild — so the cost would
  also be high.
- **No FK on `watch_history.group_id` either.** Groups are never hard-deleted in this codebase (bug
  B14 confirmed deletion leaves them behind), so a cascade would be inert. Not worth a rebuild.

### 6.2 Where it needs migration

`migrations/` currently contains `0001`–`0004`. **Migration numbers continue from `0005`.**

**Do NOT edit `0001_initial_schema.sql`.** It has already been applied to the remote database
(`docs/deploy.md` §2, marked ✅), so a change there would never reach production.

**All three tables are provably empty** — nothing in `src/` writes them — so every change below is a
plain DDL addition with no backfill. That is the whole reason this is cheap.

#### `migrations/0005_watch_loop.sql`

| Change | Why |
|---|---|
| `CREATE UNIQUE INDEX idx_watch_ratings_member ON watch_ratings(watch_history_id, user_id)` | **The most important fix in the set.** Without it a double-tap writes two ratings for the same person on the same watch, and the reveal gate ("both have rated") and every aggregate silently go wrong. The random per-row deletion sentinel keeps this satisfiable after account deletion. |
| `ALTER TABLE watch_ratings ADD COLUMN rated_at TEXT` | There is no timestamp at all. Without it you cannot order ratings, cannot render "3 weeks ago", and cannot bound the rating-prompt window. |
| `CREATE UNIQUE INDEX idx_watch_history_session_title ON watch_history(group_id, tmdb_id, content_type, recommended_in_session_id) WHERE recommended_in_session_id IS NOT NULL` | Makes "we watched this" idempotent per session without forbidding a genuine rewatch on a later night. Partial index, which SQLite supports. |
| `CREATE INDEX idx_watch_history_group ON watch_history(group_id, watched_at DESC)` | Every read is "this group's recent history", and one of them is on the match hot path inside `getMatchRoundContext`'s batch. Unlike the `idx_movie_sessions_group` that G7-5 dropped as unused, this index has a query that will exist. |
| `CREATE INDEX idx_watch_ratings_watch ON watch_ratings(watch_history_id)` | The reveal read and the prompt block both join on it. |

#### `migrations/0006_tension_axes.sql`

| Change | Why |
|---|---|
| `CREATE UNIQUE INDEX idx_tension_axes_pair_name ON tension_axes(group_id, user_a_id, user_b_id, axis_name)` | Without it, every weekly recompute duplicates the whole axis set. |
| `CREATE INDEX idx_tension_axes_group ON tension_axes(group_id)` | The weekly recompute and the prompt read. |

Plus an invariant that no index can enforce and the code must: **`user_a_id < user_b_id`
lexicographically.** Otherwise `(A,B)` and `(B,A)` are different rows and the unique index does
nothing.

### 6.3 Things the schema does not enforce, and the code must

- **`surprise_feedback` has no length cap** — SQLite `TEXT` has none. Clamp at the route (≤200 chars,
  matching `MAX_MOOD_TEXT_CHARS`) **and** at the prompt layer, per D5's defence-in-depth pattern.
- **`rating` has no `CHECK`.** Validate `1 | 2 | 3 | null` at the route.
- **`watch_history.watched_at` is the *logging* time, not the viewing time.** They differ when a
  couple logs the next morning. That is fine for "3 weeks ago" prose and asking for a date is
  friction nobody wants. Written down here so nobody "fixes" it into a date picker later.

### 6.4 The one place the reserved schema does not fit

Nothing in the three tables is wrong enough to drop, but one thing is missing rather than mis-shaped:
**there is no representation of "this watch has been asked about and dismissed"** distinct from
"this watch is unrated". The design works around it by reading `rating IS NULL` as *skipped* (§4.3)
and by expiring questions after 21 days — which is why no extra column is proposed. If Sam prefers a
skip that leaves no trace, that costs a `dismissed_at` column and a migration, and it is worth doing
deliberately rather than discovering later (**OPEN-5**).

---

## 7. Things this design deliberately does not do

- **No stats page, no averages, no "your compatibility score".** §4.5's whole argument is that the
  safe form of disagreement is an abstraction about taste, not a number about an outcome. A number is
  a scoreboard however it is framed.
- **No notification or email reminding you to rate.** The question waits on `/tonight`. If you never
  come back, the app has a bigger problem than a missing rating.
- **No rating the *recommendation* separately from the film.** Tempting for evaluating the engine,
  and it doubles the questions. The keep/remove signal already covers "was this a good suggestion".
- **No per-member visibility settings.** One rule for everyone is a rule people can hold in their
  heads; the rough-day precedent is that the *rule*, not the setting, is what protects people.

---

## 8. Explicitly NOT in Phase 2

Out of scope for this campaign. Each is real work; none of it blocks or is blocked by the loop.

| Item | Why not |
|---|---|
| **Vectorize, embeddings, the evaluation harness, candidate pre-filtering** | The largest item on the design doc's Phase 2 list, and completely independent of the rating loop in both directions. Its own campaign. |
| **The Sonnet vs Opus A/B** | Independent. Needs live API budget the project does not yet have. |
| **TV titles** | The schema and prompts are already content-type-agnostic. Adding TV is a seed-pipeline change, not a rating-loop change. |
| **Letterboxd import** | Phase 1.5. |
| **"Our Movie Nights" timeline** | Phase 1.5, and it is a *reading* surface over `watch_history` while this is the *writing* loop. Worth noting the overlap so it isn't built twice — it should be built on top of this, later. |
| **OG share cards** | Phase 1.5. |
| **Editing a submitted rating** | §2.3. Reintroduces anchoring. |
| **Per-user (rather than per-group) history** | §4.6, **OPEN-6**. |
| **Removing a watched title from a member's watchlist** | §5.2. A write across a privacy boundary for a cosmetic gain. |
| **The live adversarial prompt-injection pass** | Still a launch gate in `docs/deploy.md`. Phase 2 widens the injection surface (notes enter the prompt); it does not discharge the gate. |

---

## 9. Open product questions — for Sam

Each has my recommendation and a **default** so the implementation plan is executable without an
answer. Overruling any of them is a small change *if it happens before the group lands*.

**OPEN-1 — Is a three-point rating scale right?**
Three (`not for us` / `good` / `loved it`) vs five stars vs a two-way thumb. My recommendation is
three: the consumer is a language model, not a statistics engine, and three controls fit one row at
375px. But this is taste, and the integers are cheap now and expensive after real data exists.
*Default if unanswered: three.* **Blocks nothing; changes G1-1 and G5-2 if overruled.**

**OPEN-2 — Do you want the Taste Autopsy question rewritten? (§4.4)**
The approved design doc asks *"what surprised you about your partner's reaction"*. I think that is the
one genuinely bad idea in the reserved design: it stores one partner's evaluation of the other, and it
feeds a prompt. My recommendation is to keep the column and ask about the film instead. **This
contradicts a decision you approved, so it is yours.** *Default if unanswered: my version — the
first-person, about-the-film question.*

**OPEN-3 — On reveal, does the partner see the note as well as the rating?**
If reveal is the moment both have committed, sharing the note with it is defensible and makes the
reveal much richer. It is also the most personal text the app holds. *Default if unanswered: no —
ratings reveal, notes never do.* Changing this later is a UI change, not a data change, so the safe
default costs nothing.

**OPEN-4 — Where are the tension-axis gates set?**
Defaults: ≥3 nights rated by both members before any axis is computed; `confidence` ≥ 0.6 before one
is shown. Both are guesses. The *existence* of both gates is not open (§4.5); only the numbers are.
*Default if unanswered: 3 and 0.6, as named constants.*

**OPEN-5 — Should a mis-tapped rating be undoable?**
Ratings are frozen (§2.3) to preserve the blind property. A mis-tap is a real complaint. The cheap
middle is an undo window before the partner rates — which is a small amount of machinery, and a
`dismissed_at`-shaped schema question rides along with it (§6.4). *Default if unanswered: frozen, no
undo.*

**OPEN-6 — Should "never recommend what I've seen" eventually be per-user?**
History is group-scoped, per the schema (§4.6). That is right for *explaining* — what you watched with
one group must not surface in another group's reasoning — but arguably wrong for *excluding*. A
per-user exclusion overlay (excludes without explaining) would thread the needle and is additive.
*Default if unanswered: group-scoped only, revisit after real use.*

**OPEN-7 — Should the app ever say "we notice you keep not watching what we suggest"?**
The off-app watch path (§2.5) makes the engine's misses visible for the first time. Naming that back
to the user is either endearingly honest or annoying, and I genuinely cannot tell which.
*Default if unanswered: no — record it, use it silently.*

---

## 10. Success criteria for Phase 2

Lifted from the design doc's own bar (`dev/plans/design-doc.md:454`) and made checkable:

1. A couple can log a watch in **one tap** from the results screen, with no dialog.
2. The rating question appears **once**, on `/tonight`, and is dismissed in **one tap**.
3. Neither member can learn anything about the other's rating before submitting their own — provable
   by an API-shape test, not by inspection.
4. A watched title **cannot** appear in a later candidate pool, provable in a unit test against
   `selectCandidates` rather than against prompt text.
5. After 4+ rated nights, a matching round's `explanation` or `conversational` text references what
   they actually watched. *(Live eval, not a unit test — and it will not be verifiable until there is
   an Anthropic key.)*
6. Solo mode runs the whole loop with no partner machinery and no "waiting for…" copy anywhere.

---

## 11. Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-01 | Rating asked on next `/tonight` visit, never at logging time | The app must not stand between the couple and the film; `design-doc.md:518` already specified this moment |
| 2026-08-01 | Simultaneous reveal, gated on both ratings non-`NULL` | Immediate visibility anchors the second rater; permanent privacy is theatre when they watched it together. Approach C at a scale where it costs one read |
| 2026-08-01 | No timeout reveal; a completed reveal is offered for 7 days **from pair completion** | A timeout hands your rating to someone who gave nothing. Measuring the offer window from `watched_at` instead would swallow the payoff whenever the partner answered late |
| 2026-08-01 | `rating IS NULL` means *skipped*; indistinguishable from silence to the partner | Uses the nullable column as reserved, terminates the prompt loop with no new state, and protects the skipper |
| 2026-08-01 | Reveal state never gates what reaches the prompt | One unilateral rating is fully useful to the engine; the model is not a group member |
| 2026-08-01 | Past ratings may never be attributed to a member in model output | The engine cannot see reveal state and should not have to. One rule beats a rule that depends on unchecked state — the lesson of B8 |
| 2026-08-01 | Tension axes are shared output; single-film ratings are not | An axis is symmetric, about taste, and evidence-backed. `tensionPoints` already ships this shape |
| 2026-08-01 | Axes gated on ≥3 both-rated nights and a confidence floor | An axis from one disagreement is a stereotype, and a wrong one is a relational harm |
| 2026-08-01 | Watched-exclusion is code, with a comfort-list exception | G2-2's precedent for removed ids, inverted for comfort titles because the two lists mean opposite things |
| 2026-08-01 | History subtracts and explains; it never narrows the pool | The structural guard against diversity collapse. "Boost the genres they liked" is the obvious next change and the one that ruins it |
| 2026-08-01 | Axes computed in the weekly cron | Keeps a Claude call off every user-facing path; `computed_at`/`updated_at` are batch-job columns |
| 2026-08-01 | Group-scoped history, per the schema | What you watched with one group must not shape another's recommendations |
| 2026-08-01 | No FKs added to the Phase 2 tables | `session_members.user_id` has none for the same reason — deletion anonymizes, and a FK would forbid it |
