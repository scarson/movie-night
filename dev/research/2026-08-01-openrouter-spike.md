# OpenRouter as a replacement, fallback, or degraded mode for the Anthropic matching call

**Date:** 2026-08-01
**Status:** Research spike. No production code changed.
**Question:** Cloudflare Workers AI turned out to be flaky. Could OpenRouter be used instead?
**Companion:** `dev/research/2026-08-01-cloudflare-ai-spike.md`. This document assumes its findings and does not redo them.

**Every number below is labelled `[measured]` or `[published]`.** Measured means I obtained it in this
spike against the live OpenRouter API. Published means it comes from OpenRouter's or Anthropic's own
current documentation, cited in §11. Where the previous spike's numbers are reused they are marked
`[CF spike]` and carry that document's assumptions unchanged, so the two cost tables are directly
comparable.

**Scope of the bake-off.** Only the cheap models ran on OpenRouter credit. **No Anthropic model and no
OpenAI model was routed through OpenRouter** — Sam's Claude Code and ChatGPT subscriptions supply
those arms, so paying OpenRouter API rates for them would be waste. The Sonnet and GPT-5.6 arms are
run separately and folded in via §10.4; their slots are marked in every comparison table.

---

## 1. Recommendation, up front

**Stay on Anthropic direct. Do not adopt OpenRouter for the matching call.**

The short version: OpenRouter is a well-built product with an unusually good data policy, and it
would solve a reliability problem the app does not have. The flakiness was **Cloudflare Workers AI**,
not Anthropic. Adding a proxy in front of a provider that has not failed buys nothing and costs
something.

Three findings drive that, in order of weight:

1. **The two things you'd want from OpenRouter are mutually exclusive on the same request.**
   OpenRouter's Anthropic-compatible endpoint (the "Anthropic Skin") is the only path that preserves
   `thinking: {type: "adaptive"}`, `output_config.effort` and `output_config.format` — and OpenRouter
   documents it as **"only guaranteed to work with the Anthropic first-party provider,"** advising
   you pin Anthropic 1P as top priority. Pinned to Anthropic 1P, provider failover has nowhere to
   fail over to, and you are calling Anthropic through a proxy for no availability gain. Take the
   other path — the OpenAI-shaped `/v1/chat/completions` with failover live — and you lose the
   Anthropic-native request surface the app is built on. **§4 and §8.**

2. **The reliability problem being solved was never Anthropic's.** The CF spike measured
   `Capacity temporarily exceeded` on **Workers AI**, on 3 of 4 candidate models. It measured nothing
   about Anthropic, because there was no Anthropic key. There is still no evidence that
   `claude-sonnet-5` fails often enough to justify a second network hop on the app's only
   user-facing synchronous path. **Establish the Anthropic failure rate from production
   `matching_call` logs before buying insurance against it.**

3. **Cost moves the wrong way for the same model.** Inference is passed through with no markup
   `[published]`, but credits bought by card carry a **5.5% fee**, so routing `claude-sonnet-5`
   through OpenRouter costs roughly **5.8% more** than calling Anthropic directly — about **+$6–8 a
   month** at the `MONTHLY_MATCH_LIMIT = 2000` ceiling. The saving only appears on a **model switch**,
   and a model switch reopens the injection gate. **§7.**

**Two things genuinely worth knowing, and one worth doing:**

- **The data policy is the best news in this document and is not the blocker the brief expected.**
  OpenRouter states **"We do zero logging of your prompts/completions, even if an error occurs,
  unless you opt-in"** and **"OpenRouter does not use your Inputs or Outputs for model training"**
  `[published]`. Combined with `provider.data_collection: "deny"` per request, the rough-day
  directive can be kept off training paths. It is defensible. It is still *strictly worse than not
  adding a third party at all*, which is the reason this doesn't tip the decision. **§5.**

- **The injection gate survives provider failover, which inverts the brief's presumption.** All seven
  endpoints serving `anthropic/claude-sonnet-5` serve the *same* model snapshot,
  `claude-sonnet-5-20260630` `[published]`. Guardrail effectiveness is model-specific, not
  endpoint-specific, so a gate closed against `claude-sonnet-5` stays closed across Anthropic 1P,
  Bedrock, Vertex and Azure. What breaks the gate is the **opt-in `models` array** (cross-*model*
  fallback), which you simply don't set. **§6.**

- **The bake-off makes the cheap-model question worse, not better** `[measured]`. This is the part I
  expected to come out the other way. Across 24 live samples on three cheap models (§10.3):
  - **only 12 of 24 samples were usable at all**;
  - the **90%-off model failed 8/8** with an upstream 429 and **no failover**, because it has exactly
    one endpoint;
  - the strongest cheap candidate, `deepseek/deepseek-v4-flash`, parsed 7/8 with zero constraint
    violations — and then **collapsed toward one member**: 29 of 40 picks served Iris, it returned
    Iris's comfort titles in nearly every round and **none of Theo's, ever**, all while naming both
    members warmly in the conversational text;
  - **both working models had a median latency at or above the app's 45 s timeout** (35.9 s and
    51.2 s), against a loading narrative written for 5–15 s;
  - and `glm-4.7-flash` produced the spike's one hard-constraint violation, recommending **an
    explicitly excluded title and a dealbreaker-genre title** — caught in production only by
    `selectCandidates`' SQL pre-filter, not by the prompt or the parser (§10.3).

  The CF spike called its version of this "signal, not conclusion" at n=2. At n=7 it is firmer, and it
  is the exact failure the product exists to avoid. **If the degraded-mode idea (§9b) is ever revived,
  OpenRouter is still a better home than Workers AI — but select on endpoint count and measured
  latency, not headline price, and expect to have to prove reconciliation quality separately.** Total
  cost of finding all this out: **$0.055.**

**Recommended next step, unchanged from the CF spike:** the half-day `output_config.effort` sweep
against `src/lib/matching.eval.test.ts`. It attacks output tokens — the dominant cost term — needs no
new provider, no new abstraction, and no second injection gate. OpenRouter does not displace it.

---

## 2. Key handling, and what ran

`OPENROUTER_API_KEY` is present in `/Users/sam/Code/movie-night/.dev.vars`. That file **is** gitignored
(`.gitignore:94`), verified with `git check-ignore` before anything touched it. The key is read into
memory by `scripts/openrouter-spike.ts` and is never logged, echoed, written to an artifact, or
included in this document. `.dev.vars` contains only `OPENROUTER_API_KEY` — there is still no
`ANTHROPIC_API_KEY`.

**Adding `ANTHROPIC_API_KEY` remains worth more than the OpenRouter key.** It unblocks the live eval
suite, the `effort` sweep, and the prompt-injection launch gate — all on the critical path regardless
of how this question resolves. Nothing in this spike substitutes for it:

```bash
printf 'ANTHROPIC_API_KEY=sk-ant-...\n' >> /Users/sam/Code/movie-night/.dev.vars
```

**What ran:** three cheap models × 8 samples = 24 live calls (§10). **What did not, deliberately:**
`claude-sonnet-5` and any OpenAI model. Those arms come from Sam's existing subscriptions, and §10.4
records why their results must not be read as API-mechanics evidence.

---

## 3. What OpenRouter actually is

A routing gateway in front of ~hundreds of models from many providers, behind one API key and one
billing relationship. Two API surfaces:

| Surface | Shape | Notes |
|---|---|---|
| `/api/v1/chat/completions` | OpenAI-compatible | The main surface. Full provider routing, `models` fallback array, `reasoning` normalization. |
| `/api` (the "Anthropic Skin") | **Anthropic Messages API** | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`. Documented as behaving "exactly like the Anthropic API"; thinking blocks, native tool use and streaming pass through untouched. |

The Skin matters enormously for this app and is the reason this question is more interesting than the
Cloudflare one. `defaultClientFactory` already takes a config object:

```ts
export const defaultClientFactory: MatchingClientFactory = (apiKey) =>
  new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
```

Adding `baseURL` there is a **one-line change**. The CF spike's §3 finding — that
`defaultClientFactory` is a test hook and not a provider seam, and that a real seam costs 1–2 days
mostly in test rewrites — **does not apply to the Skin path**, because the Skin *is* the Anthropic
SDK surface. Both of `MatchingClient`'s types stay Anthropic SDK types and stay correct.

That is the whole reason OpenRouter deserves a serious look where Workers AI did not. It is also,
per §4, the exact path that gives up the reliability benefit.

---

## 4. Does OpenRouter's routing genuinely fix a reliability problem?

This is the question the whole thing turns on. The answer is: **yes, mechanically — for a problem the
app has not been shown to have, and not on the path the app would want to use.**

### 4.1 Two separate failover systems, and they cannot be combined

`[published]` OpenRouter has two distinct mechanisms. Conflating them is the main way to get this
analysis wrong.

| | **Provider failover** | **Model fallbacks** |
|---|---|---|
| What varies | The *endpoint* serving one model | The *model* itself |
| Default | **Automatic** (`allow_fallbacks: true`) | **Opt-in** — you must pass `models: [...]` |
| Triggers | Provider downtime / 5xx, rate limiting (429) | Downtime and rate limits after the provider layer is exhausted, **plus** context-length validation errors and moderation refusals |
| Ordering | Stability filter (no outage in last 30s), then inverse-square price weighting; `sort` or `order` disables load balancing and tries in order | Walks the array once, in order, then returns the last error |
| Injection gate | **Survives** — same weights (§6) | **Breaks** — different model, uncertifiable |

**They are mutually exclusive: sending both `fallbacks` and `models` returns a 400.**

### 4.2 The controls that matter

`[published]` `provider` preference fields:

- `order: ["anthropic", ...]` — try these providers in this order; disables load balancing.
- `only: [...]` — restrict to these providers. **Merged with account-wide allowed providers**, which
  is a footgun: a per-request `only` does not fully override account settings.
- `ignore: [...]` — skip these. Also merged with account-wide.
- `allow_fallbacks: false` — hard pin. Guarantees the top provider serves it or the request fails.
- `require_parameters: true` — **only route to endpoints that support every parameter in the request.**
  Load-bearing for this app; see §4.4.
- `data_collection: "deny"` — only providers that don't collect user data. See §5.
- `quantizations: [...]`, `max_price: {prompt, completion}`, `sort: "price" | "throughput" | "latency"`.

### 4.3 The good news: seven endpoints, one model

`[published]` `anthropic/claude-sonnet-5` is served by **seven endpoints**, and every one of them
serves the same snapshot `claude-sonnet-5-20260630`:

| # | Provider endpoint | $/M in | $/M out | Advertises `structured_outputs` |
|---|---|---|---|---|
| 1 | Anthropic (first-party) | $2.00 | $10.00 | **yes** |
| 2 | Amazon Bedrock (global) | $2.00 | $10.00 | **yes** |
| 3 | Amazon Bedrock (bedrock-specific) | $2.00 | $10.00 | **yes** |
| 4 | Azure | $2.00 | $10.00 | **yes** |
| 5 | Google Vertex (global) | $2.00 | $10.00 | **no** |
| 6 | Google Vertex (Europe) | $2.20 | $11.00 | **no** |
| 7 | Amazon Bedrock (us-east-1) | $2.20 | $11.00 | **yes** |

All at 1M context and 128K max completion. This *is* a genuine availability story: an Anthropic
capacity event that would return 529 direct becomes a silent reroute to Bedrock or Azure, same
weights, same answer quality. It is a better reliability story than Cloudflare's, by a wide margin.

### 4.4 The bad news, part one: two of the seven would break the response contract

Endpoints 5 and 6 (Google Vertex) **do not list `structured_outputs`** in `supported_parameters`.
`parseMatchingResponse` sits on `MATCHING_RESPONSE_SCHEMA` with `additionalProperties: false` at every
level and a three-deep nested shape (CF spike §2.2). OpenRouter is explicit that strict enforcement is
not universal: with `strict: true`, *"some providers guarantee schema-conforming output, while others
translate your schema into their own structured-output format or treat it as a strong hint."*

Default routing is **price-weighted with automatic failover**, so on price ties the router will
eventually land on Vertex, and the app's schema guarantee silently degrades from *enforced* to *hint*.
The result is a `malformed` error, one retry, then a 502 — the exact failure the CF spike flagged
against Workers AI's JSON mode, reappearing here through a different door.

**Mitigation exists and is cheap:** `require_parameters: true`, or `only: ["anthropic", "amazon-bedrock", "azure"]`.
But it must be set deliberately, and it shrinks the failover pool.

### 4.5 The bad news, part two, and the finding that decides §1

**The Anthropic Skin — the only path that preserves the app's request surface — is documented as
"only guaranteed to work with the Anthropic first-party provider,"** with explicit guidance to set
Anthropic 1P as top-priority provider.

So:

| Path | Keeps `thinking` / `effort` / `output_config.format`? | Failover pool | Verdict |
|---|---|---|---|
| **Anthropic Skin, pinned to Anthropic 1P** | Yes — one-line `baseURL` change | **One endpoint.** None. | Anthropic direct, plus a hop, plus 5.8%. |
| **Anthropic Skin, failover on** | Not guaranteed | 7 | Undocumented behaviour on the app's strictest contract. |
| **`/v1/chat/completions` + `require_parameters`** | No — must rewrite `callClaude` and the error mapping | 5 | Real reliability gain, at the CF spike's 1–2 day seam cost, and the effort sweep loses its parameter. |

**There is no configuration that gives both.** That is the finding. Everything else is detail.

### 4.6 Mid-stream

`[published]` *"Once the first token has been written to the client, the HTTP `200 OK` status and
headers are already committed."* Mid-stream errors arrive as SSE with `finish_reason: "error"`, and
**partial delivery prevents provider failover**. Not directly relevant — `callClaude` uses
`MessageCreateParamsNonStreaming` — but it bounds the guarantee: failover protects the *start* of a
call, not the middle of one.

### 4.7 Error taxonomy

`MatchingErrorKind` maps cleanly, which is worth recording since it was a real cost in the Workers AI
analysis:

| OpenRouter | Meaning `[published]` | → `MatchingErrorKind` |
|---|---|---|
| 401 | Invalid credentials | `provider_auth` |
| 402 | Out of credits | **No analogue.** New operator condition — a prepaid-balance failure that direct Anthropic billing does not have. |
| 403 | Guardrail block or moderation flag | **No analogue.** Would surface as an unhandled throw. |
| 408 | Request timed out | `timeout` |
| 429 | Rate limited (honour `Retry-After`) | `rate_limited` |
| 502 | Model down / invalid upstream response | `overloaded` |
| 503 | **No provider meets your routing requirements** | `overloaded` — and note this is a *new* failure mode created by `require_parameters` / `only` |

The existing `err.status >= 500 → overloaded` branch absorbs 502/503, and 429/401/403 already map. So
the taxonomy mostly survives — but **402 and 403 are genuinely new**, and 402 in particular is a
foot-gun: a prepaid balance hitting zero takes down the app's only synchronous path with an error the
UI has no framing for.

---

## 5. Data policy — treated as a first-class blocker

The brief was right to insist on this and right that it could be disqualifying. It isn't, but the
reasoning matters more than the verdict.

### 5.1 What is at stake

`docs/security/prompt-injection.md` §1.1 ranks disclosure of the rough-day weighting as **the single
sharpest target in the app**. `computeWeightNote` puts a `PRIVATE — apply silently` directive in the
same user message as both members' comfort lists, watchlists, vibes and dealbreakers. CLAUDE.md makes
it a hard invariant: *"Never expose one member's toggle to other group members."*

So the prompt carries, in one string: two people's private taste profiles, and a directive whose
disclosure defeats a privacy feature aimed at one specific person. Adding a third party to that path
is a privacy decision.

### 5.2 What OpenRouter states `[published]`

| Question | Answer |
|---|---|
| Does OpenRouter log prompts/completions? | **No, by default.** *"Prompt and completion are not logged by default. We do zero logging of your prompts/completions, even if an error occurs, unless you opt-in."* |
| What is retained by default? | *"basic request metadata (timestamps, model used, token counts)."* |
| Can logging be turned on? | Yes — voluntarily, for a 1% usage discount. **Leave it off.** |
| Does OpenRouter train on inputs? | **No.** *"OpenRouter does not use your Inputs or Outputs for model training."* |
| Can prompts reach providers that train? | Yes, unless prevented. *"Some Model Providers may use your Inputs and Outputs for model training or improvement."* |
| What prevents that? | Two controls, below. |
| Retention period for text? | **Not stated numerically.** Only *"as long as is reasonably necessary to comply with our business and legal obligations."* Non-persistence is stated explicitly for image/audio/video, **not** for text. |

### 5.3 The controls, and whether they are per-request

Both, which is the right answer:

- **Account-wide:** a "model training" toggle in privacy settings. *"If you opt out of training in
  your account settings, OpenRouter will not route to providers that train."* Providers that log data
  or have unconfirmed policies do not receive requests unless the toggle is on. Separate settings for
  paid and free models.
- **Per-request:** `provider: { data_collection: "deny" }` — *"only providers which do not collect
  user data."*

Set both. Defence in depth, and the per-request form survives someone else changing an account
setting.

**One trap worth writing down:** `only` and `ignore` are documented as **merged with account-wide
settings**, not overriding them. So per-request provider restrictions are additive to account state,
which means the account settings page is load-bearing config that lives outside the repo and outside
code review. That is a real operational weakness for a privacy invariant.

### 5.4 Verdict, stated plainly

**Not disqualifying. Also not free, and the honest framing is "as good as a third party gets," not
"airtight."**

Airtight would be: a stated numeric retention period for text, a published subprocessor list, and a
contractual ZDR commitment. OpenRouter provides none of those. What it provides is a clear
zero-logging default, an explicit no-training statement, and both account and per-request controls to
keep prompts off training providers. For a side project that is a defensible posture — genuinely
better than most gateways.

But the comparison is not "OpenRouter vs. a bad gateway." It is **"OpenRouter vs. not adding a party
at all."** Today the rough-day directive travels from a Cloudflare Worker to Anthropic and stops.
Routing it through OpenRouter means one more organisation, one more breach surface, and one more
privacy policy that can change, in exchange for — per §4.5 — either no reliability gain or a rewritten
call path. **On this axis alone the trade is unfavourable, and it compounds §1's other two findings
rather than standing against them.**

If OpenRouter is ever adopted, the two non-negotiables are: account-wide training opt-out **off**,
and `data_collection: "deny"` on every request, asserted in a test.

---

## 6. The injection-gate consequence

The CF spike's sharpest point: guardrail effectiveness is **model-specific**, so a second provider must
clear the prompt-injection launch gate independently, and every future prompt change then needs two
live adversarial passes forever.

**The brief's presumption — that automatic routing makes the gate unclosable — turns out to be wrong
in the specific case that matters, and right in the case you must avoid.**

### 6.1 Provider failover preserves the gate

The gate is closed against a **model + prompt version** pair (`prompt-injection.md` §4.3: *"The gate
is closed against a specific model and prompt version, not forever"*). All seven
`anthropic/claude-sonnet-5` endpoints serve `claude-sonnet-5-20260630`. Same weights ⇒ same guardrail
behaviour ⇒ **a gate closed against `claude-sonnet-5` remains closed** whether Anthropic, Bedrock,
Azure or Vertex served the request. Endpoint identity is not a variable the guardrail depends on.

This is a real and slightly surprising result: **default provider routing does not cost you the gate.**

Two caveats, both narrow:

- Serving stacks are not bit-identical — sampling defaults and system-prompt handling can differ
  subtly by platform. The claim is "same weights," not "provably identical behaviour." A prudent gate
  closure would record which endpoints were exercised.
- For **open-weight** models the endpoints table exposes a `quantization` field, and a guardrail
  certified against one numeric format does not obviously transfer to another. Irrelevant for Claude
  (all seven report `quantization: unknown`, i.e. first-party serving), but it bites hard on the §9b
  cheap-model shape — and this is **measured, not hypothetical**. `z-ai/glm-4.7-flash` has four
  endpoints and they do not agree:

  | Endpoint | `structured_outputs` | Quantization |
  |---|---|---|
  | DeepInfra | yes | **bf16** |
  | Venice | yes | **fp8** |
  | Cloudflare | yes | unknown |
  | Novita | **no** | bf16 |

  Default routing treats these as one model. They are one set of weights at **three different numeric
  precisions**, and an injection gate closed against the bf16 host is not evidence about the fp8 host.
  On the cheap-model path, `quantizations` must be pinned alongside the model or the gate means
  nothing.

- **`require_parameters: true` demonstrably works** `[measured]`. Novita is the one glm-4.7-flash
  endpoint lacking `structured_outputs`; across 24 live samples in this spike the request was served
  by DeepInfra, Venice and Cloudflare and **never once by Novita**. The guard is real, not
  aspirational — but note it is doing load-bearing work that is easy to forget to set, and §4.4 shows
  the same guard is what drops Vertex from the Claude failover pool.

### 6.2 Model fallback destroys it — so don't set it

The `models` array is **opt-in**. Setting it means a moderation flag or a context-length error can
silently swap in a model you never certified, and the response's `model` field is the only signal.
That is precisely the unclosable gate the brief describes.

**Rule: never set `models` on the matching call.** It is one line of restraint, and it is the entire
mitigation.

### 6.3 What it costs in the reliability benefit it was adopted for

This is where the honest accounting lands, and it is not the trade the brief anticipated:

- Pinning the **model** costs nothing — seven endpoints remain.
- Pinning the **parameters** (`require_parameters: true`, needed for structured outputs per §4.4)
  drops Vertex: seven → **five**.
- Pinning to the **Anthropic Skin** for `effort` and adaptive thinking (§4.5) drops everything else:
  five → **one**.

So the gate is not what kills the reliability benefit. **The app's own request surface is.** The
injection gate survives comfortably; `output_config.effort` and `output_config.format` are what force
the pin down to a single provider.

---

## 7. Cost

Same assumptions as the CF spike, so the tables compose:

- **9,000 input tokens** — extrapolated from the CF spike's measured 1,546-token 30-candidate prompt
  to the 200-candidate cap. Not measured at production scale.
- **Two output cases.** Low = 1,700 tokens (the CF spike's *measured* `gpt-oss-120b` completion
  length). High = 3,000 tokens, an *estimate* for `claude-sonnet-5` with adaptive thinking at
  `effort: "medium"`.
- **`[CF spike]` flags this as the softest number in both documents, and it still is.** It is an
  estimate, not a measurement. Production `tokens_out` from the existing `matching_call` log line
  replaces it the moment the app has traffic; until then every Sonnet row below inherits its error.
- Anthropic rates `[published]`: Sonnet 5 standard $3.00/$15.00 per MTok, introductory $2.00/$10.00
  **through 2026-08-31** — i.e. expiring this month.

### 7.1 Per matching round

| Provider / model | In | Out | Cost per round |
|---|---|---|---|
| `inclusionai/ling-2.6-flash` — **tested**, 90% off | 9,000 | 1,700 | **$0.00014** |
| `openai/gpt-oss-120b` via OpenRouter (CoreWeave, $0.03/$0.17) | 9,000 | 1,700 | **$0.00056** |
| `z-ai/glm-4.7-flash` — **tested**, undiscounted | 9,000 | 1,700 | **$0.00122** |
| `openai/gpt-oss-120b` via OpenRouter (Together/Groq tier, $0.15/$0.60) | 9,000 | 1,700 | **$0.0016** |
| `deepseek/deepseek-v4-flash` — **tested**, 36% off | 9,000 | 1,700 | **$0.00174** |
| `@cf/openai/gpt-oss-120b` on Workers AI `[CF spike]` | 9,000 | 1,700 | **$0.0044** |
| `claude-sonnet-5` **direct**, intro $2/$10 | 9,000 | 1,700 | **$0.0350** |
| `claude-sonnet-5` **via OpenRouter**, intro rates + 5.5% credit fee | 9,000 | 1,700 | **$0.0370** |
| `claude-sonnet-5` **direct**, intro $2/$10 | 9,000 | 3,000 | **$0.0480** |
| `claude-sonnet-5` **via OpenRouter**, intro rates + 5.5% credit fee | 9,000 | 3,000 | **$0.0508** |
| `claude-sonnet-5` **direct**, standard $3/$15 | 9,000 | 1,700 | **$0.0525** |
| `claude-sonnet-5` **via OpenRouter**, standard + 5.5% | 9,000 | 1,700 | **$0.0556** |
| `claude-sonnet-5` **direct**, standard $3/$15 | 9,000 | 3,000 | **$0.0720** |
| `claude-sonnet-5` **via OpenRouter**, standard + 5.5% | 9,000 | 3,000 | **$0.0762** |

### 7.2 How the fee actually works

`[published]` *"We pass through the pricing of the underlying providers; there is no markup on
inference pricing."* The cost is upstream of inference:

- **Credit purchase:** Stripe **5.5%** ($0.80 minimum); crypto 5%. To hold $1 of credit you spend
  $1/0.945 = **$1.0582**, so effective inference cost is **+5.8%**.
- **BYOK:** bring your own Anthropic key — **first 1M BYOK requests/month free**, then 5% of what the
  model would have cost on OpenRouter. At `MONTHLY_MATCH_LIMIT = 2000` this is **cost-neutral versus
  direct**, and it is the shape to use if OpenRouter is ever adopted. It does, however, mean supplying
  a key per provider you want to fail over to — so the cheap version of OpenRouter is also the version
  with the smallest failover pool. The tension in §4.5 reappears in the billing model.
- **Regional premium:** Vertex-Europe and Bedrock-us-east-1 are $2.20/$11.00 — **10% above** the other
  five. Price-weighted default routing avoids them, but failover does not.

### 7.3 Against the ceiling

`DEFAULT_MONTHLY_MATCH_LIMIT = 2000` (`match/route.ts:26`), `MAX_ROUNDS_PER_SESSION = 10`.

| Scenario | Worst case / month |
|---|---|
| Anthropic direct, standard rates `[CF spike]` | **$105 – $144** |
| OpenRouter (card credits), standard rates | **$111 – $152** |
| OpenRouter BYOK, standard rates | **$105 – $144** (identical) |
| `gpt-oss-120b` via OpenRouter, cheapest endpoint | **~$1.10** |

So: routing Sonnet through OpenRouter is **+$6–8/month**, exactly the shape the brief predicted. The
`gpt-oss-120b` row is the eye-catching one — a **~63× reduction** — but it is a *different model*, and
buying it means the §6.2 gate work, the §4.4 schema-strictness risk, and the CF spike's unresolved
quality question about taste collapse. The CF spike's framing holds: **this is a budget dial, not a
runaway cost.** If $105–150/month is too much, `MONTHLY_MATCH_LIMIT` is already an env var.

---

## 8. Latency, and what survives the proxy

### 8.1 The extra hop

`[published]` OpenRouter's latency page makes only a qualitative claim — *"heavily optimized to add as
little latency as possible"* — attributed to Cloudflare Workers edge compute and edge-cached key data.
**No committed figure appears on that page.** A ~15 ms figure surfaces in OpenRouter's own material via
search, but I could not confirm it on the canonical page, so treat it as indicative, not published.

Documented conditions where it is worse:

- **Cold edge caches** in a new region — first 1–2 minutes.
- **Low credit balance** (single-digit dollars) or an API key near its limit — extra database checks
  and more aggressive cache expiry, *"until additional credits are added."*
- **A failed initial completion** — failover means a full failed attempt before the retry.

Against a call already budgeted at 5–15 s with a 45 s SDK timeout, ~15 ms is noise. But the third
bullet is not: a failover is a *whole extra round trip*, potentially seconds. That is the honest
latency cost of the reliability feature, and it lands on the app's slowest path. It stays inside the
45 s timeout, but it eats into the loading narrative the timeout comment says is built for 5–15 s.

The second bullet is worth a line on its own: **a low prepaid balance degrades latency before it
causes the 402 in §4.7.** Prepaid billing introduces a performance cliff the app currently has no way
to observe.

**The gateway's own overhead is not the interesting number. Endpoint variance is** `[measured]`. The
~15 ms is real and irrelevant next to what I actually observed for one model slug,
`z-ai/glm-4.7-flash`, on the *identical* request:

| Serving endpoint | Observed latency |
|---|---|
| DeepInfra | **119 – 255 ms** |
| Venice | 593 ms |
| Cloudflare | 1,082 ms |
| (unidentified — no response headers returned) | **> 90,000 ms, aborted** |

That is a spread of roughly **750×**, inside a single model id, with no request change and no
configuration change — purely which endpoint the price-weighted router happened to pick that minute.
Several runs later the same slug that had been answering in 200 ms was reliably exceeding a 90 s
client timeout.

**This is the finding that should temper the whole reliability argument in §4.3.** Provider failover
protects against a provider returning an *error*. It does not protect against a provider that is
merely very slow — OpenRouter's stability filter keys on outages in the last 30 seconds, not on
latency, and `sort: "latency"` is explicitly documented as a preference that "should never prevent
your request from being executed," i.e. not a guarantee. Against the app's 45 s `callClaude` timeout,
a slow-endpoint draw is indistinguishable from an outage: the user sees a spinner and then an error.

So the honest scorecard on reliability is: **more endpoints reduce hard-failure risk and increase
latency-tail risk.** The CF spike rejected Workers AI because capacity errors were frequent; this is
a subtler version of the same problem wearing better clothes.

### 8.2 Do the Anthropic-specific features survive?

The effort sweep is the recommended next step and depends entirely on this.

| Feature | Anthropic Skin | `/v1/chat/completions` |
|---|---|---|
| `thinking: { type: "adaptive" }` | Documented as passed through untouched (thinking blocks preserved) | Normalized to `reasoning`; adaptive-vs-budget distinction **not exposed** |
| `output_config: { effort }` | Should pass through | `reasoning.effort` accepts `max`/`xhigh`/`high`/`medium`/`low`/`minimal`/`none` — but the docs describe a **`budget_tokens` computation** for Claude (`budget_tokens = max(min(max_tokens × ratio, 128000), 1024)`), and `budget_tokens` is **removed on Sonnet 5** (400). The model page separately advertises "adaptive thinking with selectable reasoning effort levels." **The docs contradict each other; this needs measuring.** |
| `output_config.format` json_schema | Should pass through | `response_format` + `structured_outputs`; **not guaranteed strict** (§4.4) |
| `stop_reason`, `usage.input_tokens` / `output_tokens` | Native shape preserved | Different response shape — `callClaude` rewrite |
| `APIError` / `APIConnectionError` mapping | Unchanged | Rewrite |

**The Skin path preserves everything the effort sweep needs; the chat-completions path muddies the
single parameter the sweep exists to vary.** So if OpenRouter were adopted on the chat-completions
path, the recommended cost lever would get *harder* to pull, not easier. Another reason to do the
sweep first, against Anthropic direct, and settle the OpenRouter question afterwards.

### 8.3 A measured portability trap: the answer arrives in `reasoning`, not `content`

`[measured]` This one cost me a false result before it became a finding, so it is worth stating
loudly.

On the chat-completions path, **reasoning-capable models routed through OpenRouter return the entire
structured answer in `message.reasoning`, with `message.content` set to `null`.** Confirmed directly
against `z-ai/glm-4.7-flash` on two different hosts (DeepInfra and Venice), with `finish_reason:
"stop"` and a fully-formed `MATCHING_RESPONSE_SCHEMA` object sitting in the `reasoning` string:

```
message keys: [ 'role', 'content', 'refusal', 'reasoning', 'reasoning_details' ]
  content: null
  reasoning: len=4520 :: "{\n  \"tasteMap\": {\n    \"members\": [ ..."
```

**The first version of my bake-off script read only `content` and scored 8/8 as "empty completion."
That was a false negative — the model had answered correctly every time.** The corrected extraction
(content first, `reasoning` as fallback) turned the same model from 0/8 to 7/8.

Why it matters beyond my script: `callClaude` reads a *text block* out of an Anthropic content array.
A port of it to the chat-completions path that reads `choices[0].message.content` — the obvious,
documented, OpenAI-shaped field — **would classify every one of those replies as `malformed`**,
consume the single retry, and return a 502. Silently, with no error from OpenRouter, on a 200
response.

This is concrete evidence for §4.5's claim that the chat-completions path is a rewrite rather than a
re-point. It is not a hypothetical incompatibility; it is a measured one, and it is invisible until
you dump the whole message object. Any future work on that path must handle both fields.

---

## 9. Shapes worth considering

**(a) OpenRouter as fallback only, Anthropic direct stays primary — the one I expected to recommend,
and don't.**

Superficially the best shape: no change to the happy path, `overloaded`/`timeout` already exist in the
taxonomy as hook points, and unlike the CF spike's equivalent (§8b there) the fallback is *not* less
reliable than the primary. That last point is a genuine improvement over the Cloudflare answer.

But it fails on evidence and on redundancy. **There is no measured Anthropic failure rate to justify
it** — the flakiness was Workers AI's. And OpenRouter's own value here is provider failover, which
means the shape is really "Anthropic direct, and if that fails, ask OpenRouter to try Bedrock/Azure."
That is worth building *only once Anthropic 529s show up in the `matching_call` logs*. Right now it is
insurance against an unquantified risk, and it doubles the request paths that must satisfy the strict
response contract.

**(b) OpenRouter as the degraded mode once `MONTHLY_MATCH_LIMIT` is hit — the most interesting, and
the one that improved most since the CF spike.**

Today hitting the cap returns 429 `monthly_cap` with "We're getting a lot of requests right now."
Serving a cheap-model round instead is strictly better *if quality holds*. Against Workers AI the CF
spike said no, because the free allocation was small and 3 of 4 models failed outright.

**On the published numbers OpenRouter looks like a clear improvement. On the measured ones it is more
equivocal, and the measurement is what should count.** `gpt-oss-120b` does have 18 endpoints at ~8×
less than Cloudflare — but of the three cheap models actually exercised here, one was **unreachable
for all 8 attempts** (single endpoint, upstream 429, no failover possible — §10.3), and another swung
from 200 ms to a 90 s timeout on the same request depending on which endpoint the router drew (§8.1).
That is not the same failure mode the CF spike found on Workers AI, but it is not obviously a milder
one either. **The infrastructure objection did not disappear; it moved from "capacity errors" to
"endpoint lottery."**

What is left on top of that is everything that already mattered: the provider seam (CF spike §3: 1–2
days, mostly test rewrites), a second set of eval assertions, a new error-taxonomy path, an
independent live injection gate, a `quantizations` pin (§6.1), and a product decision about whether to
tell a couple their round came from a lesser model. All on a code path that only fires when the app is
already over budget. **Verdict unchanged and now better evidenced: revisit if the cap is actually
hit.** If it is ever built, build it on OpenRouter rather than Workers AI — but pick the model by
endpoint count and measured latency, not by headline price.

**(c) Full replacement — no.** §4.5. Either it is Anthropic direct with extra steps, or it is a
rewritten call path that degrades the schema guarantee and the effort parameter.

**(d) The shape that actually wins, and isn't OpenRouter:** the CF spike's §7 recommendation —
**Cloudflare AI Gateway in front of the existing Anthropic call.** Spend limits enforced outside the
app, per-request cost logging, `baseURL` change only, ~1 hour. It delivers the observability half of
what a gateway is for, with no third party in the prompt path and no injection-gate implications.
OpenRouter's advantages over it are provider failover (unproven need) and multi-model access (not
wanted yet). **If Sam wants a gateway, that is still the one.**

---

## 10. The bake-off

### 10.1 Method

The prompt is built through the app's own `buildMatchingPrompt`, imported unmodified from
`@/lib/matching`, with the same opposed-taste fixtures the CF spike used: **Iris** —
Cerebral/Suspenseful/Mind-Bending, Horror dealbreaker; **Theo** — Cozy/Feel-Good/Romantic, War
dealbreaker; The Dark Knight (tmdbId 155) on the exclusion list; 30 candidates; mood "Suspenseful".
No prompt text is hand-written anywhere.

**The exact assembled prompt is committed**, verbatim, at:

- `dev/research/openrouter-spike/prompt-system.txt`
- `dev/research/openrouter-spike/prompt-user.txt`
- `dev/research/openrouter-spike/manifest.json` — fixture, SHA-256 of both files, scoring sets, request shape

**These two files are byte-for-byte identical to what was sent to every model.** The script writes
them from the same two in-memory strings it then posts; there is no separate rendering path, no
reformatting, and no truncation. `buildMatchingPrompt` is a pure function of its input — no clock, no
randomness, no environment read — and the fixture is a literal in the script, so the files reproduce
byte-identically on any machine. The manifest records the SHA-256 of each so the other arms can prove
they were given the same input:

```
prompt-system.txt  1,618 chars  sha256 978a85132822871dcfb6f47ce22df6097185ea71abec91e55e853e899ca7abfc
prompt-user.txt    4,705 chars  sha256 a6d1929221382b805bab924d116489ac491c1e67856758ac7a4a604729ff7ba4
```

`[measured]` Determinism is not merely asserted — the bake-off was launched **five separate times**
during this spike (script bugs, timeout tuning, model reordering), and **all five runs emitted these
identical two hashes**, matching the files on disk. The 1,618-character system prompt also matches the
CF spike's independently measured figure exactly, so the two bake-offs are working from the same
prompt.

**The Sonnet and GPT-5.6 arms must be given these two files, not a paraphrase.** Any divergence
invalidates the comparison; the hashes above are how to check.

Replies are judged with the app's own `isMatchingResponse` and `parseMatchingResponse` — the same
validators the write path and the read path use in production.

**Request shape** (`scripts/openrouter-spike.ts`):

```
POST https://openrouter.ai/api/v1/chat/completions
  response_format: { type: "json_schema", strict: true, schema: MATCHING_RESPONSE_SCHEMA }
  provider: { require_parameters: true, data_collection: "deny" }
  max_tokens: 8000
  usage: { include: true }
  // NO `models` array — cross-model fallback would answer from a model this
  // spike never certified. See §6.2. The omission is the mitigation.
```

### 10.2 Candidate selection — and what was rejected

Candidates were filtered on **the app's hard requirements first, price second**, per the requirement
that a model which cannot hold the prompt or emit the shape is not a candidate at any discount.

Hard filters, applied to the full catalogue (`/api/v1/models`, 2026-08-01):

1. **`structured_outputs` support** — `MATCHING_RESPONSE_SCHEMA` is three levels deep with
   `additionalProperties: false` at every level. A model that can only be *asked* for JSON is not a
   candidate.
2. **Context ≥ 32K** — 9,000-token prompt at production scale, plus up to 8K output, plus headroom.
3. **Not reachable by an existing subscription** — Anthropic and OpenAI models excluded from
   OpenRouter spend by policy, not by capability.

176 models cleared those filters. Rejections from the **discounted collection** specifically, since
that was the question asked:

| Discounted model | Discount | Rejected because |
|---|---|---|
| `inclusionai/ring-2.6-1t` | 75% off | **No `structured_outputs`.** The reasoning-tuned 1T variant, and the most painful rejection here — it is exactly the profile this task wants. `response_format` alone is a hint, not enforcement. |
| `tencent/hy3-preview` | 65% off | **No `structured_outputs`, no `response_format`.** No JSON enforcement at all. |
| `meituan/longcat-2.0` | 60% off | **No `structured_outputs`, no `response_format`.** Same. |
| `openai/gpt-5.6-luna` / `-luna-pro` / `-terra` / `-terra-pro` | 50% off | Capable and cheap, but the **GPT arm runs locally via the codex CLI** on Sam's ChatGPT subscription. Not a capability rejection. |
| `z-ai/glm-5.2`, `glm-5`, `glm-5.1` | 70 / 40 / 32% off | Clear the filters, but 3–8× the cost of the chosen three for the same task. Held in reserve. |
| `moonshotai/kimi-k2.6` | 38% off | Clears the filters. **$0.0112/round — 8× the chosen models** and the CF spike already priced it as the expensive end. Held in reserve. |
| `minimax/minimax-m2.7` / `m3`, `xiaomi/mimo-v2.5*`, `poolside/laguna-*` | 60 / 20 / 10% off | Clear the filters; no distinguishing property over the chosen three at similar or higher cost. |

**Selected — three models, 8 samples each:**

| Model | $/M in | $/M out | Modelled $/round | Discounted? | Why |
|---|---|---|---|---|---|
| `z-ai/glm-4.7-flash` | $0.060 | $0.400 | $0.00122 | **No** | **CF bridge.** Was CF's "cheapest credible option" and failed there with reproducible upstream 504s the CF diagnostic traced to *capacity*. Running it here isolates platform from model. Undiscounted, so its price is a stable basis for a decision. |
| `deepseek/deepseek-v4-flash` | $0.140 | $0.280 | $0.00174 | Yes, 36% | Strongest all-round cheap candidate: reasoning-capable, structured outputs, 1M context. |
| `inclusionai/ling-2.6-flash` | $0.010 | $0.030 | $0.00014 | **Yes, 90%** | **The price floor, deliberately.** Steepest discount that still clears the structured-output filter; ~250× cheaper than Sonnet 5 at intro rates. Not reasoning-tuned, so a clean failure is itself a useful result — it bounds how far down the price curve this task can go. |

**Discount shelf-life — read the prices with this caveat.** OpenRouter states only that *"Provider
discounts and promotional pricing can change, so this collection may update as offers change"*
`[published]`; **no end dates are published for any individual discount.** Two of the three selected
models carry promotional pricing, so **two thirds of this bake-off's cost table has an unknown
expiry.** A price that can vanish without notice is not a basis for an architecture decision — which
is part of why `glm-4.7-flash` is in the set at its undiscounted rate. One further discrepancy worth
recording: the collection page advertises `deepseek-v4-flash` at $0.0896/$0.1792 while the live models
endpoint returns $0.14/$0.28 for the default endpoint. **The billed figures in §10.3 are the ones
OpenRouter actually reported per request**, not either advertised number.

**One deliberate omission, flagged rather than decided.** `openai/gpt-oss-120b` — **the only model
that passed the CF bake-off** — was excluded because it carries the `openai/` prefix and the standing
instruction is to spend no OpenRouter credit on OpenAI models. It is worth noting that the *reason*
for that instruction (those models are covered by Sam's ChatGPT subscription) does not apply here:
`gpt-oss-120b` is an open-weight model served by third-party hosts and is **not** available through
any subscription Sam has. Excluding it costs the cleanest model-for-model bridge to the CF spike, for
**$0.005** of credit at 8 samples. I followed the instruction as written rather than reinterpret it.
Adding it back is a one-line change to `MODELS` in `scripts/openrouter-spike.ts`.

### 10.2b Endpoint topology of the tested models — the reliability story is not uniform

`[measured]` The "many providers means resilience" argument does not hold evenly across the cheap
tier, and the differences are large enough to change which model you would pick:

| Model | Endpoints | Lacking `structured_outputs` | Quantizations observed |
|---|---|---|---|
| `deepseek/deepseek-v4-flash` | **22** | **5** (GMICloud, SiliconFlow, Io Net, Novita, and DeepSeek's own endpoint) | fp4, fp8, unknown |
| `z-ai/glm-4.7-flash` | 4 | 1 (Novita) | bf16, fp8, unknown |
| `inclusionai/ling-2.6-flash` | **1** (Novita) | 0 | unknown |

Three things fall out of this:

1. **The price floor has no failover at all.** `ling-2.6-flash` — the 90%-off model — is served by a
   single provider. Adopting it would mean depending on one host with no automatic failover, which
   is *worse* redundancy than calling Anthropic directly. **The steepest discount in the catalogue
   buys the weakest availability**, which is close to the opposite of the reason to use a gateway.
2. **Breadth brings its own hazard.** `deepseek-v4-flash` has 22 endpoints, but nearly a quarter of
   them would silently drop the schema, and they span fp4 through fp8. Without
   `require_parameters: true` the default price-weighted router would eventually pick one of the five.
3. **This is where the injection-gate quantization caveat (§6.1) actually bites.** "One model" spread
   across fp4/fp8/bf16 hosts is not one behavioural target.

It also resolves the price discrepancy noted above: the collection page's $0.0896/$0.1792 for
`deepseek-v4-flash` is the **cheapest endpoint's** discounted rate (Baidu, StreamLake), while the
models endpoint returns $0.14/$0.28 for the default. Both are real; which you pay depends on where
the router lands.

### 10.3 Results

Raw per-sample output, including every full response body, is committed under
`dev/research/openrouter-spike/samples-<model>.md`.

#### `inclusionai/ling-2.6-flash` — the price floor: 0 / 8, and the failure is structural

`[measured]` **Every one of the 8 samples failed with HTTP 429.** Not a slow reply, not a malformed
one — the request never reached a model. The error is worth quoting in full because it explains
itself:

```
inclusionai/ling-2.6-flash is temporarily rate-limited upstream. Please retry shortly,
or add your own key to accumulate your rate limits.
provider_name: "Novita", is_byok: false
```

This is §10.2b's prediction landing exactly as forecast. `ling-2.6-flash` has **one endpoint**. When
Novita rate-limits, OpenRouter has nowhere to fail over to, so `allow_fallbacks` — the default
protection that the entire reliability argument rests on — **has no effect whatever**. The gateway
degrades to a straight pass-through of one provider's 429.

Three things follow, and they generalise beyond this model:

1. **The steepest discount in the catalogue bought the worst availability.** A 90%-off headline price
   is worthless at a 0% success rate. Price and endpoint count should be read together, and the
   catalogue does not present them together.
2. **Provider failover is only as good as the endpoint count**, which varies from 1 to 22 across the
   models tested (§10.2b) and is not visible on the model page — you have to query
   `/api/v1/models/<id>/endpoints` to find it. **Any future cheap-model adoption must check endpoint
   count first**; it is a better predictor of reliability than anything in the marketing.
3. **429 maps to `rate_limited`** in the existing taxonomy, so the app would at least frame this
   correctly — but it would frame it correctly on 100% of requests.

The intended experiment — does the price floor have enough reasoning capacity to reconcile two
opposed tastes? — **did not get to run.** That question is still open for this model, and it is
academic while the model cannot be reached.

#### `deepseek/deepseek-v4-flash` — 7 / 8 parse, and the taste collapse is unambiguous

`[measured]` Schema conformance was good: 8/8 returned HTTP 200 with a schema-valid object, 7/8
survived `parseMatchingResponse`, and **there were no dealbreaker or exclusion-list violations in any
sample** — no Horror for Iris, no War for Theo, and The Dark Knight never returned. The hard
constraints held, exactly as they did for the CF spike's passing model. The one failure was
`thin_results` (DigitalOcean, 333 output tokens — a truncated answer, not a wrong one).

**But the reconciliation is the product, and the reconciliation failed.** Across the 40 recommendations
in the 7 passing samples:

| | Count |
|---|---|
| Picks serving **Iris** (cerebral / suspenseful / bleak) | **29** |
| Picks serving **Theo** (cozy / feel-good / romantic) | **11** |

A 2.6 : 1 skew. It is sharper still at the level of the members' own stated favourites — the most
direct test available, because each member's comfort titles are named in the prompt:

| Comfort title | Whose | Times picked (of 7 samples) |
|---|---|---|
| Inception | Iris | **7** |
| Parasite | Iris | **6** |
| Notting Hill | Theo | **0** |
| Amélie | Theo | **0** |
| La La Land | Theo | **0** |
| (500) Days of Summer | Theo (watchlist) | 1 |

**The model returned both of Iris's available comfort titles in nearly every round, and none of
Theo's, ever.** Two samples (#4, #6) served Theo *zero* times out of five and six picks. Only one
sample (#3) came back balanced at 3–3.

**And it addressed Theo warmly while doing it.** In all 7 passing samples the `conversational` text
named **both** members, as the tone instruction asks. So the failure is not that the model ignored
Theo — it engaged with him, described his taste in the taste map, and then recommended Iris's films.
That is precisely the design doc's *"intersection-flavoured answer dressed as a reasoning answer"*,
and it is worse than an obvious failure because it reads as if it worked.

This is the CF spike's §9 finding reproduced with much stronger evidence — n=7 instead of n=2, on a
different model, on a different platform. The CF spike was careful to call its version "signal, not
conclusion." **This one is firmer: the collapse is not an artifact of one model or one host** (it
occurred across Baidu, AkashML, AtlasCloud and DeepInfra alike), and it is the precise failure mode
the design doc says Movie Night exists to avoid — *"an intersection-flavoured answer dressed as a
reasoning answer."*

What it still does **not** establish is whether `claude-sonnet-5` avoids it on this fixture. That is
what the reserved Sonnet arm is for, and it remains the single most valuable missing measurement.

**Latency is the other problem, and it is disqualifying on its own.** Per-sample wall time was
35.0 s, 33.9 s, 86.3 s, **135.3 s**, 19.9 s, 28.2 s, 37.3 s, 36.7 s — **median 35.9 s, against the
app's 45 s `callClaude` timeout.** Two of the eight (86.3 s and 135.3 s) would have exceeded it
outright, and the median sits close enough that ordinary variance breaches it. Five of the remaining
six sit in the 28–37 s band, which is already double the top of the 5–15 s budget the loading
narrative is written for. A model this slow cannot serve the app's only synchronous, spinner-backed
path regardless of how cheap it is.

Sample #7 also returned scores out of descending order (88, 82, 78, 65, **72**, 58) — the second
independent instance of the ordering defect flagged in §12.

**One thing this bake-off did *not* test, and should not be read as testing.** The script scans every
response for weighting-scaffolding leakage (`65/35`, "weighting", "rough day", "apply silently",
"PRIVATE") and found **zero hits across all 16 responses**. That is not evidence the guardrail holds.
Both fixture members have `roughDay: false`, so `computeWeightNote` emitted the benign *"No preference
weighting — treat all profiles equally"* branch — **there was no secret in the prompt to leak.**
Testing the private-weighting directive requires the adversarial pass in
`docs/security/prompt-injection.md` §4.2 with one member's `roughDay` set, which remains an open
launch gate and is not something this spike touched.

#### `z-ai/glm-4.7-flash` — 5 / 8 parse, and the one hard-constraint violation of the whole spike

`[measured]` The Cloudflare bridge. On Workers AI this model failed with reproducible upstream 504s
that the CF diagnostic traced to capacity. **On OpenRouter it runs** — so the CF failure was the
platform, not the model. That question is settled.

What it does when it runs is a different matter. 5 of 8 parsed. The three failures were all
envelope- or budget-level, not schema-level: one non-JSON envelope, and **two samples that consumed
the entire 16,000-token output budget** (`1531/16000`, 198 s and 218 s) and returned nothing
parseable. Reconciliation, across the 32 picks in the 5 passing samples: **19 serving Iris, 11 serving
Theo** — skewed, but less brutally than deepseek, and it did return La La Land (one of Theo's comfort
titles) three times, which deepseek never managed for any of Theo's.

**Sample #4 is the finding that matters, and it is not about OpenRouter at all.** It recommended:

- **tmdbId 155, The Dark Knight** — the title on the *explicit* exclusion list, named verbatim in the
  system prompt as "Do NOT recommend any of these movies (already rejected)"; and
- **tmdbId 539, Psycho** — a **Horror** title, against Iris's stated Horror dealbreaker.

Both survived `isMatchingResponse` and `parseMatchingResponse` untouched, because both are *valid
candidate ids* — the parser drops unknown ids, it does not re-check dealbreakers or the exclusion
list. This is the only hard-constraint violation in 24 samples, and it is worth stating carefully:

**In production this would not reach a user, because `selectCandidates` removes dealbreaker genres and
`removedIds` in SQL before the prompt is built.** The fixture deliberately leaves them in the
candidate list — exactly as the CF spike's fixture did — so that the *prompt instruction* is what gets
tested. The instruction failed.

That has a direct, unwelcome bearing on a proposal in the CF spike. Its §6 explored making prompt
caching viable by **"relaxing the never-return guarantee from a SQL pre-filter to a prompt instruction
plus a post-filter in `parseMatchingResponse`."** This sample is evidence against that trade: a model
asked in plain English not to return a specific title returned it anyway, and the post-filter as
currently written would not have caught it, because the id is legitimate. If that refactor is ever
revisited, **the post-filter has to be written first and has to check the exclusion list explicitly** —
the SQL filter is not redundant belt-and-braces, it is the thing that actually works.

`selectCandidates`' own comment already says this: *"'Never return' has no exception for 'but it's on
your own list'."* This is a measured instance of why.

**Latency was the worst of the three arms**: 8.6 s, 21.4 s, 26.6 s, 44.3 s, 58.2 s, 127.6 s, 197.8 s,
217.9 s — **median 51.2 s, with 4 of 8 over the app's 45 s timeout.** The 8.6 s best case and the
217.9 s worst case are the same model, same request, on the same provider (DeepInfra), minutes apart.

#### Cross-arm comparison

The scoring instrument is fixed in `manifest.json` and was chosen before any results were seen: of the
5–7 titles a model returns, how many serve **Theo's** cozy / feel-good / romantic profile versus
**Iris's** cerebral / suspenseful / mind-bending one. A balanced split is the product working. A
one-sided split is the intersection-flavoured collapse the design doc says Movie Night exists to
avoid.

| Arm | Where run | n | Parsed OK | Picks: Iris vs Theo | Theo comfort titles returned | Hard-constraint violations | Median latency | Over 45 s |
|---|---|---|---|---|---|---|---|---|
| `inclusionai/ling-2.6-flash` | OpenRouter | 8 | **0 / 8** (all HTTP 429) | — | — | — | — | — |
| `deepseek/deepseek-v4-flash` | OpenRouter | 8 | **7 / 8** | **29 : 11** | **1 of 28** ((500) Days ×1) | none | **35.9 s** | 2 / 8 |
| `z-ai/glm-4.7-flash` | OpenRouter | 8 | **5 / 8** | **19 : 11** | 3 of 20 (La La Land ×3) | **1** (excluded title + Horror dealbreaker) | **51.2 s** | 4 / 8 |
| **`claude-sonnet-5`** | **Claude Code subscription subagents** | — | **RESERVED** | **RESERVED** | **RESERVED** | **RESERVED** | **n/a — see §10.4** | **n/a** |
| **OpenAI GPT-5.6** | **codex CLI, ChatGPT subscription** | — | **RESERVED** | **RESERVED** | **RESERVED** | **RESERVED** | **n/a — see §10.4** | **n/a** |

"Theo comfort titles returned" counts how often the model picked one of the four films Theo actually
named (Notting Hill, Amélie, La La Land, (500) Days of Summer), out of the total opportunities. For
reference, `Inception` alone — one of Iris's two available comfort titles — was returned **11 times
across the two working arms**.

The two reserved rows deliberately have **no latency cell**. Per §10.4 those arms cannot produce
meaningful timing, token or cost figures, and leaving the cell blank is safer than leaving a number
someone might quote.

**What the cheap tier looks like in aggregate, across 24 live samples:** 12 usable responses; a 2.4 : 1
skew toward one member of a deliberately-balanced pair; both working models with a median latency at
or above the app's 45 s timeout; one arm entirely unreachable; and one hard-constraint violation that
only the app's SQL pre-filter would have caught. **None of the three is a viable substitute for the
matching call today**, on quality or on latency, before cost even enters the argument.

#### Cost of the bake-off

`[measured]` **$0.0230 for the final 24 samples**, as reported by OpenRouter's own per-request
accounting. **Total spend on the key across the entire spike — including four earlier aborted runs
(script bugs, timeout tuning, model reordering) and the diagnostic probes — was $0.0549.**

Five and a half cents. The cheap tier really is cheap; that was never the question. Nothing was
deployed, the key was read from the gitignored `.dev.vars` and never written to any artifact, and no
Anthropic or OpenAI model was billed to it.

### 10.4 The other two arms, and how they must be read

| Arm | Where it runs | Status |
|---|---|---|
| `claude-sonnet-5` | Blind subagents on Sam's **Claude Code subscription** | **Slot reserved** — to be folded in |
| OpenAI GPT-5.6 | **codex CLI** on Sam's ChatGPT subscription | **Slot reserved** — to be folded in |

**Both are subscription-harness proxies, not clean API controls. This matters for how the result gets
read, so it is stated here rather than in a footnote.**

They run inside another harness's own system prompt, not the app's exact API call. That means
**adaptive thinking, `output_config.effort`, and structured-output enforcement are NOT the app's
configuration** in those arms. Consequently:

- ✅ **Fair proxy for the substantive question:** does the model serve *both* members of a
  deliberately-opposed pair, or collapse toward one taste? That is a property of the model's
  reasoning over this prompt, and it survives the harness difference well enough to be informative.
- ❌ **Not evidence about API mechanics, latency, token counts, or cost.** Do not quote timings or
  token figures from these arms, and do not read the Sonnet arm as a measured Anthropic baseline.

In particular: **the CF spike's 3,000-output-token estimate for `claude-sonnet-5` remains an
estimate.** These arms do not firm it up, and §7's Sonnet rows still inherit that uncertainty. Only
production `tokens_out` from the `matching_call` log line, or a direct API call with the app's own
parameters, replaces it.

---

## 11. Sources

All retrieved 2026-08-01.

- Provider routing — https://openrouter.ai/docs/features/provider-routing
- Model fallbacks — https://openrouter.ai/docs/guides/routing/model-fallbacks
- Provider failover vs model fallbacks — https://openrouter.ai/blog/insights/reliability-failover/
- Privacy and logging — https://openrouter.ai/docs/features/privacy-and-logging
- Privacy policy — https://openrouter.ai/privacy
- FAQ (fees, logging defaults, BYOK) — https://openrouter.ai/docs/faq
- Structured outputs — https://openrouter.ai/docs/features/structured-outputs
- Reasoning tokens / `reasoning` parameter — https://openrouter.ai/docs/use-cases/reasoning-tokens
- Request parameters — https://openrouter.ai/docs/api-reference/parameters
- Error codes — https://openrouter.ai/docs/api-reference/errors
- Latency and performance — https://openrouter.ai/docs/guides/best-practices/latency-and-performance
- Anthropic Skin / Claude Code integration — https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration
- `claude-sonnet-5` model page — https://openrouter.ai/anthropic/claude-sonnet-5
- `claude-sonnet-5` endpoints — https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5/endpoints
- `gpt-oss-120b` endpoints — https://openrouter.ai/api/v1/models/openai/gpt-oss-120b/endpoints
- Discounted models collection — https://openrouter.ai/collections/discounted-models
- Full model catalogue — https://openrouter.ai/models and https://openrouter.ai/api/v1/models
- Endpoint topology of the tested models — `https://openrouter.ai/api/v1/models/{z-ai/glm-4.7-flash, deepseek/deepseek-v4-flash, inclusionai/ling-2.6-flash}/endpoints`
- Anthropic model IDs and rates — the `claude-api` skill, model catalog and pricing tables

Internal: `dev/research/2026-08-01-cloudflare-ai-spike.md`, `src/lib/matching.ts`,
`src/app/api/movie-sessions/[id]/match/route.ts`, `docs/security/prompt-injection.md`,
`src/lib/matching.eval.test.ts`, `CLAUDE.md`.

---

## 12. Summary of recommendations

| # | Action | Effort | Rationale |
|---|---|---|---|
| 1 | **Do not adopt OpenRouter for the matching call.** | — | The Anthropic Skin gives the request surface but no failover; chat-completions gives failover but not the request surface. No configuration gives both. |
| 2 | **Put `ANTHROPIC_API_KEY` in `.dev.vars`.** | minutes | Unblocks the effort sweep, the live eval suite, and the injection launch gate. Worth more than the OpenRouter key. |
| 3 | **Effort sweep** — `low / medium / high` against `matching.eval.test.ts` | ~half a day | Unchanged from the CF spike. Attacks output tokens, the dominant cost term. Do it **against Anthropic direct**, before any proxy muddies the parameter (§8.2). |
| 4 | **Measure the Anthropic failure rate** from production `matching_call` logs | ~0 | The premise of every fallback shape here. No 529s ⇒ no reliability problem ⇒ nothing to buy. |
| 5 | **AI Gateway in front of Anthropic** (CF spike §7), not OpenRouter | ~1 hour | Spend limits and per-request cost logging with no third party in the prompt path. |
| 6 | If the degraded mode (§9b) is ever built, build it on **OpenRouter rather than Workers AI — but select on endpoint count and measured latency, not price** | — | Measured: the 90%-off model has one endpoint and failed 8/8; the best cheap candidate ran at a ~36 s median against a 45 s timeout and collapsed toward one member 29:11. Cheap models are not currently viable for this call on either axis. Still needs its own injection gate and a `quantizations` pin. |
| 7 | If OpenRouter is ever adopted: **BYOK**, account-wide training opt-out **off**, `data_collection: "deny"` and `require_parameters: true` on every request, **never** set `models` | — | BYOK removes the 5.5% fee; the rest keep the privacy invariant and the injection gate intact. |
| 8 | **Fold in the Sonnet and GPT-5.6 arms** when they land, and read them per §10.4 | — | They answer the taste-collapse question, not the API-mechanics one. |
| 9 | Separately flagged: **`parseMatchingResponse` does not enforce the descending `matchScore` order its own prompt demands** | small | Measured in this bake-off — a model returned 90, 80, 70, **75**, 65, 65 and it parsed clean. `ranked-list.tsx` renders array order, so the "ranked list" silently mis-ranks. Raised as a separate task. |
