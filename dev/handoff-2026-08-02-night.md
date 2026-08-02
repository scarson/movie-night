# Handoff — the overnight autonomous session → fresh session

**Written:** 2026-08-02, at the end of an overnight session that took `dev` from `56d7490` to `aa115ef`.
**Audience:** an agent starting cold.

**The app:** two people with different tastes fill out profiles, set a mood for the evening, and an AI
finds titles that work for both of them. Next.js 16 + React 19 + Tailwind 4 on Cloudflare Workers/D1,
with `claude-sonnet-5` as the matching engine and TMDB for catalog data.

**Supersedes** `dev/handoff-2026-08-02.md` for current state (now bannered). That file is still the best
narrative of the eight-group bug-hunt remediation and its §Seams/§Guardrails/§The lesson worth carrying
are **not** repeated here — read them. `dev/handoff-2026-07-19.md` remains the **project glossary** — read
it if *group*, `__solo__`, *ritual vs quick*, *round* or "titles not movies" are unfamiliar.

---

## Headline state

| | |
|---|---|
| **`origin/dev`** | `aa115ef` — everything below is merged and pushed |
| **`origin/main`** | `f521ee2` — **291 commits behind**. Held deliberately; see §The main boundary |
| **Open PRs** | None. PRs #47–#52 all merged this session |
| **Live worktrees** | Two: the repo root, and `.claude/worktrees/handoff-2026-08-02-continue-93175c` (this session's) — see §Cleanup |
| **Gates** | `tsc` clean · `eslint` clean · **1,564 passed / 2 skipped** (68 files) · OpenNext build clean |
| **Deployed?** | **No.** The three deploy blockers in the previous handoff are all still open — unapplied migrations `0002`–`0004`, empty `titles`, no Worker on the account. Run `npm run preflight -- --remote` first. |

The 2 skips are the live Anthropic evals behind `RUN_LIVE_EVALS=1`. Correct, not a gap.

**Read in this order:** `CLAUDE.md` → `DESIGN.md` → `dev/research/open-decisions.md` → this file's
§Guardrails → `docs/pitfalls/`.

---

## What shipped — PRs #47–#52

**The `dev/plans/2026-08-01-next-queue.md` queue is complete.** Items 6–10 all shipped; each heading in
that file now carries a `**SHIPPED 2026-08-02**` banner with its outcome. Pointers, not narrative:

| Item | Artifact | PR |
|---|---|---|
| 6 — First-run experience | `dev/reports/first-run-experience.md` | #47 |
| 7 — Design-system QA sweep | `dev/reports/design-qa.md` | #48 |
| 8 — Mobile & touch QA | `dev/reports/mobile-qa.md` | #49 |
| **Independent review of 6–8** | §Review in `first-run-experience.md` | #50 |
| 9 — Dependency & supply chain | `docs/security/dependencies.md` | #51 |
| 10 — Cost model | `dev/research/cost-model.md` + `scripts/measure-prompt.mts` | #52 |

`dev/implementation-log.md` has a per-item entry with the reasoning. New pitfalls: **UI-1**, **UI-2**
(`docs/pitfalls/implementation-pitfalls.md` §2, a new section) and **§9 Driving a Real Browser**
(`docs/pitfalls/testing-pitfalls.md`).

### The five findings worth knowing before you touch anything

1. **The matching error taxonomy was applied on one screen out of three.** `requestMatch()` returned the
   server's message and discarded `kind`, so `/quick` and `/ritual` structurally could not branch —
   every failure got one framing and a "Try again" button, including kinds where retrying provably
   cannot succeed. `ERROR_FRAMING` now lives in `src/lib/match-errors.ts` and all three screens read it.
2. **`monthly_cap` kept a retry that cannot succeed** — found by review, not by me. The cap counts
   `recommendations` rows since the 1st of the UTC month and a refusal writes no row, so the number the
   retry is measured against is provably unchanged. Now `retry: false`. **This changed results-page
   behaviour, beyond items 6–8's stated scope** — deliberate, disclosed in PR #50.
3. **`opacity-50` beside `animate-rise-fade` is inert, and reduced motion switches it on.** Now UI-1.
4. **`next@16.2.10` carried nine advisories, all fixed in `16.2.11`.** Bumped to 16.2.12. Seven are
   unreachable here; the two **cache-confusion** ones plausibly are, and every write path in this app is
   a POST with a body.
5. **The 3,000-token output estimate was an unlabelled thinking budget.** The call sends
   `thinking: adaptive`; billed output is thinking + JSON, and the JSON alone measures ~836 tokens.

---

## In-flight work

**None.** Every PR is merged, no background jobs are running, no subagents are live.

---

## The main boundary — read this before acting on any autonomy grant

Mid-session Sam wrote: *"You have full decision and merge authority over everything."* Earlier standing
guidance (memory `sam-autonomy-and-merge-authority`, and `dev/handoff-2026-08-02.md`) says `main` is held
until an actual ship decision.

**I treated `main` as still held, merged only to `dev`, and told Sam so explicitly.** He did not
countermand it. A fresh agent should do the same until Sam says "ship" in those terms: the grant is about
*speed on reversible work*, and publication to `main` is the one irreversible thing in the list.

Everything else — including `Review`-class changes to auth, privacy, schema, and the design system — is
merge-on-green under the standing grant.

---

## The review pattern that worked, and how to re-run it

Sam asked for "/codex and Opus subagent reviews (together, for important things)". Both ran over
`git diff 56d7490..2e24873`. **They overlapped on three findings and each found things the other missed** —
running only one would have shipped defects.

**What made it work:** both were pointed at this project's *documented failure mode* rather than at
generic bug-hunting —

> *the code is fine and the justification is wrong — the version that ossifies in a comment and outlives
> everyone who could question it.*

Between them they found **3 behaviour defects and 7 wrong justifications**, including five claims in my
own reports. Concretely:

- **Codex** (`/codex`, `codex exec`, high reasoning) found the `monthly_cap` retry, the invite-page
  guidance firing on every failure, and two stale doc comments.
- **The Opus subagent** independently *replayed all nine added tests against a worktree at the pre-fix
  commit* and confirmed exactly nine failed — the strongest possible evidence against this repo's
  "tests that could not have failed" defect class. It also caught the `text-amber` miscount that
  materially changed decision #6, and the `left_group`-is-not-first-round-reachable overclaim.

**Operational notes for re-running it:**

- **Codex times out on a large prompt.** An 81 KB prompt (full diff including report markdown) hit the
  330 s wrapper and returned nothing. Re-scoping to `git diff <range> -- 'src/'` (34 KB) succeeded in
  well under the budget. Send source to codex; send prose to the subagent.
- `mktemp` in `$TMP_ROOT` collided; use the session scratchpad for prompt/stderr files.
- Give the subagent an explicit **"REPORT, do not fix"** instruction and a named list of claims to verify.
  Naming the specific suspect claims ("verify the CSS cascade reasoning", "recompute the contrast
  figures") is what produced the sharp findings, not the general instruction.
- **Neither reviewer's output should be taken at face value.** I verified every finding against the code
  before acting — one codex claim about heading behaviour was *correct but described a deliberate
  decision*, and belonged in `open-decisions.md` #13 rather than in a fix.

---

## Seams — where two pieces of work met

These are the places a fresh agent reading one artifact would get a wrong impression.

- **PR #50 corrected claims in reports that had already merged in #47 and #48.** If you read
  `first-run-experience.md` or `design-qa.md` at the #47/#48 commits, you get falsified claims — the
  "no touch-target misses" line most of all. Only the post-`74fde8e` versions are right. Every
  correction is marked **"Corrected after review"** in place rather than silently rewritten; that phrase
  is greppable.
- **Sam merged PR #49 himself, mid-turn**, while I was working. If a PR looks already-merged and you
  don't remember doing it, that's why. Check `gh pr list --state merged` before re-merging anything.
- **Item 7 reported touch targets clean; item 8 found three misses one commit later.** The cause is
  recorded as UI-2, because it is reusable: a source sweep proves a size class is present, not that a
  target is big enough. The design-qa report now carries the correction and the reason.
- **Item 9's Next bump moved `eslint-config-next` too** (16.2.10 → 16.2.12). CI's lint job depends on it.
  Intentional and coupled — bump them together or lint drifts from the framework.
- **`dev/plans/2026-08-01-next-queue.md` still contains each item's original scoping prose** beneath its
  new `**SHIPPED**` banner. That is deliberate (the brief is worth keeping), but a naive reader can mistake
  the old prose for current intent. The banner is the current state; the prose below it is history.
- **The repo root checkout is stale.** `/Users/sam/Code/movie-night` sits at `56d7490` while `origin/dev`
  is `aa115ef`. `git -C /Users/sam/Code/movie-night pull` before working there.
- **Item 10 corrected the queue's own framing:** the queue said "up to 4 calls per round on retry";
  `matching.ts:651` sets `MAX_ATTEMPTS = 2`, retried only on `malformed`. Any cap arithmetic that
  double-counts a 4× ceiling is wrong.

---

## Priority queue

Ordered. Nothing here is blocked on credentials except where stated.

1. **`open-decisions.md` #12 — first-run routing on `/tonight`.** The largest product call outstanding, and
   the substance of item 6's finding: `/tonight` makes **Quick match** primary for an account with no saved
   profile, and Quick match runs anyway — `matching.ts` renders empty lists as `"None selected"`, so the
   engine answers from popularity and mood alone and the result looks like the product working. The full
   ritual *is* the onboarding and it is good; it is simply not what a new account is pointed at, and nothing
   on that screen invites the second person. Settling this also settles two copy strings that assert a
   profile that isn't there. **Sam has decision authority delegated; get an independent design review before
   implementing.**
2. **The parked design calls — `open-decisions.md` #5, #6, #12b, #13.** #6 gained a third option and a
   corrected input (three 14px-regular static amber sites, not two — `mood-screen.tsx:140` is the one the
   report first missed). #12b recommends naming a destructive control level in `control-classes.ts`.
3. **`PhasedLoading` spec gap.** DESIGN.md says the loading sequence "adapts to actual API response time";
   it adapts *downward* only, so it goes static from ~3 s (refinement) / 4.6 s (quick match) for the rest of
   a 5–15 s call — measured, in `mobile-qa.md`. Frame it as a defect against a written spec, not a feature
   request; the *shape* of the upward adaptation is a design choice that must stay inside "calm thinking,
   not a progress bar".
4. **The bottom tab bar that DESIGN.md specifies and the app never built.** §Layout names it, §Elevation
   describes its shadow, and a repo-wide search finds those two lines and nothing else. Phase 1 has three
   destinations so YAGNI may be right — but the spec is dangling, and it is exactly where a persistent
   primary action would live for the ritual's 3.77-screen scroll. **Either build it or record the decision
   not to, in DESIGN.md's log.**
5. **Route-level structured logging.** Nothing blocks it; the observability agent could not reach those
   files and left the exact call sites listed in `docs/deploy.md` §Observability.
6. **The unowned list** from `dev/handoff-2026-08-02.md` §Not started — group-size cap, `seed-lib`'s
   `created_at` reset, `npm test -- <file>`, the `createFakeD1().batch()` guard, the D1 `migrations_dir`
   collision. Judge each on merit; say so if one should stay unfixed. **The group-size cap gained evidence
   this session:** the review measured the ritual stepper overflowing at 320px at **8+ members**, and no cap
   exists anywhere.

---

## Deferred — with unblock conditions

| Item | Unblocked when | Where it lives |
|---|---|---|
| **Real `tokens_out`** — now the highest-value single measurement | The app is deployed and **one match is served**; `runMatching` already logs it (`matching.ts:683`). It reveals **thinking volume**, the only unknown term left in the cost model. | `dev/research/cost-model.md`, `open-decisions.md` #11 |
| **Adversarial injection pass — a launch gate, NOT satisfied** | `ANTHROPIC_API_KEY` in `.dev.vars`. 12 specified rows, under $5, one afternoon. Gate stays closed if rows 1–5 fail. | `docs/security/prompt-injection.md` §4 |
| Live evals | Same key. Stale regardless — `PROMPT_VERSION` moved `p1.1` → `p1.2`. | `docs/deploy.md` |
| `effort` sweep against Anthropic | Same key. Would also test the cost model's biggest lever: thinking tokens dominate output cost. | `dev/research/2026-08-01-gpt56-effort-sweep.md` |
| Screen-reader pass | Needs a **human** with VoiceOver/NVDA. The local-JWT runbook gets them a signed-in app in ~5 minutes. | `docs/accessibility.md` |
| Real touch input; soft-keyboard occlusion | Needs a physical device. The measurable half (16px inputs, geometry) is done. Residual risk is `/results`, where the steering textarea sits 138px above its submit button. | `dev/reports/mobile-qa.md` |
| Phase 2 execution | Sam answers the design doc's open questions **and** the app ships. Deliberately not queued. | `dev/plans/phase-2-design.md` |

---

## Operational guardrails accumulated this session

Everything in `dev/handoff-2026-08-02.md` §Guardrails still holds. New, and now also in `docs/pitfalls/`
where they generalise:

**Driving a browser** (now testing-pitfalls §9)
- **The first `left_click` after `read_page`/`scroll_to` may not dispatch** — it happened three times and
  each time the natural reading was "the feature is broken." Assert the *effect* (a request in the log, a
  DOM change) before concluding anything.
- **Flip `data-reduced-motion` on the same DOM** when auditing any state-bearing element. Two seconds, and
  it is the only way to see the rendering review never looks at.
- Holding a response open reproduces a long *wait*, not packet-level slowness. Say which you did.

**The local environment** (the runbook in `dev/reports/2026-08-01-authenticated-a11y-verification.md` works
exactly as written; it is still the most useful single artifact for a fresh agent)
- `.dev.vars` is gitignored, so a fresh worktree must recreate it. Dummy Anthropic/TMDB values are fine —
  but pressing a match CTA with a dummy key fires a real request and 503s on `provider_auth`, which is
  itself a useful way to see that error screen.
- **Forcing the typed errors without credentials:** `MONTHLY_MATCH_LIMIT=0` in `.dev.vars` → `monthly_cap`.
  35 rows into `rate_limit_log` (scope `match`, key = user id) → `daily_limit`. Both need a wrangler restart,
  not a rebuild.
- **Pick a non-default wrangler port** (this session used 8793). Sibling agents claim 8787.

**Review tooling**
- Codex times out past ~80 KB of prompt; scope the diff to `src/`.
- Use the session scratchpad for temp files — `mktemp` in the shared tmp root collided.

**Dependencies**
- **`npm audit fix --force` on this repo would install `next@9.3.3`** — a seven-major downgrade. Never run it.
- `wrangler` is exact-pinned at `4.105.0` for a documented reason (≥4.108.0 needs `@cloudflare/workers-types@^5`,
  which ERESOLVEs against the pinned v4 line). Don't "helpfully" bump it.
- npm gates install scripts and **none is approved here** (`fsevents`, `esbuild`, `workerd`, `sharp`,
  `unrs-resolver`). Keep it that way; don't run `npm approve-scripts --all`.

**Cost**
- `claude-sonnet-5` is on an **introductory rate ($2/$10) that expires 2026-08-31.** Everything rises 50% on
  September 1. Any cap chosen against the intro rate is half what it looks like.

---

## Local state in this worktree (if you reuse it)

The local D1 carries fixtures this session created — a brand-new account (`user-new`, no profile), a
`Sunday Nights` group with a second member, a zero-round session `sess-norounds`, and one
`recommendations` row. Harmless, and useful for re-walking the first-run states. `npm run migrate:local`
against a *fresh* database if you want a clean slate — it fails on an already-migrated one (`0001` has no
`IF NOT EXISTS`).

`scripts/measure-prompt.mts` is committed and re-runnable (`npx tsx scripts/measure-prompt.mts`). It is the
only new script; `mint-session.mts` was deleted after use — the runbook shows how to recreate it.

---

## Cleanup

This session's worktree could not remove itself. From the root, once you've confirmed nothing is unpushed:

```bash
git -C /Users/sam/Code/movie-night pull
git -C /Users/sam/Code/movie-night worktree remove .claude/worktrees/handoff-2026-08-02-continue-93175c
git -C /Users/sam/Code/movie-night branch -D claude/handoff-2026-08-02-continue-93175c
```

---

## Adversarial review of this handoff

Nine rounds, run to a clean full pass. Findings applied in place.

**Round 1 — Naive fresh agent (4 findings).** Added the glossary pointer, spelled out what the previous
handoff still owns rather than assuming, named `aa115ef` explicitly in the superseded banner, and stated
what the 2 skipped tests are.

**Round 2 — Recency-bias audit (3 findings).** Items 6–8 were under-weighted against item 10. Added the
five-findings list so the early work is not buried; restored the `requestMatch` type change and the
`monthly_cap` scope note, both mid-session and both easy to lose.

**Round 3 — Seam auditor (5 findings).** Added: reports falsified-then-corrected across PR boundaries;
Sam's own merge of #49; the stale root checkout; the queue doc's retained scoping prose; the
`eslint-config-next` coupling.

**Round 4 — Operational guardrails auditor (4 findings).** The forced-error recipes
(`MONTHLY_MATCH_LIMIT=0`, 35 rate-limit rows) existed only in the transcript. Same for the codex prompt-size
limit, the `mktemp` collision, and the `npm audit fix --force` trap. Persisted here and, where general, to
`docs/pitfalls/`.

**Round 5 — Loss-averse auditor (3 findings).** Recovered: the local D1 fixture state, `measure-prompt.mts`
being committed while `mint-session.mts` was deleted, and the 8-member stepper overflow the subagent
measured — which is evidence for the group-size cap already on the unowned list, and would otherwise have
died in a subagent transcript.

**Round 6 — Delegated-authority auditor (session-specific; 2 findings).** *Chosen because this session ran
under an explicit mid-session authority expansion ("full decision and merge authority over everything") that
conflicted with standing guidance, and because it used two independent AI reviewers whose reliability a
future agent must calibrate.* Findings: (a) the `main` decision and its reasoning existed only in a chat
message — now §The main boundary, with the explicit note that Sam did not countermand it; (b) the handoff
described the reviews as successful without saying **not to take reviewer output at face value**, which is
the actual lesson — one codex finding was correct-but-describing-a-deliberate-decision and belonged in
`open-decisions.md`, not in a fix.

**Round 7 — Falsified-claims auditor (session-specific; 2 findings).** *Chosen because this session's own
reports were shown to contain five false claims — a handoff written by the same author has no reason to be
exempt.* Re-verified every number in this file against the artifacts: corrected the commits-behind figure
(291, not 273 — the previous handoff's number, which I had carried forward without checking), and confirmed
the tip SHA, test count, and PR range against `git` rather than memory.

**Round 8 — Holistic read (1 finding).** Read top to bottom with fresh eyes. The priority queue read as six
equal items; reordered so the product call is unambiguously first and the reasoning for the order is visible.

**Round 9 — Full clean pass.** All eight lenses re-run after fixes. Zero material findings.

---

## Continuation prompt

> You're picking up Movie Night, a couples' movie recommendation app (Next.js 16 + React 19 + Tailwind 4 on
> Cloudflare Workers/D1, `claude-sonnet-5` matching engine) at `/Users/sam/Code/movie-night`.
>
> Read `dev/handoff-2026-08-02-night.md` first — state, seams, guardrails, and the review pattern. Then
> `CLAUDE.md`, `DESIGN.md`, `dev/research/open-decisions.md` (everything waiting on Sam), and
> `docs/pitfalls/`. `dev/handoff-2026-07-19.md` has the glossary; `dev/handoff-2026-08-02.md` has the
> bug-hunt narrative the newer handoff deliberately does not repeat.
>
> State: `origin/dev` at `aa115ef`, zero open PRs, gates green (1,564 tests). `origin/main` is 291 commits
> behind and is **held** — do not open a publication PR, even under a broad autonomy grant, until Sam says
> "ship" in those words. Nothing is deployed; the preflight still reports three known blockers.
>
> The `dev/plans/2026-08-01-next-queue.md` queue is **complete** — items 6-10 all shipped overnight. Start
> with the handoff's §Priority queue, item 1: `dev/research/open-decisions.md` #12, the first-run routing
> call on `/tonight`. Sam has delegated decision authority on it; get an independent design review before
> implementing, and record the decision in DESIGN.md's log.
>
> Conventions are strict: TDD with a genuinely-failing test first, ABOUTME headers on new files, one commit
> per logical unit with explicit `git add` paths, a dedicated worktree + branch per task, and all gates green
> before each commit. Append to `dev/implementation-log.md` (it merges with `union`). Open PRs when ready;
> merge Routine ones yourself on green CI.
>
> For anything consequential, run `/codex` **and** an Opus subagent review together — the handoff's §The
> review pattern that worked has the operational details (scope codex to `src/`, tell the subagent to report
> rather than fix, verify every finding against the code before acting on it). Between them they found three
> behaviour defects and seven wrong justifications last session, including five in the session's own reports.
>
> Read §Seams and §Guardrails before touching anything — several are non-obvious and cost this session real
> time to discover.
