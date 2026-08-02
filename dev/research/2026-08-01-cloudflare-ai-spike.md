# Cloudflare Workers AI as a replacement or backup for the Anthropic matching call

**Date:** 2026-08-01
**Status:** Research spike. No production code changed.
**Question:** Anthropic may get too expensive. Could Cloudflare Workers AI replace or back up `runMatching`?

**Every number below is labelled `[measured]` or `[published]`.** Measured means I obtained it in
this spike against the live Workers AI API. Published means it comes from Cloudflare or Anthropic
documentation. There is no Anthropic API key in this environment, so **no Anthropic figure here is
measured** — the Anthropic side is entirely published rates plus stated assumptions.

---

## 1. Recommendation, up front

**Stay on Anthropic. Do not migrate, and do not build a provider abstraction yet.**

Three findings drive that, in order of weight:

1. **Reliability, not quality, is the blocker.** In a live bake-off, three of the four candidate
   Workers AI models failed outright — HTTP 504 at exactly 60 s, and one returned
   `AiError: 3040: Capacity temporarily exceeded`. Only `@cf/openai/gpt-oss-120b` completed, and it
   completed cleanly and repeatably. Workers AI is serverless shared capacity with no committed SLA
   on model availability; the matching call is the app's single user-facing synchronous path, sitting
   behind a spinner. A provider that returns "capacity temporarily exceeded" on the majority of
   attempts cannot be the primary.

2. **Prompt caching does not make the cost problem go away.** This is the finding I expected to be
   the headline, and it isn't. Two structural reasons, detailed in §6: the large block (CANDIDATES)
   is *computed per session and mutated per round* by `selectCandidates`, so it is not a stable
   prefix; and output tokens — not input — dominate the bill once adaptive thinking is on. Caching
   would need a prompt reorder *and* a change to the never-return enforcement contract, for roughly
   a 19 % saving on multi-round sessions and a small *penalty* on single-round ones.

3. **The cheapest real lever is output tokens, and it's one line.** `output_config.effort` is
   currently `"medium"` with adaptive thinking. Sweeping it down to `"low"` is a one-line change
   whose quality cost is measurable by the eval suite that already exists
   (`src/lib/matching.eval.test.ts`). It attacks the dominant cost term without touching the provider.

**Recommended next step, sized:** a half-day effort sweep against the existing live eval suite
(`RUN_LIVE_EVALS=1`), comparing `effort: low | medium | high` on token spend and on the assertions
that suite already makes. That is the highest ratio of cost saving to risk available, and it needs no
new abstraction, no new provider, and no change to the error taxonomy.

Two things are worth doing *anyway*, independent of cost: put **AI Gateway** in front of the existing
Anthropic call (§7 — spend limits and per-request logging, ~1 hour, no code change to `matching.ts`),
and note that the cost ceiling is already bounded — see §5.

---

## 2. What the matching call actually requires

Derived from `src/lib/matching.ts` and `src/types/matching.ts`, read end to end.

### 2.1 Prompt size and shape

`buildMatchingPrompt` produces a `{ system, user }` pair.

- `system` — role line, injection guardrail, CRITICAL RULES, taste-map note, tone note. Also
  interpolates `refinementNote` (the kept/removed lists) and `steeringNote` (the user's free-text
  feedback). **Measured** with the eval fixtures: 1,618 characters ≈ 400 tokens.
- `user` — one block per member, mood line, the private rough-day weighting note, then the
  `CANDIDATES` block, then the closing instruction.

The `CANDIDATES` block is the bulk. `selectCandidates` caps at `CANDIDATE_CAP = 200` titles, each
rendered as `tmdbId | Title (Year) | Genres | First sentence of synopsis` with the synopsis clamped
to `MAX_SYNOPSIS_CHARS = 160`. The exclusion list is separately capped at
`MAX_REMOVED_TITLE_ENTRIES = 100`, which the code's own comment sizes at roughly 1,000 tokens.

**Measured** in this spike: with the 30-candidate eval fixture the full prompt is 1,546 input tokens.
Extrapolating the per-candidate cost linearly to the 200-title cap lands squarely in the 7,000–9,000
token range the code comments state. **I use 9,000 input tokens as the assumed production figure
throughout; it is an extrapolation, not a measurement.**

### 2.2 The response contract is strict and nested

`isMatchingResponse` (matching.ts:446) is the gate, and it is used on **both** the write path
(`parseMatchingResponse`) and the read path (the session GET). It requires, with no tolerance:

- `conversational: string`
- `recommendations: Array<{ tmdbId: number; matchScore: number; explanation: string }>`
- `tasteMap.members: Array<{ userId, name, summary: string; primaryVibes, genreAffinities: string[] }>`
- `tasteMap.overlap: { summary: string; sharedVibes: string[]; tensionPoints: string[] }`

`parseMatchingResponse` then drops any `tmdbId` not in the candidate set, dedupes, clamps
`matchScore` to 0–100, and throws `thin_results` if fewer than
`MIN_SURVIVING_RECOMMENDATIONS = 3` survive. `MATCHING_RESPONSE_SCHEMA` sets
`additionalProperties: false` at every level.

So the bar is: **three levels of nesting, two sibling arrays-of-objects, and no stray keys.** A model
that emits plausible prose but a loose shape produces a `malformed` error, one retry, then a 502.

### 2.3 It is a reasoning task, not a formatting task

`dev/plans/design-doc.md` is unambiguous about what the output is for. Line 32: every competitor
"treats compatibility as an intersection problem. Movie Night treats it as a reasoning problem."
Line 108: "**The matching quality is the whole game**," quoting Sam directly — "the matching itself
getting scary good at reading both people."

That matters for this decision more than any pricing table. The product is not "return seven movie
titles in JSON." It is "reconcile two conflicting taste profiles, name the tension, and justify each
pick to both people by name." Schema conformance is table stakes; the differentiator is the
reconciliation judgement, and that is the thing hardest to evaluate cheaply.

### 2.4 Locked contracts an alternative must satisfy

- `MatchingErrorKind` — `malformed | timeout | overloaded | rate_limited | thin_results | provider_auth`
- `MATCHING_ERROR_HTTP` in `src/app/api/movie-sessions/[id]/match/route.ts` maps those to status + copy
- `ERROR_FRAMING` in `src/app/results/[sessionId]/page.tsx` maps them to headings and retry affordances
- `runMatching` retries **once** on `malformed` only; every other kind propagates immediately
- `MATCHING_MODEL` and `PROMPT_VERSION` are **persisted per round** in the `recommendations` table
  (`movie-sessions.ts:435`), not merely logged

---

## 3. The provider seam: is `defaultClientFactory` real?

**No. It is a test hook, not a provider seam.** Stated plainly because the distinction decides the
migration estimate.

```ts
export interface MatchingClient {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> };
}
export type MatchingClientFactory = (apiKey: string) => MatchingClient;
```

Both the parameter type and the return type are Anthropic SDK types. Anything injected through this
seam must *impersonate the Anthropic SDK* — construct a `Message` with a content-block array, a
`stop_reason`, and `usage.input_tokens` / `usage.output_tokens`. That is a shim, not an abstraction.
Its 17 call sites are all in `src/lib/matching.test.ts`, which is exactly what a test hook looks like.

### What is genuinely Anthropic-specific

Confined to `callClaude` (matching.ts:557–613) and the imports at the top:

| Surface | Detail |
|---|---|
| Imports | `Anthropic`, `APIError`, `APIConnectionError`, `Message`, `MessageCreateParamsNonStreaming` |
| Model id | `MATCHING_MODEL = "claude-sonnet-5"` |
| Request | top-level `system`; `thinking: { type: "adaptive" }`; `output_config: { effort, format: { type: "json_schema", schema } }` |
| Response | content-block array, thinking-block-first ordering, `stop_reason`, `usage.input_tokens` / `output_tokens` |
| Errors | `instanceof APIError` / `APIConnectionError`, then `err.status` 401/403 → `provider_auth`, 429 → `rate_limited`, 529 or ≥500 → `overloaded` |

Everything else in the file — `selectCandidates`, `buildMatchingPrompt`, `sanitizePromptText`,
`computeWeightNote`, `isMatchingResponse`, `parseMatchingResponse`, the `runMatching` orchestration
and its structured log line — is provider-neutral. That is roughly 85 % of the file.

### What a real seam would cost

`ClaudeCallResult` is *already* the right contract — `{ text, stopReason, inputTokens, outputTokens }`
is provider-neutral. Lifting it into an interface is a small refactor:

```ts
interface MatchingProvider {
  readonly model: string;
  call(prompt: { system: string; user: string }): Promise<ProviderCallResult>;
}
```

- `callClaude` becomes `AnthropicProvider.call`, with the error mapping moving inside it. ~60 lines,
  mostly moved rather than written.
- `runMatching` takes a `provider` instead of a `clientFactory`.
- **The cost is the tests, not the source.** 17 `clientFactory` call sites in `matching.test.ts`, plus
  `route.test.ts` which `vi.mock`s `@anthropic-ai/sdk` module-wide. Those get rewritten to inject a
  provider — mechanical, but a day's work with care.
- `PROMPT_VERSION` must bump (matching.test.ts:501 asserts `"p1.2"`), because `model` and
  `prompt_version` are stored per round and existing rows must stay attributable.

**Verdict: ~1–2 days including test rewrite. Cheap enough to do when there is a reason, and there
isn't one yet.** Building it speculatively is exactly the YAGNI violation CLAUDE.md warns about.

---

## 4. Candidate model inventory

Filtered to models that could plausibly take a 9K-token prompt and emit a strict nested shape.
Everything smaller than ~26B was excluded on the reasoning requirement, and the 8B/3B/1B Llamas were
excluded outright.

All context windows and prices **[published]**, Cloudflare docs, retrieved 2026-08-01.

| Model | Context | Structured output | $/M in | $/M out | Notes |
|---|---|---|---|---|---|
| `@cf/openai/gpt-oss-120b` | 128K | Not listed on model page | $0.35 | $0.75 | Function calling + reasoning. **Only model that passed the bake-off.** |
| `@cf/moonshotai/kimi-k2.5` | 256K | Yes ("structured outputs for agentic workloads") | $0.60 | $3.00 | Frontier-scale, 1T params, vision + reasoning |
| `@cf/moonshotai/kimi-k2.6` | 262K | Yes | $0.95 | $4.00 | **Workers Paid only** |
| `@cf/zai-org/glm-5.2` | — | Not listed | $1.40 | $4.40 | **Workers Paid only**; agentic coding model |
| `@cf/nvidia/nemotron-3-120b-a12b` | 256K | Not listed | $0.50 | $1.50 | Hybrid MoE, function calling + reasoning |
| `@cf/zai-org/glm-4.7-flash` | 131K | Not listed | $0.06 | $0.40 | Cheapest credible option |
| `@cf/google/gemma-4-26b-a4b-it` | — | Not listed | $0.10 | $0.30 | Smallest included |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **24K** | **Yes** — on the official JSON-mode list | $0.293 | $2.253 | Context is tight: 9K prompt + output fits, but with little headroom |

### The structured-output picture is messier than the marketing

Two distinct mechanisms, and they do not line up:

- **JSON mode** (`response_format: { type: "json_schema", json_schema: <schema> }`) has an
  **explicit supported-model list**, and that list is stale — it contains the Llama 3.x family,
  `hermes-2-pro-mistral-7b`, `deepseek-coder-6.7b`, and `deepseek-r1-distill-qwen-32b`. **None of the
  2026-era frontier models (Kimi, GLM, Nemotron, gpt-oss) appear on it.**
- Newer model pages advertise "structured outputs" as a capability, but that is model-native
  behaviour, not the platform's constrained-decoding path.

And Cloudflare's own caveat is blunt **[published]**: *"Workers AI can't guarantee that the model
responds according to the requested JSON Schema."* Complex schemas can return a
`"JSON Mode couldn't be met"` error. JSON mode also does not support streaming.

Contrast with Anthropic's `output_config.format`, which the code already relies on and which
`parseMatchingResponse` calls out in a comment as guaranteed-but-parsed-defensively. **This is a real
regression in guarantee strength, on the exact contract §2.2 says is non-negotiable.**

---

## 5. Cost comparison

### 5.1 Neuron model **[published]**

Workers AI bills in Neurons at **$0.011 per 1,000 Neurons**, with **10,000 Neurons/day free on both
Free and Paid plans**. Per-model rates are published in both dollars and neurons; the neuron figure
is the billing unit and the dollar figure is derived. Workers Paid is $5/month and *retains* the
10,000/day free allocation. Three models are Paid-only: `kimi-k2.6`, `kimi-k2.7-code`, `glm-5.2`.

**Measured** in this spike: a 3,231-token round on `gpt-oss-120b` (1,546 in / 1,685 out) consumed
**164.08 Neurons** = $0.0018. A second identical round consumed **167.96 Neurons**. The API reports
the neuron count per request in `usage`, which makes cost attribution straightforward.

### 5.2 Like-for-like per matching round

**Assumptions, stated because they drive everything:**

- **9,000 input tokens** — extrapolated from the measured 1,546-token 30-candidate prompt to the
  200-candidate cap. Not measured at production scale.
- **Two output cases.** *Low* = 1,700 tokens, the **measured** `gpt-oss-120b` completion length.
  *High* = 3,000 tokens, my estimate for `claude-sonnet-5` with adaptive thinking at
  `effort: "medium"` — thinking tokens bill as output. **This is the softest number in the document**
  and the one worth replacing with production `tokens_out` from the existing `matching_call` log line.
- Anthropic rates **[published]**: Sonnet 5 is $3.00/$15.00 per MTok standard, with an introductory
  **$2.00/$10.00 running through 2026-08-31** — i.e. the intro rate expires this month.

| Provider / model | In | Out | Cost per round |
|---|---|---|---|
| `@cf/zai-org/glm-4.7-flash` | 9,000 | 1,700 | **$0.0012** |
| `@cf/google/gemma-4-26b-a4b-it` | 9,000 | 1,700 | **$0.0014** |
| `@cf/openai/gpt-oss-120b` | 9,000 | 1,700 | **$0.0044** |
| `@cf/nvidia/nemotron-3-120b-a12b` | 9,000 | 1,700 | **$0.0071** |
| `@cf/moonshotai/kimi-k2.5` | 9,000 | 1,700 | **$0.0105** |
| `claude-sonnet-5` @ intro $2/$10 | 9,000 | 1,700 | **$0.0350** |
| `claude-sonnet-5` @ intro $2/$10 | 9,000 | 3,000 | **$0.0480** |
| `claude-sonnet-5` @ standard $3/$15 | 9,000 | 1,700 | **$0.0525** |
| `claude-sonnet-5` @ standard $3/$15 | 9,000 | 3,000 | **$0.0720** |

**Headline ratio: `gpt-oss-120b` is ~12–16× cheaper than `claude-sonnet-5` per round.** That is a real
gap and it is not the reason to stay — reliability and quality are.

### 5.3 The cost problem is already bounded

`DEFAULT_MONTHLY_MATCH_LIMIT = 2000` in `match/route.ts`. At the standard-rate high estimate that is
a **worst-case ceiling of ~$144/month**; at the low estimate, ~$105/month. Round limits
(`MAX_ROUNDS_PER_SESSION = 10`) bound per-session spend on top of that.

That reframes the whole question. This is not an unbounded-cost problem; it is a
"is $100–145/month too much for a side project's core differentiator" problem. If the answer is yes,
the lever is `MONTHLY_MATCH_LIMIT`, which is already an env var, before it is the provider.

The free Workers AI allocation is worth noting for the hybrid case in §8: 10,000 Neurons/day at
~166 Neurons/round is **~60 free matching rounds per day** on `gpt-oss-120b` — around 1,800/month,
which is roughly the same order as the existing monthly cap.

---

## 6. Prompt caching — the option I expected to recommend, and don't

**[published]** Anthropic prompt caching: reads cost ~0.1×, writes cost 1.25× (5-minute TTL) or 2×
(1-hour TTL). Minimum cacheable prefix for Sonnet 5 is **1,024 tokens**. Render order is
`tools` → `system` → `messages`, and it is a **strict prefix match** — any byte change invalidates
everything after it.

Applying that to `buildMatchingPrompt` as it stands today:

**Problem 1: `system` is too small and not stable.** Measured at ~400 tokens, it is below the
1,024-token minimum, so it cannot cache alone. And it is not stable anyway — `refinementNote` (the
kept/removed lists) and `steeringNote` (the user's verbatim feedback) are interpolated *into
`system`*, and both change every round.

**Problem 2: the big block sits behind volatile content.** In `user`, the ~9K-token `CANDIDATES`
block comes *after* the per-member profile blocks and the mood line. A prefix breakpoint before it
would cache only the member blocks — a few hundred tokens, per-group, and therefore worthless.

**Problem 3, the real one: the candidate block is not stable by construction.** `selectCandidates`
filters by dealbreaker genres (per group), by `discoverNew` (per session), and by `removedIds` (which
grows every round). So the candidate block differs across groups *and mutates on every single round
within a session*. There is no stable prefix to cache.

### What it would take, and what it would return

Making caching work needs three changes:

1. Move `refinementNote` and `steeringNote` out of `system` into the user message.
2. Move the `CANDIDATES` block to the front of the user message, with the cache breakpoint after it.
3. Stop filtering `removedIds` out of the SQL candidate pool, so the block is stable within a session.
   The prompt already carries an explicit exclusion list, so this would mean **relaxing the
   never-return guarantee from a SQL pre-filter to a prompt instruction plus a post-filter in
   `parseMatchingResponse`.** A post-filter is equally deterministic, but it raises `thin_results`
   risk and it changes a contract the code comments are emphatic about ("'Never return' has no
   exception for 'but it's on your own list'").

Payoff, standard rates, 9K input, a 3-round session:

- Uncached input: 3 × $0.027 = **$0.081**
- Cached input: one write at 1.25× ($0.0338) + two reads at 0.1× ($0.0027) = **$0.0365**
- Output is unaffected: 3 × $0.045 = $0.135
- **Session total: $0.216 → $0.172, a ~20 % saving.**

And the catch that decides it: **caching only pays from the second round onward.** A single-round
session pays the 1.25× write premium for a cache nobody reads — strictly *more* expensive. If most
sessions are one round (which the "quick match" flow in the design doc is explicitly built to
encourage), caching is a net loss. The 5-minute TTL is also marginal against a couple deliberating
between rounds.

**Conclusion: prompt caching is not the free win. Say so plainly.** The dominant cost term is output
tokens, and caching does nothing for those.

---

## 7. AI Gateway — worth doing regardless

**[published]** AI Gateway sits in front of either provider and offers:

- **Spend limits** (shipped 2026-06-05) — cost-based budgets scoped by model, provider, or custom
  metadata, that *block requests* when exceeded. This is a strictly better version of what
  `MONTHLY_MATCH_LIMIT` does by hand, and it is enforced outside the app.
- **Caching** — response-level, distinct from Anthropic prompt caching. Near-useless here: two
  couples never send the same prompt.
- **Rate limiting** and **request retries** (max 5 attempts; constant/linear/exponential backoff, via
  `cf-aig-max-attempts` / `cf-aig-retry-delay` / `cf-aig-backoff` headers).
- **Request timeouts** (`cf-aig-request-timeout`) which can trigger fallbacks.
- **Fallbacks** — a Universal Endpoint that fails over to another provider on error.
- **Logging and analytics** — per-request cost and token logs, filterable.

Two of these are genuinely valuable to this app *today*, on the existing Anthropic call:

1. **Spend analytics.** Right now cost visibility is the `matching_call` log line and the Anthropic
   console. A gateway gives per-request cost attribution without touching `matching.ts`.
2. **Spend limits.** An enforced dollar ceiling is a better safety net than a round counter.

The retry/fallback features are less useful than they look, because `runMatching` already retries
once on `malformed`, and the SDK is configured `maxRetries: 1` with a deliberate 45 s timeout whose
reasoning is documented in a long comment. Gateway-level retries would layer on top of that and could
push total latency past what the loading narrative is built for.

**Cost of adoption: change the SDK `baseURL` to the gateway endpoint. Roughly an hour, no change to
`matching.ts` logic.** This is the cheapest useful thing in this document.

---

## 8. Hybrid shapes

**(a) Cheap model for sub-tasks, Anthropic for reconciliation — not now, but later.**
There is no sub-task to peel off today; `selectCandidates` is already deterministic SQL, and the one
model call *is* the reconciliation. But the design doc (lines 120–122, 150) already plans Vectorize
embeddings for candidate pre-filtering, and Workers AI embedding models are extremely cheap
(`@cf/baai/bge-m3` at **$0.012/M input tokens [published]**). **That is the right use of Workers AI in
this app** — and it is already on the roadmap. Worth noting it does not compete with the matching call.

**(b) Cloudflare as fallback when Anthropic is down — the tempting one, and I'd still say no.**
Superficially attractive: `overloaded` and `timeout` already exist in the taxonomy, so there's an
obvious place to hook it. But the bake-off found Workers AI itself returning capacity errors on 3 of 4
models. A fallback that is *less* reliable than the primary is not a fallback; it converts a clean
"try again in a moment" into a longer wait followed by the same message, or worse, a `malformed`
error after a schema miss. It also doubles the surface that has to satisfy §2.2 and forces the
provider abstraction from §3 before there is any other reason for it.

**(c) Cloudflare behind `MONTHLY_MATCH_LIMIT` as a degraded-but-working mode — the most interesting
of the three, and still premature.** When the monthly cap is hit, the app currently returns 429
`monthly_cap` with "We're getting a lot of requests right now, try again later." Serving a
Workers-AI-generated round instead would be strictly better than an error *if* quality holds. And the
free allocation (~60 rounds/day) covers overflow at no marginal cost.

But it needs everything a migration needs — the provider seam, a second set of eval assertions, a new
error-taxonomy path, a decision about whether to tell the user the round was generated by a lesser
model — for a code path that only fires when the app is already over budget. **Revisit if the monthly
cap actually starts being hit.** Until then it is speculative work on the cold path.

---

## 9. The quality question, treated as the crux

This is the section that decides the answer, so it is deliberately the least hand-wavy.

### What is known

**Schema conformance is achievable.** `gpt-oss-120b` produced a response that passed
`isMatchingResponse` and `parseMatchingResponse` on both attempts, with no dropped ids, no dealbreaker
violations, and no exclusion-list violation. That was a genuine open question going in, and the answer
is yes — at least for this model, at this prompt size. Cloudflare's own "can't guarantee" caveat means
this is evidence, not a guarantee.

**Instruction-following on hard constraints held.** Across two runs the model never recommended a
Horror title (Iris's dealbreaker), never a War title (Theo's), and never returned The Dark Knight,
which was on the exclusion list. Those are the constraints most likely to produce a visible product
failure, and they held.

### What is not known, and what the bake-off actually suggests

**The reconciliation leans toward one member.** This is the finding that matters, and it is a
judgement call from two samples, so treat it as a signal to investigate rather than a conclusion.

The fixtures are deliberately opposed: Iris is Cerebral / Suspenseful / Mind-Bending; Theo is
Cozy / Feel-Good / Romantic. The picks **[measured]**:

- Run 1: Parasite (80), Inception (78), The Grand Budapest Hotel (75), The Matrix (70), Pulp Fiction (68), City of God (68)
- Run 2: Inception (92), The Matrix (87), The Grand Budapest Hotel (84), Parasite (78), Pulp Fiction (73), Mad Max: Fury Road (68)

In run 2 the top two picks are Inception and The Matrix — squarely Iris's taste, scored 92 and 87.
The only pick that genuinely serves Theo's cozy/romantic profile is The Grand Budapest Hotel. Pulp
Fiction, City of God and Mad Max: Fury Road are violent or bleak, and Theo's profile gives no signal
that would surface them. Notting Hill, Amélie, La La Land, (500) Days of Summer, Ratatouille, WALL·E
and The Intouchables were all available and all passed over.

That is the exact failure mode the product exists to avoid: **an intersection-flavoured answer
dressed as a reasoning answer.** The design doc's whole premise (line 32) is that competitors treat
compatibility as intersection and Movie Night treats it as reasoning. A model that quietly optimises
for the member with the more "recommendable" taste produces valid JSON and a bad product.

I want to be careful about the strength of this claim: **two samples, one model, a 30-title fixture,
and no Anthropic-side comparison run in the same session.** It is entirely possible `claude-sonnet-5`
leans the same way on this fixture. I could not check — there is no Anthropic key in this environment.

**Scale is untested.** The bake-off ran 1,546 input tokens. Production is ~9,000 with up to 200
candidates and up to 100 exclusions. Needle-in-a-haystack behaviour over a long candidate list, and
adherence to a 100-entry exclusion list, are precisely where smaller open-weight models tend to
degrade, and precisely what this spike did *not* test.

**The subtler prompt requirements are untested here — and there is now a documented gate for exactly
this.** `computeWeightNote` produces a private instruction the model must *apply silently*: weight one
member's preferences ~65/35 and never reveal it, "not in the taste map, the explanations, or the
conversational text." That is a privacy feature — it protects the generosity of the person who
toggled rough-day from being visible to its recipient — and a leak is a product failure, not a
formatting failure.

`docs/security/prompt-injection.md` (landed on `dev` in the injection-hardening work, prompt version
`p1.2`) ranks **disclosing that rough-day weighting as the single sharpest target in the app**, and
records the live adversarial pass as an **open launch gate**. Its companion suite,
`src/lib/matching.injection.test.ts`, is a 581-line offline corpus that proves properties of the
*input pipeline* — no forged line, field or block; no control characters; clamps respected — and its
own header is explicit that it proves nothing about model behaviour: *"Nothing here calls Anthropic.
A payload that survives as inert content inside its own field … is a PASS in this suite by design:
neutralising it is the guardrail sentence's job, and only a live pass against the real model can
measure whether the guardrail holds."*

**That has a direct bearing on this decision.** The live adversarial gate is deferred only because no
Anthropic key exists yet; the artifact to close it "in an afternoon" is already written. Adding a
second provider does not split that work — it *doubles* it, and permanently. Every prompt change
would then need two live adversarial passes, and the guardrail is a single English paragraph whose
effectiveness is model-specific. Open-weight models are generally weaker at resisting
instruction-injection than frontier models, so the provider most attractive on cost is also the one
most likely to fail the gate protecting the app's most sensitive feature.

### What evidence would settle it

Concretely, and in increasing cost:

1. **Run the existing live eval suite against Workers AI.** `src/lib/matching.eval.test.ts` already
   encodes the assertions that matter. Pointing it at a Workers AI provider gives a pass/fail on the
   hard constraints for free.
2. **Build the 200-candidate prompt and re-run.** Requires a seeded local D1 (`npm run seed:local`,
   which needs a TMDB key). This is the single highest-value missing measurement.
3. **Run the live adversarial pass that is already specified.** `docs/security/prompt-injection.md`
   is a runnable checklist waiting on an Anthropic key; it is a launch gate regardless of this
   spike's outcome. Run it against Anthropic first to establish the baseline. If a Workers AI arm is
   ever seriously considered, it has to clear the same gate independently — that is the honest
   accounting of what a second provider costs.
4. **The blind A/B already planned.** `design-doc.md` line 155 specifies a Sonnet-vs-Opus test where
   both responses are stored and a couple blind-rates recommendation quality. **Adding a Workers AI
   arm to that experiment is nearly free** and is the only method here that measures the thing that
   actually matters — whether the picks are good for two specific people. Nothing short of human
   preference data settles §9's central question.

---

## 10. Migration cost, if it were ever decided

For completeness. Not recommended.

| Area | Change |
|---|---|
| `matching.ts` | Extract `MatchingProvider` interface; `callClaude` → `AnthropicProvider.call`; add `WorkersAiProvider` calling `env.AI.run` with `response_format: { type: "json_schema", json_schema: MATCHING_RESPONSE_SCHEMA }` |
| Error taxonomy | Map Workers AI errors onto the existing six kinds. `3040 Capacity temporarily exceeded` → `overloaded`; upstream 504 → `timeout`; `"JSON Mode couldn't be met"` → `malformed`. **`provider_auth` has no natural analogue** — the AI binding is ambient in the Worker, there is no API key to revoke, so that branch becomes unreachable for this provider |
| `env.d.ts` / `wrangler.jsonc` | Add `"ai": { "binding": "AI" }` |
| Tests | Rewrite 17 `clientFactory` sites in `matching.test.ts`; rework the module-wide `vi.mock("@anthropic-ai/sdk")` in `match/route.test.ts` |
| Evals | `matching.eval.test.ts` needs a provider-parameterised variant, and the live adversarial pass in `docs/security/prompt-injection.md` must be run **independently against the new provider** — the offline corpus in `matching.injection.test.ts` proves input-pipeline properties and carries over unchanged, but guardrail effectiveness is model-specific and does not |
| `PROMPT_VERSION` | Must bump from `"p1.2"`. `model` and `prompt_version` are stored per round, so historical rows stay attributable. Update the assertion at `matching.test.ts:501` |
| Prompt | Likely needs retuning — the current prompt is written for a model with adaptive thinking; open-weight models generally need more explicit structure. Any retune is another `PROMPT_VERSION` bump |
| Timeout budget | The 45 s SDK timeout is documented as "three times the top of the 5–15 s budget." Workers AI's upstream gateway cuts at 60 s, which is *outside* that budget — so the app's own timeout would fire first, and a slow-but-working Workers AI call would be reported to the user as a failure |

**Estimate: 2–3 days for the code and tests, plus an unbounded amount for prompt retuning and quality
validation.** The second term is the real cost and it is the one that cannot be estimated up front.

---

## 11. Bake-off: full method and results

### Method

Wrangler was already authenticated on Sam's account via OAuth with an `ai (write)` scope
(confirmed with `wrangler whoami`), so **no new credential was created or requested** at any point.

The prompt was built through the app's own code path — `buildMatchingPrompt` imported from
`@/lib/matching`, called with the same `PromptMember` and `CandidateTitle` fixtures the live Anthropic
eval suite uses (`src/lib/matching.eval.test.ts`), plus a one-entry exclusion list
(`The Dark Knight (tmdbId 155)`) to exercise the never-return path. No prompt text was hand-written.

The prompt was serialised to the scratchpad and posted by a throwaway Worker with an
`ai: { binding: "AI", remote: true }` binding under `wrangler dev` — Workers AI has no local
simulation, so this reaches the real service. Replies were judged by importing the app's own
`isMatchingResponse` and `parseMatchingResponse`.

**Limitation, stated plainly:** the fixture is 30 candidates (1,546 input tokens), not the 200-title
production cap (~9,000 tokens). No 200-title dataset exists offline in this repo — seeding requires a
TMDB API key. Padding the block by hand would have been the "hand-written approximation" the brief
rules out, so I did not. **This bake-off therefore under-tests the exact dimension — long candidate
lists — where these models are most likely to fail.**

### Results **[all measured]**

| # | Model | JSON schema | Result | Latency |
|---|---|---|---|---|
| 1 | `@cf/openai/gpt-oss-120b` | yes | **PASS** — parsed, no violations | 10.1 s |
| 2 | `@cf/moonshotai/kimi-k2.5` | yes | FAIL — upstream HTTP 504 | 60.3 s |
| 3 | `@cf/zai-org/glm-4.7-flash` | yes | FAIL — upstream HTTP 504 | 60.2 s |
| 4 | `@cf/zai-org/glm-4.7-flash` | **no** | FAIL — upstream HTTP 504 | 60.1 s |
| 5 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | yes | FAIL — upstream HTTP 504 | 60.1 s |
| 6 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | yes | FAIL — upstream HTTP 504 (reproducible) | 60.2 s |
| 7 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `max_tokens` 2000 | yes | FAIL — **`AiError: 3040: Capacity temporarily exceeded`** | instant |
| 8 | `@cf/openai/gpt-oss-120b` | yes | **PASS** — parsed, no violations | 14.7 s |

Runs 3→4 isolate the schema: `glm-4.7-flash` fails identically with and without `response_format`, so
JSON mode was not the cause. Run 7 is the diagnostic that explains the rest — lowering `max_tokens`
surfaced the underlying error instead of a timeout, and it is a **capacity** error, not a
generation-length one. The 504s at exactly 60 s are the upstream gateway giving up on a queued
request.

Detail on the two passes:

```
=== @cf/openai/gpt-oss-120b (run 1) ===
usage: {"prompt_tokens":1546,"completion_tokens":1742,"total_tokens":3288,"neurons":167.96}
JSON.parse: ok | isMatchingResponse: PASS | parseMatchingResponse: PASS (dropped [])
recommendations: 6 | taste map members: 2 | conversational names both: true | violations: none

=== @cf/openai/gpt-oss-120b (run 8) ===
usage: {"prompt_tokens":1546,"completion_tokens":1685,"total_tokens":3231,"neurons":164.08}
JSON.parse: ok | isMatchingResponse: PASS | parseMatchingResponse: PASS (dropped [])
recommendations: 6 | taste map members: 2 | conversational names both: true | violations: none
```

### Cost incurred

**332.04 Neurons total** (167.96 + 164.08) across the two successful runs; the six failed runs
reported no usage and appear not to have billed. At $0.011/1,000 Neurons that is **$0.0037** — about
3 % of one day's free allocation. Nothing was deployed; the throwaway Worker ran only under
`wrangler dev` and was stopped afterwards.

### Artifacts

`scripts/cf-ai-spike.ts` is committed and carries an ABOUTME header marking it a spike artifact. It
builds the prompt through the real code path and judges a reply with the app's own validators; it is
not imported by any production code and is excluded from the vitest `include` globs (it is not a
`.test.ts`). The throwaway Worker lived in the scratchpad and is **not** committed.

---

## 12. Summary of recommendations

| # | Action | Effort | Rationale |
|---|---|---|---|
| 1 | **Effort sweep** — compare `effort: low / medium / high` against the live eval suite | ~half a day | Attacks output tokens, the dominant cost term. One-line change, existing eval harness |
| 2 | **AI Gateway in front of Anthropic** — spend limits + per-request cost logging | ~1 hour | Enforced budget ceiling and cost visibility, no `matching.ts` change |
| 3 | **Run the live adversarial pass in `docs/security/prompt-injection.md`** against Anthropic | ~an afternoon, once a key exists | Already an open launch gate. Establishes the baseline, and prices what a second provider would cost — it has to clear the same gate independently |
| 4 | **Do not migrate. Do not build the provider abstraction.** | — | Reliability failed the bake-off; quality is unvalidated; the seam is ~1–2 days whenever a reason appears |
| 5 | **Add a Workers AI arm to the planned blind A/B** (design-doc line 155) | marginal | The only method that measures whether the picks are actually good for two people |
| 6 | Revisit the degraded-mode hybrid (§8c) **if `MONTHLY_MATCH_LIMIT` starts being hit** | — | Speculative until the cold path is real |

**If cost pressure becomes acute before any of this lands, the fastest lever is `MONTHLY_MATCH_LIMIT`
— already an env var, already enforced, already bounding worst-case spend at ~$105–145/month.**
