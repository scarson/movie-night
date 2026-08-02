# Subscription-arm bake-off — Sonnet and GPT-5.6 against the cheap models

**Date:** 2026-08-01
**Companion to:** `dev/research/2026-08-01-openrouter-spike.md` and `dev/research/2026-08-01-cloudflare-ai-spike.md`

The OpenRouter spike measured three cheap models but had **no frontier control** — the whole reason
its quality finding was labelled "signal, not conclusion". This closes that gap by running the same
prompt through Anthropic Sonnet and OpenAI GPT-5.6 on existing subscriptions, at no marginal cost.

## What was run

Identical input to all arms: the prompt files at `dev/research/openrouter-spike/prompt-*.txt`,
SHA-256 verified unchanged (`978a851…` system, `a6d1929…` user) after being copied to a neutrally
named path so the responders could not infer they were in a comparison.

The fixture is a deliberately opposed pair — Iris (cerebral, suspenseful, mind-bending; dealbreaker
Horror) and Theo (cozy, feel-good, romantic; dealbreaker War) — with `The Dark Knight` (155)
excluded from the round. `manifest.json` defines which candidate ids serve which member.

| Arm | How | Cost |
|---|---|---|
| `claude-sonnet-5` | 8 blind Claude Code subagents | subscription |
| `gpt-5.6-sol` | 8 `codex exec` runs | subscription |
| 3 cheap models | OpenRouter, 8 samples each | $0.055 |

## Results

| Arm | Usable | Theo-serving | Iris-serving | Split |
|---|---|---|---|---|
| **GPT-5.6-sol** + schema | **7/8** | 27 | 19 | **59% Theo** |
| **Sonnet** + schema | 5/8 | 21 | 12 | **64% Theo** |
| `deepseek-v4-flash` | 7/8 | 11 | 29 | **73% Iris — collapsed** |
| `glm-4.7-flash` | 5/8 | — | — | — |
| `ling-2.6-flash` (90% off) | **0/8** | — | — | capacity, no failover |
| Sonnet, **no schema in prompt** | **0/8** | — | — | — |
| GPT-5.6, **no schema in prompt** | **0/8** | — | — | — |

**The headline: both frontier models balance the pair; the cheap model collapses.** `deepseek` returned
Iris's comfort titles nearly every round and *none* of Theo's, ever, while naming both members warmly
in its prose — the intersection-flavoured failure this product exists to avoid. Neither frontier model
did that, neither returned the excluded title, and every usable sample was correctly sorted descending.

**The second finding is arguably more useful than the first.** With the JSON Schema removed from the
prompt, *both frontier models scored 0/8* — they free-formed the member objects, emitting
`vibes`/`dealbreakers` where the contract wants `name`, `summary`, `primaryVibes`, `genreAffinities`.
`output_config.format` is not cosmetic; it is doing the load-bearing work of making the response
parseable at all. Any provider swap that loses strict structured-output enforcement loses more than it
saves.

## What this is not

- **Not an API control.** Both subscription arms run inside a harness system prompt (Claude Code's,
  Codex's) rather than the app's own call. Adaptive thinking, `output_config.effort` and true
  structured-output *enforcement* are absent — the schema was pasted into the prompt as text, which is
  strictly weaker than the API constraint the app actually uses.
- **Not evidence about latency, tokens or cost.** It cannot firm up the 3,000-output-token estimate
  that both cost tables pivot on. Only production `tokens_out` from the `matching_call` log line will.
- **Sonnet's 3/8 parse failures are a harness artifact, not a model result.** All three truncate at
  4,229 / 4,777 / 4,847 characters — a consistent ceiling, not random malformation. The model's output
  was cut in transit, most likely by the subagent write path. Scored as unusable rather than quietly
  dropped, but they should not be read as Sonnet failing to produce valid output.

## Incidental findings

**No model echoed the real `userId`.** The fixture uses `u-iris`/`u-theo`; every arm returned `iris`,
`Iris`, `theo` or `Theo`. `isMatchingResponse` only requires a string, so all passed — and the
codebase already anticipated this: `src/components/taste-map.tsx:91` generates its own element ids
precisely because "a userId containing a space silently breaks" things. Worth knowing before anyone
writes code that trusts that field to match a database id.

**`parseMatchingResponse` throws rather than returning a result kind.** Not a defect, but it surprised
this harness and would surprise a `callClaude` port. Together with the OpenRouter spike's finding that
reasoning models return their answer in `message.reasoning` with `content: null`, that is two separate
traps waiting for anyone who rewrites the provider call.

## Conclusion

Consistent with both prior spikes: **stay on a frontier model.** The cheap models are 12–16× cheaper
and one of them measurably fails the product's core promise. GPT-5.6 performed at least as well as
Sonnet here on both validity and balance, so it is a credible second source *if* a provider seam is
ever built — but the OpenRouter spike's conclusion still stands, that the seam costs 1–2 days and buys
insurance against a failure rate nobody has measured yet.

The next measurement worth taking remains the `output_config.effort` sweep against Anthropic direct,
which needs `ANTHROPIC_API_KEY` — the same key that unblocks the live evals and the prompt-injection
launch gate.
