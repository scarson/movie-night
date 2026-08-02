# Cost model — what a match round actually costs

**Date:** 2026-08-02
**Queue item:** 10 in `dev/plans/2026-08-01-next-queue.md`, at its narrowed scope
**Measurement script:** `scripts/measure-prompt.mts` (`npx tsx scripts/measure-prompt.mts`)

Everything here is computed offline. No Anthropic call was made.

---

## What is measured and what is not

The distinction matters more than any number below, so it goes first.

| Quantity | Status |
|---|---|
| Assembled prompt size, in **characters and bytes** | **Measured exactly** — the real `buildMatchingPrompt` output |
| Schema-conformant response size, in characters | **Measured exactly** — valid `MatchingResponse` JSON at realistic prose lengths |
| Tokens | **Estimated** from a chars-per-token band. This is the only estimated input. |
| **Thinking tokens** | **Unknown, and they are billed as output.** See §The number that is actually missing. |
| Published `claude-sonnet-5` rates | Real, and there is a live introductory rate — see §Rates |

**Why a band and not a tokenizer.** Anthropic's `count_tokens` endpoint needs an API key this
project does not have. `tiktoken` is not an acceptable substitute — it is OpenAI's tokenizer and
undercounts Claude by roughly 15–20% on prose and considerably more on structured text, which is
what 93% of this prompt is. So the honest move is to measure characters exactly and show tokens
across **3.2 / 3.6 / 4.0 chars-per-token**, quoting 3.6 as the middle. One `count_tokens` call
closes this the day a key exists.

---

## Rates

`claude-sonnet-5`, per million tokens:

| | Input | Output |
|---|---|---|
| **Introductory — through 2026-08-31** | **$2.00** | **$10.00** |
| Standard — from 2026-09-01 | $3.00 | $15.00 |

**The introductory rate expires in 29 days**, and every table below is given at both. Any budget set
this month against the intro rate is 50% low the moment it lapses. This is not something the earlier
cost tables could have accounted for; it is worth Sam knowing before picking a cap.

---

## Measured prompt sizes

| Shape | system | user | total chars | tokens @3.2/3.6/4.0 |
|---|---:|---:|---:|---:|
| Representative — couple, round 1 | 1,430 | 35,208 | **36,638** | 11,449 / **10,177** / 9,160 |
| Solo — round 1 | 1,496 | 34,666 | 36,162 | 11,301 / 10,045 / 9,041 |
| Worst case — every ceiling at once | 5,272 | 59,981 | **65,253** | 20,392 / **18,126** / 16,313 |

"Every ceiling at once" means both members at 50 comfort titles, 50 watchlist, 30 vibes, 30
dealbreakers, 10 services; 30 mood tags; a 200-char mood note; 50 kept and 100 removed titles; a
300-char steering note; discovery mode; and 200 candidates carrying full-length synopses.

**The candidate block is 93.3% of the representative prompt** (34,177 of 36,638 chars) and 80% of
the worst case. Everything else — both profiles, the mood, the whole system prompt — is the
remaining 7%. Any conversation about input cost is a conversation about `CANDIDATE_CAP = 200`.

---

## Measured response sizes

`MatchingResponse` JSON, schema-conformant, at realistic prose lengths:

| Shape | chars | tokens @3.2/3.6/4.0 |
|---|---:|---:|
| Floor — 5 recs, solo, tight prose | 2,486 | 777 / 691 / 622 |
| Typical — 6 recs, couple, tight prose | 3,008 | 940 / **836** / 752 |
| Generous — 7 recs, couple, long prose | 5,503 | 1,720 / 1,529 / 1,376 |

---

## The number that is actually missing

The queue framed item 10 as replacing an **estimated 3,000-token output**. The measurement above
puts the *visible JSON* at 620–940 tokens for a typical round — roughly a quarter of that. It would
be easy, and wrong, to conclude the old estimate was 4× too high.

`src/lib/matching.ts:579` sends **`thinking: { type: "adaptive" }`** with `effort: "medium"`.
Thinking tokens are billed as output tokens. So:

> **billed output = thinking tokens + response JSON tokens**

and the ~2,100-token gap between the old 3,000 estimate and the measured JSON is, in effect, an
**unlabelled thinking budget**. The old figure may be about right; nobody could say, because nothing
recorded which half it was describing.

That reframes what is still owed. It is not "measure the response" — that is done here. It is
**measure thinking volume at `effort: "medium"` on this prompt**, and that is exactly what the
`tokens_out` field of the first `matching_call` log line reports, since `usage.output_tokens`
counts both. `runMatching` already logs it (`matching.ts:683`). **One served match closes this.**

Until then, every output figure below is given at three assumed thinking volumes so the answer can
be read off once the real number lands.

---

## Cost per round

Input fixed at the representative 10,177 tokens. Output = 836 JSON tokens + assumed thinking.

**At the introductory rate ($2 / $10):**

| Thinking tokens | Billed output | Input cost | Output cost | **Round total** |
|---:|---:|---:|---:|---:|
| 0 (hypothetical floor) | 836 | $0.0204 | $0.0084 | **$0.029** |
| 1,000 | 1,836 | $0.0204 | $0.0184 | **$0.039** |
| 2,164 (i.e. the old 3,000 estimate) | 3,000 | $0.0204 | $0.0300 | **$0.050** |
| 5,000 | 5,836 | $0.0204 | $0.0584 | **$0.079** |

**At the standard rate ($3 / $15), from 2026-09-01:**

| Thinking tokens | Billed output | Input cost | Output cost | **Round total** |
|---:|---:|---:|---:|---:|
| 0 | 836 | $0.0305 | $0.0125 | **$0.043** |
| 1,000 | 1,836 | $0.0305 | $0.0275 | **$0.058** |
| 2,164 | 3,000 | $0.0305 | $0.0450 | **$0.076** |
| 5,000 | 5,836 | $0.0305 | $0.0875 | **$0.118** |

**Worst-case input** (18,126 tokens) adds $0.016 (intro) / $0.024 (standard) per round over
representative — meaningful but not the driver. Output assumptions dominate.

### Retries

The queue's scoping note says "up to 4 calls per round on retry". **The code says 2.**
`matching.ts:651` sets `MAX_ATTEMPTS = 2`, and the second attempt happens only on a `malformed`
response — every other error kind propagates without a retry. So the per-round ceiling is
**2× a round**, not 4×, and only on a parse failure. Corrected here so the ceiling is not
double-counted in whatever cap Sam picks.

---

## Session, couple, and the 2000 cap

Using the middle row (3,000 billed output — the old estimate, now understood as JSON plus
~2,164 thinking) at the **standard** rate, $0.076/round:

| Unit | Rounds | Cost |
|---|---:|---:|
| One match (no refinement) | 1 | **$0.08** |
| A typical evening (2–3 rounds) | 2–3 | $0.15 – $0.23 |
| A session at the 10-round ceiling | 10 | $0.76 |
| A couple watching weekly, ~2 rounds each | ~8/month | **$0.61/month** |
| A couple watching twice weekly | ~16/month | $1.22/month |
| **`MONTHLY_MATCH_LIMIT = 2000` fully spent** | 2,000 | **$152/month** |

At the introductory rate the 2000-cap ceiling is $100/month; from September it is $152/month. If
thinking turns out to run at 5,000 tokens rather than ~2,164, the ceiling is **$236/month**.

**Read the cap as what it is:** 2,000 rounds/month is roughly **250 couples** using the app weekly
at 2 rounds a session, or about 125 couples at twice-weekly. For a private app shared with a handful
of people it is three orders of magnitude of headroom — which is the actual argument for lowering
it, not the dollar figure.

**Recommendation for `MONTHLY_MATCH_LIMIT`:** the model does not pick the number, but it makes the
shape clear. At $0.076/round, a limit of **200** caps exposure at ~$15/month and still supports
~25 couples at weekly-with-refinement — comfortably beyond a private share. The existing per-user
daily cap of 30 already bounds any single account to ~$2.28/day. Both numbers are Sam's; this is the
arithmetic to set them against, and it is now `dev/research/open-decisions.md` #1's missing input.

---

## Prompt caching does not apply here, and the reason is structural

This is the finding worth the most, because it is the opposite of what the queue anticipated.

Anthropic's cache is a **prefix match**, rendered `tools` → `system` → `messages`. Any byte change
invalidates everything after it. Three facts, each verified against the code:

1. **The system prompt is rebuilt every round from per-round user input.**
   `buildMatchingPrompt` interpolates `refinementNote` (kept and removed titles) and `steeringNote`
   (the user's steering text) **into `system`** (`matching.ts:365-372`). Since `system` renders
   before `messages`, a system prompt that changes each round invalidates the entire request —
   candidate block included. No breakpoint placement can rescue this.

2. **The candidate block also changes every round.** `selectCandidates` filters the pool by
   `removedIds` (`matching.ts:156`), which grows with each refinement. Round 2's list is round 1's
   minus the rejected titles — a different string.

3. **The system prompt is below the cache minimum anyway.** Claude Sonnet 5 requires a **1024-token**
   minimum cacheable prefix. The measured system prompt is 1,430 chars ≈ **358–447 tokens** in the
   representative case and 1,496 chars ≈ 374–468 solo. Both are far under. It silently would not
   cache even if it never changed — no error, just `cache_creation_input_tokens: 0`.

**Could it be made to apply?** Only by (1) moving `refinementNote`/`steeringNote` out of `system`
into the tail of the user message, *and* (2) not filtering candidates by `removedIds` — relying on a
prompt instruction to exclude them instead. **(2) should not be done.** The bug hunt found a
`glm-4.7-flash` sample that returned both an explicitly excluded title and a dealbreaker-genre title
with *both passing the parser*, because the ids were valid; production is protected only by these
SQL pre-filters. Trading that guarantee for a cache discount is the wrong trade, and
`dev/handoff-2026-08-02.md` already flags relaxing those filters as measurably risky.

**So: no caching, deliberately.** Worth writing down, because "why aren't we caching a 34,000-character
block that barely changes?" is a question that will be asked again, and the answer is not an oversight.

Two things would change the picture, neither available today:

- **A first round has no `refinementNote` or `steeringNote`**, so the system prompt *is* byte-stable
  across all first rounds sharing a `(solo, discoverNew)` pair. It is just too small to cache.
  Were the shared, non-user-derived instructions ever to grow past 1024 tokens, a breakpoint on
  `system` would start paying — currently it is ~40% of the way there.
- A restructure that put the **candidate block first and everything volatile last** would make the
  93%-of-the-prompt block cacheable *within* a round's retry (the one place the prompt genuinely
  repeats byte-for-byte). At 1 retry maximum and only on malformed responses, that saves ~$0.018 on a
  rare path — not worth a prompt restructure, but it is the only place caching would currently bite.

---

## What would change these numbers

- **Real `tokens_out`.** One served match. Turns the thinking column from three assumptions into one
  number, and is the single highest-value measurement left. Already logged; nothing to build.
- **`effort`.** Set to `"medium"` today. The GPT-5.6 sweep predicts effort is a latency dial more than
  a quality dial (`dev/research/2026-08-01-gpt56-effort-sweep.md`); if that holds for Anthropic,
  `"low"` would cut thinking tokens — the dominant output cost — and the sweep to prove it is already
  queued behind the same API key.
- **`CANDIDATE_POOL_SIZE` / `CANDIDATE_CAP = 200`.** 93% of input. Halving to 100 would cut input
  cost ~46% — around $0.014/round at standard rates. Whether 100 candidates matches as well is an
  eval question, not a cost one, and the eval suite exists to answer it.
- **The rate change on 2026-09-01.** +50% on both sides, mechanically.

## Not done

- No Anthropic call, so no `count_tokens` and no observed thinking volume.
- The chars-per-token band is a general-purpose range, not one calibrated on this prompt's actual
  mix of prose, pipe-delimited rows, and numeric ids. Structured content typically tokenizes
  *worse* than prose, so the true figure likely sits at the high-token end of each band — meaning
  these costs are, if anything, slightly optimistic.
- Nothing here models TMDB, D1, or Workers cost. The Anthropic call dominates by orders of magnitude,
  but "dominates" is an inference from the per-round figures, not a measurement of the others.
