# Movie Night — Implementation Pitfalls & Review Findings

> **Purpose:** Document implementation traps, design flaws, and corrected decisions that would cause production failures, security vulnerabilities, or data correctness bugs if shipped. This document is the primary code review reference for the [project name] codebase.
>
> **Relationship to testing-pitfalls.md:** This document specifies *what* to implement and *why*. `docs/pitfalls/testing-pitfalls.md` specifies *how to verify* those implementations work correctly. They are complementary — cross-references are noted inline.
>
> **Last validated against codebase:** 2026-07-18 (replace when you audit against the current code)

---

## How to Use This Document

This document serves three audiences. Start here, then go directly to the section you need.

**If you're implementing code:** Go to the domain section matching your work area. Each entry has a clear *Flaw → Why It Matters → Fix → Lesson* structure. Follow the Fix. The Lesson teaches the generalizable principle so you'll catch the next instance of this pattern.

**If you're reviewing code:** Go to your domain section's **Review Checklist** at the end. Each item is a pass/fail check derived from the pitfalls above it. If a checklist item fails, read the referenced pitfall for context.

**If you're maintaining this document:** Every pitfall discovered during implementation, review, or debugging MUST be added here. See the maintenance sections at the end of this file. Partial updates cause drift.

---

## Table of Contents

<!-- TODO: replace the example rows below with your project's actual domain sections. -->

| § | Section | You're working on... | Entries | Checklist |
|---|---------|---------------------|---------|-----------|
| 1 | [Cloudflare Workers & D1](#section-1-cloudflare-workers--d1) | D1 queries, Workers runtime constraints, bindings | PLAT-1, PLAT-2, PLAT-3 | §1.C |
| 2 | [Presentation & CSS](#section-2-presentation--css) | Tailwind utilities, state styling, touch targets, motion | UI-1, UI-2 | §2.C |
| 3 | [The Prompt as a Data Structure](#section-3-the-prompt-as-a-data-structure) | `buildMatchingPrompt`, prompt invariants, member predicates | PROMPT-1, PROMPT-2, PROMPT-3 | §3.C |
| — | [Orchestration](#orchestration) | Parallel subagent dispatch and output persistence | ORCH-1 | §Orchestration.C |
| A | [Historical Changelog](#appendix-a-historical-changelog) | Provenance, validation dates, review process meta-observations | — | — |
| B | [Unified Summary Table](#appendix-b-unified-summary-table) | All pitfalls at a glance, with severity and status | — | — |

---

# Section 1: Cloudflare Workers & D1

> **Reader context:** I'm building or reviewing code that queries D1, runs in the Workers runtime, or reads Cloudflare bindings. These pitfalls are about the platform's hard limits and runtime constraints — the ones that pass every local test and fail only in production.

---

### PLAT-1: D1 rejects any query binding more than 100 parameters

**The Flaw:** A query builds `... WHERE col IN (${ids.map(() => "?").join(",")})` and binds `...ids`, where `ids` comes from a user-controlled or cross-record union with no cap on its length. D1 enforces a hard limit of **100 bound parameters per query** ([platform limits](https://developers.cloudflare.com/d1/platform/limits/)); past that, the statement throws `D1_ERROR` at execution.

**Why It Matters:** The failure is invisible until production and scales with engagement. In Movie Night, each profile caps its comfort and watchlist at 50 ids *each*, so a two-member match unions up to 200 ids into a single `IN (...)` — `getTitlesMap` and `selectCandidates`' referenced-id lookup both threw `D1_ERROR`, which isn't a `MatchingError`, so it surfaced as a generic `500 "Match failed"`. The couples who hit it were exactly the most engaged ones (fullest profiles), and nothing told them their profiles were "too full." Critically, the fake D1 (`node:sqlite`, variable limit 999) accepted the oversized query, so the whole test suite proved the path worked while production would reject it.

**The Fix:** Chunk any id list that can exceed the ceiling and run one query per chunk, merging results. `src/lib/db.ts` exports `chunk(items, size)` and `D1_IN_CHUNK_SIZE` (90 — headroom for other bound params in the same statement):

```ts
const map: Record<number, TitleSummary> = {};
for (const ids of chunk(tmdbIds, D1_IN_CHUNK_SIZE)) {
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db.prepare(`... IN (${placeholders})`).bind(...ids).all();
  for (const row of results) map[row.tmdb_id] = /* ... */;
}
```

The fake D1 now throws at 100 bound params (see testing-pitfalls §7) so this class of bug is provable in a unit test.

**The Lesson:** Any `IN (...)` (or multi-row insert, or any statement) whose parameter count grows with a collection — especially a user-controlled or cross-record one — needs a chunk boundary below 100. Audit every dynamically-built placeholder list: if you can't prove the collection is bounded under 100, chunk it. And a fake that's more permissive than the real service hides exactly these bugs — make the fake enforce the limit.

---

### PLAT-2: Independent D1 reads awaited one at a time each cost a network round trip

**The Flaw:** A handler needs several rows, so it awaits one read, then the next, then the next. Nothing in the later reads consumes an earlier read's result — they are keyed on the same id, or on nothing at all — but each `await` is a separate request to D1 and the handler waits out every one of them in turn.

**Why It Matters:** Locally this is free. `wrangler dev` runs the Worker and D1 in the same process, so a query costs microseconds and the whole chain disappears into the noise. In production every D1 call is a network round trip from the Worker to the database, and Cloudflare's own changelog calls cross-region D1 latency "an outsized latency factor" ([D1 Worker API latency](https://developers.cloudflare.com/changelog/post/2025-01-07-d1-faster-query/)). In Movie Night the heaviest query in the codebase measured 0.095 ms against a 1,000-title catalog while `POST /api/movie-sessions/[id]/match` spent thirteen sequential trips to D1 — the cost was entirely in the trips, not the SQL. The same shape showed up as one statement per referenced id on the profile PUT, where 100 ids cost 16.7 ms locally against 0.001 ms of actual SQL.

**The Fix:** Send the independent reads together. `db.batch()` is one request however many statements it carries ([D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)), so the saving is a round-trip count and not merely an overlap:

```ts
const [round, month, members] = await db.batch([
  roundNumberStatement(db, sessionId),
  matchesThisMonthStatement(db),
  sessionMembersStatement(db, sessionId),
]);
```

Two things this costs. A batch is a transaction, so the statements share one snapshot — usually what you want for reads of the same table, but a deliberate change in consistency, not a free one. And an eager batch runs every read even when an earlier result would have short-circuited the handler, so a failing read can surface ahead of a cap or authorization response that would otherwise have returned first. Keep reads that gate a response — authorization, membership — out of the batch and ahead of it.

**The Lesson:** Count the `await`s on a hot path before optimising a query. At this app's data scale the number of sequential D1 round trips dominates SQL execution time by two orders of magnitude, and a chain of reads that depend on nothing is the cheapest latency in the codebase to remove. Statement counts are assertable — `src/test/statement-recorder.ts` records round trips — so the budget belongs in a test, not in a comment.

---

### PLAT-3: D1 refuses `pragma_*` table-valued functions joined across every table

**The Flaw:** Introspection code wants each table's columns, so it joins `sqlite_master` against `pragma_table_info(m.name)` in one statement. It works against a single named table, so the approach looks sound; run unfiltered across the whole schema and D1 rejects it with `not authorized: SQLITE_AUTH`.

**Why It Matters:** The failure mode is worse than a plain rejection because the *narrow* form succeeds. A first spike written against one table passes, the code is generalised to all tables, and it fails only against real D1 — not under `node:sqlite`, which has no such restriction, so no unit test catches it. Found 2026-08-01 while building `scripts/preflight.ts`, whose entire job is to detect unapplied migrations before a deploy; the check that was supposed to prevent a broken deploy was itself broken in a way only the real platform reveals.

**The Fix:** Read the DDL instead of asking the engine to introspect. `sqlite_master.sql` carries the `CREATE TABLE` text, and parsing column names out of it needs no table-valued function and no elevated authorization:

```ts
const { results } = await db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
  .all<{ name: string; sql: string }>();
// derive columns from each row's CREATE TABLE text
```

**The Lesson:** SQLite features that depend on the authorizer — `pragma_*` table-valued functions, some `ATTACH` forms — are where D1 diverges most sharply from a local SQLite, and the divergence is invisible to the fake. Any introspection that must run against production should be exercised against real D1 with `--remote` before it is trusted, not merely unit-tested. See also `docs/deploy.md` §Pending migrations, which documents the same constraint at the operational level.

---

### Review Checklist

- [ ] **PLAT-1** — Every dynamically-built `IN (...)` / multi-bind query whose parameter count grows with a collection is chunked below 100 bound params (via `chunk` + `D1_IN_CHUNK_SIZE`), and the collection is not assumed small.
- [ ] **PLAT-2** — No hot path awaits two D1 reads in sequence when neither consumes the other's result. Independent reads travel in one `db.batch()`, reads that gate the response stay ahead of it, and the round-trip count is pinned by a test.
- [ ] **PLAT-3** — No query joins a `pragma_*` table-valued function across the whole schema. Schema introspection reads `sqlite_master.sql`, and anything that must run against production D1 has been exercised with `--remote`, not only against the fake.

---

# Section 2: Presentation & CSS

> **Reader context:** I'm styling a component, expressing a state visually, or reviewing a UI diff. These pitfalls are about presentation code that looks correct in the source and behaves differently — or not at all — in a browser.

---

### UI-1: A utility beside `animate-rise-fade` is inert, and reduced motion switches it on

**The Flaw:** A component expresses a state by adding a plain utility — `opacity-50` for a removed item, say — to an element that already carries `animate-rise-fade`. The source reads as though the state is dimmed. It is not: CSS Cascading L5 ranks **animation declarations above normal author declarations**, and `--animate-rise-fade` (`globals.css`) carries `both` fill with `opacity` at both keyframe ends, so the animation's value wins during the delay, during the run, and forever after it settles.

**Why It Matters:** The bug is invisible from both directions. Reading the source, the state looks styled. Looking at the app, the state looks correctly *un*-dimmed, so nothing seems wrong. Then the app's two reduced-motion mechanisms — `@media (prefers-reduced-motion: reduce)` and `[data-reduced-motion="true"] *`, both `animation: none !important` — remove the animation declaration, and the utility starts working. **The result is a state that renders differently for users who asked for less motion, and only their rendering was never reviewed.** Found 2026-08-02 in `ranked-list.tsx`: a removed pick's wash took `ash` metadata from 6.21:1 to **2.46:1**, and the row's own still-live Keep button drew its `border-ash` boundary at 2.46:1 against 1.4.11's 3:1 floor. Nothing in that row is inactive, so the criterion's exemption for inactive components does not apply.

**The Fix:** Do not express state with a bare declaration on an animated element. Use the token vocabulary the design system already has for the state (`slate`/`ash` for inactive), or a property the entrance animation does not touch (`line-through`, a border colour, an added text line). `control-contrast.test.tsx` now sweeps the whole of `src/` for `opacity-*` with an **empty** allowlist, so a new instance fails a test rather than shipping.

**The Lesson:** Any state expressed as a plain declaration on an element that also animates has **two renderings**, selected by a user preference, and code review sees only one of them. When auditing motion, do not only ask "does the animation look right" — ask "what does this element look like with `animation: none`, and has anyone checked?" Toggling the app's reduced-motion attribute on the same DOM is a two-second check that reveals it. See also testing-pitfalls §9.

---

### UI-2: A source sweep proves a class is present, not that a target is big enough

**The Flaw:** A design-system audit greps `src/` for size classes, finds every interactive element carries `min-h-11` / `min-h-12` / `size-11` or inherits one from `control-classes.ts`, and reports the touch-target dimension clean.

**Why It Matters:** Height and width are not symmetric. A class can set one while the other is content-driven, and content changes with viewport. Found 2026-08-02: `ProgressSteps` sets `min-h-11`, so height was never wrong — but width followed its contents, and below `sm:` the step label is `sr-only`, leaving the 28px marker as the entire target. Measured **32×44** at 375px. The source sweep had reported "no touch-target misses" one commit earlier; the very next commit found three. Two individually correct decisions collided — the `sr-only` label is the pattern that protects 320px reflow — and neither could see the other. A grep cannot see a collision between two classes whose interaction depends on a media query.

**The Fix:** Measure. `getBoundingClientRect()` on a running page at the target viewport is the only evidence for a size claim. Where a class is the assertion (jsdom has no layout), say so in the test and record the browser measurement in the report the test cites.

**The Lesson:** A source sweep and a measurement answer different questions, and only one of them is "is this target big enough." State which one an audit performed. An audit that reports a dimension clean without having measured it is worse than one that says "not checked" — it closes the question with a claim it cannot support.

---

### Review Checklist

- [ ] **UI-1** — No state is expressed with a bare declaration (opacity, transform, filter) on an element that also carries an entrance animation. The reduced-motion rendering of any state-bearing element has been checked, not assumed.
- [ ] **UI-2** — Every touch-target claim rests on a measurement at the target viewport, not on the presence of a size class. Where a test asserts the class (jsdom has no layout), the test says so and cites the report holding the measurement.

---

# Section 3: The Prompt as a Data Structure

> **Reader context:** I'm changing what `buildMatchingPrompt` sends. The prompt is not prose — it is a serialized structure with invariants that other code and other tests depend on, assembled from user-controlled fields. These are the ways a reasonable-looking edit breaks something that is not visible in the string you just wrote.

---

### PROMPT-1: A predicate about a member reads the stored array, while the prompt renders a sanitized one

**The Flaw:** A branch decides how to describe a member by testing their stored data — `m.vibes.length > 0` — while the block the model actually reads is built from `clampTags(m.vibes)`, which runs `sanitizePromptText` over every entry. The two disagree for any entry that is non-empty in storage and empty after sanitization.

**Why It Matters:** The disagreement is reachable, and it fails toward the dangerous side. `validateTagList` (`src/app/api/user/profile/route.ts`) enforces a type and a **maximum** length, never a minimum, so `vibes: [""]` is a storable profile — and `sanitizePromptText` deletes `\p{Cf}` characters, so a lone zero-width space is also stored non-empty and rendered empty. `trim()` does not catch that one. **🔥 Found 2026-08-02:** the `NOTHING SAVED` marker and the entire `EMPTY PROFILES` rule were suppressed for a member whose rendered block was `- Vibes: ` — an empty field, which reads to the model as *answered with nothing*, strictly worse than the `None selected` the marker was added to replace. Not reachable through the UI (`tag-picker.tsx` trims and rejects blanks); reachable by any API client.

**The Fix:** Compute the predicate over the same transformation the renderer applies, then test for content:

```ts
function hasContent(list: string[]): boolean {
  return list.some((entry) => sanitizePromptText(entry, MAX_TAG_CHARS).trim().length > 0);
}
```

**How to Detect:** For any `.length` test on a member field, ask what the prompt line for that field renders when the array is non-empty. If the answer can be "nothing", the predicate is measuring the wrong thing.

---

### PROMPT-2: The system prompt has invariants; a literal you add can break one

**The Flaw:** A new rule is added to the system prompt with an ordinary bit of technical writing — quoting a token, say — and it silently violates a property that a test elsewhere depends on.

**Why It Matters:** The prompt's *punctuation* is load-bearing for injection detection. `matching.test.ts` pins benign system prompts at **zero** `"` characters, precisely so that a quote appearing in an assembled prompt is unambiguously user content. **🔥 Found 2026-08-02:** the empty-profile marker was first written as `a line beginning "- NOTHING SAVED:"`. Those two literals broke the invariant for every empty profile — and neither of two independent reviewers caught it; the pre-existing test did. Unquoting the reference restored it.

**The Fix:** Before adding text to the system prompt, read what `matching.test.ts` and `matching.injection.test.ts` assert *about the prompt as a string* — quote counts, line counts, per-line prefixes — and write within them. When a new structural token is introduced, add it to `expectStructureIntact`'s invariant list so no payload can add, move or suppress one.

**How to Detect:** Run `matching.injection.test.ts` after any prompt edit. It is the fastest signal that a string-level property moved, and it is cheap.

---

### PROMPT-3: Two instructions that contradict, resolved by ranking them

**The Flaw:** A conditional rule is appended that contradicts a directive already in the prompt, and the contradiction is patched with a precedence clause — "this rule outranks anything above about X".

**Why It Matters:** The qualifier only ever covers the clause its author remembered to name. **🔥 Found 2026-08-02:** the empty-profile rule contradicted the taste-map directive in four places (`sharedVibes lists their strongest vibes`, `overlap describes where their tastes converge`, the `tensionPoints` directive, and the summary instruction) and the override clause named only the last. Both reviewers flagged it independently; the fix was free, because the directive it contradicted was *already* a conditional on `input.solo` and simply needed one more dimension.

**The Fix:** Build the directive for the members actually present instead of stating it and then overriding it. A precedence clause in a prompt is a smell: it exists to patch a contradiction the builder chose to emit.

**How to Detect:** If you are writing "this outranks", "ignore the above", or "notwithstanding" into a prompt, the branch that would have avoided the contradiction is usually one conditional away.

---

### Review Checklist

- [ ] **PROMPT-1** — Every predicate deciding how a member is described is computed over the rendered/sanitized value, not the stored array's length.
- [ ] **PROMPT-2** — String-level invariants (quote count, line prefixes, structural tokens) were read before adding prompt text, and any new structural token is pinned in `expectStructureIntact`.
- [ ] **PROMPT-3** — No precedence clause patches a contradiction that a conditional could have avoided.

---

## Orchestration

Pitfalls that arise when a session dispatches parallel subagents and consolidates their output. The canonical rules live in `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. This section is the discovery hook for plan writers who arrive here via the `writing-plans-enhanced` (or equivalent) mandated-read path — it does NOT restate the rules in full.

### ORCH-1: Analysis Dispatches Must Persist Findings Before Returning

**Trigger:** Your plan dispatches parallel subagents (bug hunts, audits, phased analysis, parallel investigations) whose findings would be expensive to regenerate if lost.

**What you need to do:** Every such dispatched subagent MUST write its complete report to a persistent file BEFORE returning; the response message is not the sole record.

**Read the full rule:** `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. That section carries the copy-pasteable prompt block (with `<PERSISTENCE_PATH>` substitution), file-path conventions, orchestrator commit cadence, and the cases where the rule doesn't apply.

**Why this is in implementation-pitfalls:** because the plan-writing skill mandates reading this file, and this rule has to be noticed at plan-write time (when the dispatch prompts are being drafted), not at execution time (when it's too late). The failure mode — orchestrator context compacting mid-consolidation and lossily dropping findings — is predictable and preventable if the plan author builds persistence into the dispatch prompts from the start.

### Review Checklist

- [ ] **Dispatch prompts include the mandatory-persistence block** — copy from `docs/git-strategy.md` §Output persistence; substitute `<PERSISTENCE_PATH>` with a durable per-subagent path (ORCH-1)
- [ ] **Plan specifies exact persistence paths, not "write somewhere useful"** — ambiguous paths default to `/tmp` under pressure, which doesn't survive (ORCH-1)
- [ ] **Orchestrator commits subagent artifacts wave-by-wave** — committed files land on the campaign branch before consolidation begins (ORCH-1)

---

# Appendix A: Historical Changelog

<!-- TODO: Add changelog entries as the document evolves. Format: -->
<!-- ## YYYY-MM-DD — <event> -->
<!-- - Added PREFIX-N (<title>) — <what and why> -->
<!-- - Updated PREFIX-M — <what changed> -->

TODO — add entries as this document evolves.

---

# Appendix B: Unified Summary Table

<!-- TODO: One row per pitfall for at-a-glance review. Keep in sync with the sections above. -->

| ID | Title | Severity | Status | Domain |
|----|-------|----------|--------|--------|
| ORCH-1 | Analysis Dispatches Must Persist Findings | HIGH | VALIDATED | Orchestration |
| PLAT-1 | D1 rejects any query binding more than 100 parameters | HIGH | VALIDATED | Section 1 |
| UI-1 | A utility beside `animate-rise-fade` is inert, and reduced motion switches it on | HIGH | VALIDATED | Section 2 |
| UI-2 | A source sweep proves a class is present, not that a target is big enough | MEDIUM | VALIDATED | Section 2 |
| PLAT-2 | Independent D1 reads awaited one at a time each cost a round trip | MEDIUM | VALIDATED | Section 1 |
| PLAT-3 | D1 refuses `pragma_*` table-valued functions joined across every table | MEDIUM | VALIDATED | Section 1 |

Severity levels: `CRITICAL` (production data loss / security), `HIGH` (correctness bug under predictable conditions), `MEDIUM` (correctness bug under edge cases), `LOW` (cleanliness / clarity).

Status values: `VALIDATED` (prescribed fix is implemented and tested), `UNIMPLEMENTED` (pitfall documented but fix not yet in code), `SUPERSEDED` (replaced by another entry or no longer applicable).

---

# Appendix C: Document Maintenance Guide

## When to Update This Document

Update this document when any of the following occur:

| Trigger | Action |
|---------|--------|
| Bug hunt finds a generalizable pattern | Add a pitfall to the appropriate domain section |
| Health review flags a cross-cutting issue | Add or strengthen a pitfall |
| Implementation reveals a prescribed fix was wrong | Update the existing pitfall to match reality — the code is the source of truth |
| Code review catches a pitfall already documented here | Strengthen the entry with the new example |
| A pitfall's prescribed fix is implemented | Update the entry's status in Appendix B |
| A feature is removed or an approach abandoned | Mark the pitfall as SUPERSEDED with a note explaining why |
| testing-pitfalls.md adds a new section | Check if a cross-reference should be added here |

**Do NOT update this document for:**

- One-off implementation bugs that don't generalize to a pattern
- Code style preferences or formatting choices
- Performance optimizations without correctness implications

---

## How to Add a Pitfall

### Step 1: Choose the domain section

If the pitfall spans two domains, place it where the reader is most likely to look when they encounter the bug. Add a "See Also" cross-reference in the other section.

### Step 2: Assign the next ID

IDs are sequential within each section (`AUTH-3`, `DB-12`, etc.). Check the last entry in the section and increment. Use a short prefix that matches the section (2-5 letters, uppercase, descriptive).

### Step 3: Write the entry

**For complex findings** (non-obvious failure mode or architectural fix):

```markdown
### SECTION-N: Title

**The Flaw:** What the code does wrong or what's missing.
**Why It Matters:** The production failure mode — what breaks, for whom, and why it's hard to detect.
**The Fix:** The specific code change or pattern to apply. Include a code example when the fix is non-trivial.
**The Lesson:** The generalizable principle. What should the reader watch for in future code?
```

**For simple findings** (one-line pattern substitution, self-evident why):

```markdown
### SECTION-N: Title
[One paragraph: what's wrong, what to do instead, and why. No code example needed.]
```

**Use the right heuristic:** If an implementing agent could correctly apply the fix from just a one-line description without understanding the failure mode, use the condensed format. If they'd need to understand WHY to apply it correctly, use the full format.

### Step 4: Update the review checklist

Add a checkbox item to the section's review checklist (§X.C) that captures the key check for this pitfall.

### Step 5: Update the Table of Contents

Update the entry count in the TOC table (e.g., `AUTH-1 – AUTH-12` becomes `AUTH-1 – AUTH-13`).

### Step 6: Update the Summary Table

Add a row to Appendix B with the pitfall ID, title, severity, status, and domain.

### Step 7: Check for cross-references

- Does testing-pitfalls.md need a corresponding test guidance entry?
- Does another domain section need a "See Also" pointer?
- Does the same pattern exist elsewhere in the codebase? Grep for other instances.

---

## How to Update an Existing Pitfall

1. **Read the current entry** and understand its intent
2. **Check the code** to see what actually changed
3. **Update the entry** to reflect reality — never preserve a prescription that contradicts the code
4. **Update Appendix B** status if it changed (e.g., `UNIMPLEMENTED` → `VALIDATED`)
5. **Check Appendix A** — add a changelog line noting the update date and reason

---

## How to Mark a Pitfall as Superseded

Do NOT delete pitfall entries. Mark them:

```markdown
### SECTION-N: Title

> **SUPERSEDED (YYYY-MM-DD):** [Reason — e.g., "Feature removed in Phase 12" or "Replaced by SECTION-M which covers the broader pattern"]

[Original content preserved below for historical context]
```

Update Appendix B status to `SUPERSEDED`.

---

## Completeness Checklist

**A pitfall update is not complete until ALL of these are done.** Partial updates are how this document drifts — and a drifted document is worse than no document, because it creates false confidence in protections that don't exist.

- [ ] Entry written in the correct domain section with the correct format
- [ ] Entry has the next sequential ID for its section
- [ ] TOC entry count updated
- [ ] Appendix B summary table row added/updated
- [ ] Review checklist (§X.C) updated with the corresponding check item
- [ ] Cross-references checked: testing-pitfalls.md, other domain sections, See Also block
- [ ] If the pattern could exist elsewhere in the codebase: grepped for other instances
- [ ] Appendix A changelog updated with date and source

**If you skip any of these steps, the next agent to read this document will not find your pitfall.** The TOC is the routing table — without it, your entry is invisible. The summary table is the audit trail — without it, the next health review won't know your finding was addressed.

---

## Voice and Style Reference

This document uses persuasion principles to ensure agents follow critical practices:

- **Authority** for bright-line rules: "MUST", "Never", "Always", "No exceptions"
- **Implementation intentions** for triggers: "When writing a PATCH handler, ALWAYS use pointer types"
- **Social proof via failure modes**: "Without this, the webhook client follows redirects to internal metadata endpoints — every time"
- **Commitment** via checklists: the review checklists at the end of each section

When writing pitfall entries, apply these principles. A pitfall that says "consider using X" will be ignored under pressure. A pitfall that says "MUST use X — without it, Y happens every time" will be followed.

Reference: the `superpowers:writing-skills` skill (or equivalent in your skill library) carries the full persuasion-principles framework if you want to go deeper.
