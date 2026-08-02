# Handoff — the first-run-routing session → fresh session

**Written:** 2026-08-02, at the end of a session that took `dev` from `d19f8d4` to `77a5ae5`.
**Audience:** an agent starting cold.

**Supersedes `dev/handoff-2026-08-02-night.md` for current state.** That file is still worth reading for
its §Seams, §Guardrails and §The review pattern that worked — this file does not repeat them, and its
§Deferred table is still accurate except where noted below. `dev/handoff-2026-07-19.md` remains the
**project glossary**: read it if *group*, `__solo__`, *ritual vs quick*, *round* or "titles not movies"
are unfamiliar.

---

## Headline state

| | |
|---|---|
| **`origin/dev`** | `77a5ae5` — everything below is merged and pushed |
| **`origin/main`** | **309 commits behind**. Still held; see §The main boundary |
| **Open PRs** | None. #54–#57 all merged this session |
| **Live worktrees** | The repo root (on `dev`, current) and `.claude/worktrees/movie-night-first-run-routing-c326a4` — see §Cleanup |
| **Gates** | `tsc` clean · `eslint` clean · **1,592 passed / 3 skipped** (68 files) · OpenNext build clean |
| **Deployed?** | **No.** The three blockers are unchanged — unapplied migrations `0002`–`0004`, empty `titles`, no Worker on the account |

The 3 skips are the live Anthropic evals behind `RUN_LIVE_EVALS=1`. **One of them is new and matters** —
see §The one measurement now waiting.

**Read in this order:** `CLAUDE.md` → `DESIGN.md` → `dev/research/open-decisions.md` → the previous
handoff's §Guardrails → `docs/pitfalls/`.

---

## What shipped — PRs #54–#57

Pointers, not narrative. Each has a per-item entry in `dev/implementation-log.md`.

| PR | What | Where the reasoning lives |
|---|---|---|
| #54 | Streaming picker says **HBO Max**, not the retired "Max" | implementation-log |
| #55 | **`open-decisions.md` #12 settled** — first-run routing on `/tonight` | DESIGN.md log (3 rows), open-decisions #12 |
| #56 | **`open-decisions.md` #14** — the engine stops being told to describe a taste nobody gave | open-decisions #14 |
| #57 | **`open-decisions.md` #12b settled** — named destructive control level | DESIGN.md log (1 row), open-decisions #12b |

**New durable artifacts created this session:**

- **`docs/pitfalls/implementation-pitfalls.md` §3 — The Prompt as a Data Structure** (new section):
  **PROMPT-1** (a member predicate read the stored array while the prompt renders a sanitized one),
  **PROMPT-2** (the system prompt has string-level invariants and a quoted literal broke one),
  **PROMPT-3** (contradicting an existing directive and patching it with a precedence clause).
- **`docs/pitfalls/testing-pitfalls.md` §9** — two entries: the backgrounded-tab animation trap, and the
  `jq 'all(.[]; …)'`-on-empty-array polling bug.
- **`open-decisions.md` #14** (engine, launch-blocking) and **#15** (the PhasedLoading question — read it
  before touching priority-queue item 3).

---

## The decision that did not go the way the queue expected

**`open-decisions.md` #12 (a) — routing a first visit to the ritual — was declined**, and the finding
relocated to #14. This is the single most important thing to understand before re-opening it.

Two design reviews were run with **opposed briefs** — one asked to recommend and specify a change, one
asked to build the strongest case for leaving `/tonight` alone. The adversarial brief found:

1. **The motivating claim was never observed.** `first-run-experience.md:126` says an empty account gets
   recommendations that "look like the product working"; the same report at `:202` discloses it never
   reached that screen, because doing so needs a live Anthropic call.
2. **Its supporting evidence does not close the gap.** The match route records the rate-limit hit
   *before* `runMatching` ("the round is billed the moment we ask"), so 30 `daily_limit` hits are
   equally consistent with 30 *failed* calls.
3. **Two findings from the same session point opposite ways and neither cites the other.** F1 says route
   new users into the ritual; `mobile-qa.md:78-88` measures that ritual at **3.77 screens**, Continue at
   **y=2693**, with nothing `sticky` or `fixed` anywhere in the app.
4. **The ritual guarantees nothing.** `ritual/page.tsx` `advance()` at step 0 has no validation, so an
   abandoner PUTs five empty arrays and reaches the identical prompt having paid that scroll.
5. **The predicate does not exist.** `GET /api/user/profile` returns `emptyProfile()` for a missing row,
   so "no profile row" — the phrasing in the decision record — is not observable through any API.

**(b) shipped** ("Invite someone" on `/tonight` when there are no groups); F5 shipped; both copy strings
shipped. Full reasoning in `open-decisions.md` #12 and DESIGN.md's log.

---

## The one measurement now waiting

`src/lib/matching.eval.test.ts` carries a new **`solo with nothing saved`** case. It is skipped until
`ANTHROPIC_API_KEY` exists and it is the measurement `open-decisions.md` #14 is waiting on.

**Be precise about what #14 shipped:** the *instruction* is fixed — the prompt no longer tells the model
to restate a taste nobody gave. Whether the model ever confabulated, and whether it now stops, is
**unmeasured**. The PR, the log and #14 all say so. Do not let that soften into "the confabulation bug is
fixed" — that would be this project's documented failure mode inside the change that exists to fix an
instance of it.

Two residual risks recorded with it, both unquantified without a key:

- The `EMPTY PROFILES` rule is **~30% of the system prompt** and now its longest paragraph. Dollar cost is
  ~$0.0006/round; **instruction-weight dilution** is the cost that matters and nothing measures it.
- `docs/security/prompt-injection.md` §4's rows 1–5 were specified against a system prompt *without* that
  rule. The gate was already open (it needs the same key), so nothing regressed — but when it is run, it
  is being run against a different prompt than it was written for.

---

## Seams — where two pieces of work met

- **PR #55's branch predated PR #54's merge.** GitHub showed it `CONFLICTING` **and reported no CI checks
  at all**, which reads as "CI is not configured for this branch". It is not; rebasing onto `origin/dev`
  cleared both. If you see a PR with zero checks, check `mergeable` first.
- **PR #56 corrected a sentence PR #55 had written.** `open-decisions.md` #14 said *"There is no
  empty-profile branch anywhere in the engine"* — true when #55 merged, false the moment #56 did. Read at
  the #55 commit, #14 is falsified. Only the post-`b31ff7a` version is right.
- **PR #55 fixed two copy strings; PR #56 found a third.** `results/[sessionId]/page.tsx` said "Read from
  your saved profiles." with no vibe set — same class, missed by the sweep that claimed to have handled
  it. This is **UI-2's shape again** and the second time this project has hit it in two sessions.
- **DESIGN.md gained four 2026-08-02 rows across two PRs** (#55 three, #57 one). They are inserted above
  the 2026-08-01 row rather than at the head of the table, matching the file's existing ordering drift.
- **`open-decisions.md` #14 is filed under *Blocking a public launch*, out of numeric order**, between #4
  and the Design-calls section. Deliberate — placement is by severity, and the file was already
  non-sequential.

---

## Operational guardrails accumulated this session

Everything in the two previous handoffs still holds. New, and routed to `docs/pitfalls/` where general:

**Reviews**
- **The dual review (codex + Opus subagent) paid for itself three more times.** Across three cycles they
  found a focus-loss regression, a wrong mechanism in a decision record that would have sent the next
  reader to the wrong file, a predicate reading unsanitized data, a prompt contradiction, and — twice —
  that some of my own new tests passed vacuously against pre-fix code.
- **Neither reviewer is authoritative.** One claimed `docs/security/prompt-injection.md` carried a stale
  `p1.2` header and a "a `PROMPT_VERSION` bump reopens it" line. **Neither string exists in that file.**
  Verified before editing; nothing changed. Check every finding.
- **Ask reviewers to replay the new tests against the pre-change commit.** Both cycles produced a
  measured count of vacuous tests that way. It is the check this repo most often skips.
- `codex exec --model gpt-5.6-codex` is **rejected on a ChatGPT account** ("model is not supported").
  Drop `--model` and let it default.

**The repo's own guards caught two regressions neither reviewer did**
- `control-contrast.test.tsx`'s slate allowlist caught a duplicated `border-slate` divider.
- `matching.test.ts`'s zero-double-quotes invariant caught a quoted literal added to the system prompt.
  Run the gates before believing a review is the last word.

**Measurement beats reasoning, twice**
- Skeleton widths: codex was right in principle that a flat `w-40` cannot match two content-sized
  buttons; measured, they are 156.6px and 159.3px, so `w-40` is within 3.4px, and the "more precise"
  widths written in response measured **worse**.
- Layout settle: a reviewer and my own arithmetic both predicted ~144px for the first-run state.
  **Measured, 8px** (88px for a one-group account). Both estimates were wrong.

**Local environment**
- The runbook in `dev/reports/2026-08-01-authenticated-a11y-verification.md` still works exactly as
  written. `mint-session.mts` was recreated from it and deleted again after use.
- **Fixture-schema traps the runbook's appendix does not cover:** `groups` has **no `created_by`**
  column, and `group_members` requires an explicit **`id`**. `wrangler d1 execute` reports a failed
  statement as a bare log line with no error, so a malformed INSERT looks like success — verify with a
  `SELECT` before concluding the fixture landed.
- `.gitignore` matches `node_modules/` with a trailing slash, so a **symlinked** `node_modules` shows as
  untracked. Symlinking one from an existing worktree avoids a 60s `npm ci` per worktree; just never
  `git add -A` with one present.
- `gh pr merge --delete-branch` **fails when another worktree holds `dev`** ("fatal: 'dev' is already
  used by worktree"). The merge itself succeeds server-side; only the local cleanup fails. Merge without
  `--delete-branch` and remove the branch separately.

---

## Priority queue

Ordered. Nothing here is blocked on credentials except where stated.

1. **`open-decisions.md` #15 — is the `PhasedLoading` gap a defect or a reading?** This is the previous
   handoff's priority-queue item 3, and **the framing it hands you should be checked before it is acted
   on.** DESIGN.md's "adapts to actual API response time" plausibly *describes the downward fast-forward
   that already exists*, in which case there is nothing to fix. #15 lays out both readings, the
   `aria-live` constraint any upward adaptation has to respect, and recommends the opposed-brief review
   before code. **The cheapest outcome is discovering there is nothing to fix.**
2. **The remaining parked design calls — `open-decisions.md` #5, #6, #13.** #12 and #12b are now settled;
   these three are what is left. #6 has three options and a corrected input (three static-amber sites,
   not two). #13 is one line either way and is purely voice. **Check whether #5 is stale** — the
   2026-07-27 decision already made `ash` the resting boundary for interactive controls, which may have
   answered it.
3. **The bottom tab bar DESIGN.md specifies and the app never built.** §Layout names it, §Elevation
   describes its shadow, and a repo-wide search finds those two lines and nothing else. **Either build it
   or record the decision not to, in DESIGN.md's log.**
4. **Route-level structured logging.** Nothing blocks it; the exact call sites are listed in
   `docs/deploy.md` §Observability.
5. **The unowned list** from `dev/handoff-2026-08-02.md` §Not started — group-size cap, `seed-lib`'s
   `created_at` reset, `npm test -- <file>`, the `createFakeD1().batch()` guard, the D1 `migrations_dir`
   collision. Judge each on merit; say so if one should stay unfixed. The group-size cap has measured
   evidence (ritual stepper overflows at 320px at 8+ members, no cap exists anywhere).

---

## Deferred — changes since the previous handoff

The previous handoff's §Deferred table still holds. Two rows have moved:

| Item | Change |
|---|---|
| **Live evals** | Now stale at **`p1.3`**, not `p1.2` — #56 bumped it. A `solo with nothing saved` case was added and is the highest-value single row in the suite. |
| **Real `tokens_out`** | Unchanged, still the highest-value single measurement, still needs one served match. |

Everything else — the injection launch gate, the `effort` sweep, the screen-reader pass, real touch
input, Phase 2 — is unchanged.

---

## The main boundary

Unchanged and still binding. `origin/main` is **309 commits behind** and is held until Sam says "ship"
in those terms. This session ran under "You have full authorization for everything except PRs to main",
which is explicit — everything else was merged on green CI, `main` was not touched.

---

## Cleanup

This session's worktree cannot remove itself. From the root, once nothing is unpushed:

```bash
git -C /Users/sam/Code/movie-night worktree remove .claude/worktrees/movie-night-first-run-routing-c326a4
git -C /Users/sam/Code/movie-night branch -D claude/movie-night-first-run-routing-c326a4
```

Its `.dev.vars` is gitignored and holds only dummy values; harmless to leave, and it is what the runbook
tells you to recreate anyway. The local D1 in that worktree carries a `user-new` account with no profile
and no groups — the exact first-run fixture, and useful for re-walking those states.

---

## Adversarial review of this handoff

Seven rounds, run to a clean full pass. Findings applied in place.

**Round 1 — Naive fresh agent (3 findings).** Added the glossary pointer and what the previous handoff
still owns; stated what the 3 skipped tests are and that one is new; named the tip SHA explicitly rather
than "current".

**Round 2 — Recency-bias audit (4 findings).** PRs #54 and #55 were under-weighted against #56/#57.
Added the #12 decision as its own section rather than a table row — it is the session's largest call and
was nearly reduced to one line. Restored the HBO Max no-migration reasoning pointer and the measured
skeleton/layout corrections, both mid-session and both easy to lose.

**Round 3 — Seam auditor (5 findings).** Added: the #55-predates-#54 rebase and the zero-CI symptom it
produces; #56 falsifying a sentence #55 wrote; the third copy string as a repeat of UI-2; the DESIGN.md
row ordering; #14's deliberate out-of-numeric-order placement.

**Round 4 — Operational guardrails auditor (5 findings).** The codex `--model` rejection, the
`gh pr merge --delete-branch` worktree failure, the wrangler silent-INSERT-failure trap, the
`groups`/`group_members` schema shapes, and the symlinked-`node_modules` gitignore interaction all
existed only in the transcript. Persisted here; the two general ones went to `docs/pitfalls/`.

**Round 5 — Loss-averse auditor (3 findings).** Recovered: that the repo's own guards caught two
regressions both reviewers missed (the strongest argument for running gates over trusting review); the
false reviewer claim about `prompt-injection.md`, so nobody re-checks it; and the measured 8px-vs-144px
correction, which otherwise dies in a transcript.

**Round 6 — Unmeasured-claim auditor (session-specific; 4 findings).** *Chosen because this session's
central act was declining a change whose premise was unverified, and then shipping a prompt fix whose
outcome is equally unverified — the failure mode is that "unmeasured" quietly becomes "fixed" in the
retelling.* Findings: (a) §The one measurement now waiting was added, stating explicitly that #14 fixed
the instruction and not an observed behaviour; (b) the two residual risks (prompt dilution, the injection
gate specified against an older prompt) were only in the PR body and are now here; (c) the eval-staleness
row was still pegged at `p1.2`; (d) the priority queue presented item 1 as a defect to fix, which is the
exact framing #15 exists to question — reworded so the first action is to check the framing.

**Round 7 — Holistic read (1 finding).** Read top to bottom cold. §What shipped read as four equal PRs
with the largest decision buried in a table cell; the #12 section now sits directly after it, and the
table points into it.

**Round 8 — Full clean pass.** All seven lenses re-run after fixes. Zero material findings.

---

## Continuation prompt

> You're picking up Movie Night, a couples' movie recommendation app (Next.js 16 + React 19 + Tailwind 4
> on Cloudflare Workers/D1, `claude-sonnet-5` matching engine) at `/Users/sam/Code/movie-night`.
>
> Read `dev/handoff-2026-08-02-late.md` first — state, seams, guardrails, and what the last session
> decided *not* to do and why. Then `CLAUDE.md`, `DESIGN.md`, `dev/research/open-decisions.md`, and
> `docs/pitfalls/`. `dev/handoff-2026-07-19.md` has the glossary;
> `dev/handoff-2026-08-02-night.md` has the §Seams/§Guardrails/§review-pattern detail the newer handoff
> deliberately does not repeat.
>
> State: `origin/dev` at `77a5ae5`, zero open PRs, gates green (1,592 passed / 3 skipped). `origin/main`
> is 309 commits behind and is **held** — do not open a publication PR, even under a broad autonomy
> grant, until Sam says "ship" in those words. Nothing is deployed.
>
> Start with the handoff's §Priority queue, item 1: `open-decisions.md` **#15**. It asks whether the
> `PhasedLoading` gap is a defect against DESIGN.md or a misreading of it — the previous queue asserted
> the former, and that assertion is what #15 exists to test. **The cheapest outcome is discovering there
> is nothing to fix**, so settle the reading before writing code.
>
> Conventions are strict: TDD with a genuinely-failing test first, ABOUTME headers on new files, one
> commit per logical unit with explicit `git add` paths, a dedicated worktree + branch per task, and all
> gates green before each commit. Append to `dev/implementation-log.md` (it merges with `union`). Open
> PRs when ready; merge Routine ones yourself on green CI.
>
> For anything consequential, run `/codex` **and** an Opus subagent review together, and for product
> calls run **two reviewers with opposed briefs** — one to recommend, one to steelman the status quo.
> That pairing is what overturned `open-decisions.md` #12 last session. Verify every finding against the
> code: one reviewer asserted a stale version header in a file that does not contain the string, and the
> repo's own tests caught two regressions both reviewers missed.
