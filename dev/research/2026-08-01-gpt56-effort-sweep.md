# GPT-5.6 Terra and Luna — reasoning-effort sweep

**Date:** 2026-08-01
**Companion to:** `dev/research/2026-08-01-subscription-arm-bakeoff.md`, `…-openrouter-spike.md`, `…-cloudflare-ai-spike.md`

Sam asked whether reasoning effort changes anything for this task, and how the Terra and Luna variants
compare. Run on his ChatGPT subscription via `codex exec`, so no marginal cost.

## Method

Identical input to every cell: the committed prompt files (`dev/research/openrouter-spike/prompt-*.txt`,
SHA-256 verified) with the response JSON Schema appended, exactly as the subscription bake-off used.
The fixture is the deliberately opposed pair — Iris (cerebral/suspenseful, dealbreaker Horror) and Theo
(cozy/romantic, dealbreaker War) — with `The Dark Knight` (155) excluded.

Two models × six effort levels × 3 samples = **36 runs**. `minimal` is rejected by these models; the
ladder is `none, low, medium, high, xhigh, max`.

Ordering was measured on the **raw model output**, not on `parseMatchingResponse`'s result, so it stays
a measurement of model behaviour now that the parser sorts (see PR #43).

## Validity, ordering, constraint adherence

**Perfect across the board: 36/36 usable, 0/36 out of order, 0/36 returned the excluded title.**

Every cell of both models produced schema-conformant, parseable output with `matchScore` already
descending and no excluded-title violation. Effort made no difference to any of these — there is no
validity floor to buy your way above.

## Taste balance

The candidate pool offers 13 Theo-serving and 11 Iris-serving ids, so **proportional output is ~54%
Theo**. Anything far below that is leaning toward Iris.

| effort | Terra (Theo:Iris) | Terra split | Luna (Theo:Iris) | Luna split |
|---|---|---|---|---|
| none | 9:9 | 50% | 13:5 | **72%** |
| low | 6:12 | 33% | 5:13 | 28% |
| medium | 6:12 | 33% | 6:12 | 33% |
| high | 7:11 | 39% | 8:12 | 40% |
| xhigh | 7:11 | 39% | 7:11 | 39% |
| max | 9:9 | 50% | 7:12 | 37% |

**Effort does not monotonically improve balance.** Both models sit in a 33–40% band from `low` through
`xhigh`, drifting Iris-ward relative to the 54% available. Terra's best cells are its cheapest (`none`)
and its most expensive (`max`), which at n=3 is more plausibly noise than a real U-curve. Luna's `none`
result (72% Theo) is the single biggest outlier in the table and rests on three samples.

For context, from the same fixture and prompt: **Sonnet 64% Theo, `gpt-5.6-sol` 59%, `deepseek-v4-flash`
27%** (and deepseek returned *no* Theo comfort title in any round). Terra and Luna land between the
frontier arms and the collapsed cheap model — they serve Theo consistently, just less than the pool
offers.

## Latency

Mean wall-clock per run, including Codex harness overhead:

| effort | Terra | Luna |
|---|---|---|
| none | 15s | 35s* |
| low | 17s | 20s |
| medium | 16s | 18s |
| high | 18s | 28s |
| xhigh | 22s | 28s |
| **max** | **42s** | **49s** |

`max` costs roughly 2.5× the latency of `medium` and buys nothing measurable on this task. On a path
that is already the app's slowest and blocks a user-facing button, that is the whole argument.

\* Luna's `none` mean is skewed by one 78s run; the other two were 12s and 15s.

## Conclusion

For this workload, **reasoning effort is not a quality dial — it is a latency dial.** Validity,
ordering and constraint adherence are saturated at every level, and balance moves within noise. If the
`effort` parameter is ever tuned on the Anthropic side, this predicts the sweep will find the same
thing, and that the economical setting is the low end rather than the high one.

Terra and Luna are both credible on validity but lean further from the pool's composition than Sonnet
or `gpt-5.6-sol` did. Nothing here changes the standing recommendation to stay on Anthropic direct.

## Limits

n=3 per cell — enough to show that validity and ordering are saturated (a 0/36 result is robust),
not enough to rank models on balance, where the cell-to-cell spread is comparable to the between-model
spread. Both arms run inside the Codex harness system prompt with the schema pasted as prompt text
rather than enforced by the API, so this says nothing about API-level structured-output behaviour.
Token counts were not usable as a cost signal: repeated identical prompts hit the provider's prompt
cache, so later runs in a cell report a small fraction of the first run's tokens.
