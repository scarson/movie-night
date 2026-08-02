// ABOUTME: SPIKE ARTIFACT (2026-08-01 OpenRouter research) — not production code.
// ABOUTME: Builds the real matching prompt via buildMatchingPrompt, writes it verbatim to disk, runs cheap OpenRouter models against it, judges replies with the app's own validators.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseDevVars } from "./seed-lib";
import {
  buildMatchingPrompt,
  isMatchingResponse,
  parseMatchingResponse,
  MatchingError,
  PROMPT_VERSION,
  type CandidateTitle,
  type MatchingPromptInput,
  type PromptMember,
} from "@/lib/matching";
import { MATCHING_RESPONSE_SCHEMA } from "@/types/matching";

// ── Fixtures ─────────────────────────────────────────────────
// Byte-identical to scripts/cf-ai-spike.ts, which in turn mirrors the live
// Anthropic eval suite (src/lib/matching.eval.test.ts). Reused verbatim so the
// OpenRouter results sit in the same frame as the Cloudflare Workers AI ones.

const CANDIDATES: CandidateTitle[] = [
  { tmdbId: 27205, title: "Inception", year: 2010, genres: ["Action", "Science Fiction", "Adventure"], synopsis: "A thief who steals corporate secrets through dream-sharing technology takes on an inverse task: planting an idea." },
  { tmdbId: 155, title: "The Dark Knight", year: 2008, genres: ["Drama", "Action", "Crime", "Thriller"], synopsis: "Batman raises the stakes in his war on crime as the Joker unleashes chaos on Gotham." },
  { tmdbId: 550, title: "Fight Club", year: 1999, genres: ["Drama"], synopsis: "An insomniac office worker and a soap maker form an underground fight club." },
  { tmdbId: 680, title: "Pulp Fiction", year: 1994, genres: ["Thriller", "Crime"], synopsis: "The lives of two mob hitmen, a boxer, and a pair of diner bandits intertwine." },
  { tmdbId: 13, title: "Forrest Gump", year: 1994, genres: ["Comedy", "Drama", "Romance"], synopsis: "A slow-witted but kind man witnesses and influences several defining historical events." },
  { tmdbId: 603, title: "The Matrix", year: 1999, genres: ["Action", "Science Fiction"], synopsis: "A hacker discovers reality is a simulation and joins a rebellion against its controllers." },
  { tmdbId: 278, title: "The Shawshank Redemption", year: 1994, genres: ["Drama", "Crime"], synopsis: "A banker sentenced to life in Shawshank prison befriends a fellow inmate over two decades." },
  { tmdbId: 238, title: "The Godfather", year: 1972, genres: ["Drama", "Crime"], synopsis: "The aging patriarch of a crime dynasty transfers control to his reluctant son." },
  { tmdbId: 129, title: "Spirited Away", year: 2001, genres: ["Animation", "Family", "Fantasy"], synopsis: "A young girl wanders into a world of spirits and must work in a bathhouse to free her parents." },
  { tmdbId: 496243, title: "Parasite", year: 2019, genres: ["Comedy", "Thriller", "Drama"], synopsis: "A poor family schemes to become employed by a wealthy household." },
  { tmdbId: 76341, title: "Mad Max: Fury Road", year: 2015, genres: ["Action", "Adventure", "Science Fiction"], synopsis: "In a post-apocalyptic wasteland, Max joins Furiosa fleeing a tyrant in an armored war rig." },
  { tmdbId: 120467, title: "The Grand Budapest Hotel", year: 2014, genres: ["Comedy", "Drama"], synopsis: "A legendary concierge and his lobby boy are drawn into a caper over a priceless painting." },
  { tmdbId: 194, title: "Amélie", year: 2001, genres: ["Comedy", "Romance"], synopsis: "A shy Parisian waitress secretly orchestrates small acts of kindness." },
  { tmdbId: 598, title: "City of God", year: 2002, genres: ["Drama", "Crime"], synopsis: "Two boys growing up in a Rio favela take different paths through two decades of crime." },
  { tmdbId: 429, title: "The Good, the Bad and the Ugly", year: 1966, genres: ["Western"], synopsis: "Three gunslingers race to find a buried cache of gold during the Civil War." },
  { tmdbId: 11, title: "Star Wars", year: 1977, genres: ["Adventure", "Action", "Science Fiction"], synopsis: "A farm boy joins a rebellion to rescue a princess and destroy a planet-killing battle station." },
  { tmdbId: 105, title: "Back to the Future", year: 1985, genres: ["Adventure", "Comedy", "Science Fiction"], synopsis: "A teenager is accidentally sent thirty years into the past in a time-traveling DeLorean." },
  { tmdbId: 601, title: "E.T. the Extra-Terrestrial", year: 1982, genres: ["Science Fiction", "Adventure", "Family"], synopsis: "A boy befriends a stranded alien and helps him find a way home." },
  { tmdbId: 2062, title: "Ratatouille", year: 2007, genres: ["Animation", "Comedy", "Family"], synopsis: "A rat with a refined palate becomes the secret chef behind a Paris restaurant." },
  { tmdbId: 10681, title: "WALL·E", year: 2008, genres: ["Animation", "Family", "Science Fiction"], synopsis: "A waste-collecting robot left on an abandoned Earth follows a sleek probe into space." },
  { tmdbId: 77338, title: "The Intouchables", year: 2011, genres: ["Comedy", "Drama"], synopsis: "A quadriplegic aristocrat hires a young man from the projects as his caregiver." },
  { tmdbId: 19913, title: "(500) Days of Summer", year: 2009, genres: ["Comedy", "Drama", "Romance"], synopsis: "A greeting-card writer replays his relationship with the girl who didn't believe in love." },
  { tmdbId: 313369, title: "La La Land", year: 2016, genres: ["Comedy", "Drama", "Romance", "Music"], synopsis: "An aspiring actress and a jazz pianist chase their dreams in Los Angeles." },
  { tmdbId: 509, title: "Notting Hill", year: 1999, genres: ["Comedy", "Romance", "Drama"], synopsis: "A London bookshop owner's life changes when a famous American actress walks into his shop." },
  { tmdbId: 4951, title: "10 Things I Hate About You", year: 1999, genres: ["Comedy", "Romance", "Drama"], synopsis: "A new student pays a bad boy to date his crush's ill-tempered older sister." },
  { tmdbId: 694, title: "The Shining", year: 1980, genres: ["Horror", "Thriller"], synopsis: "A writer takes a winter caretaker job at an isolated hotel with a violent past." },
  { tmdbId: 948, title: "Halloween", year: 1978, genres: ["Horror", "Thriller"], synopsis: "A masked killer escapes an asylum and stalks a babysitter on Halloween night." },
  { tmdbId: 539, title: "Psycho", year: 1960, genres: ["Horror", "Thriller"], synopsis: "A secretary on the run checks into a remote motel run by a disturbed young man." },
  { tmdbId: 857, title: "Saving Private Ryan", year: 1998, genres: ["Drama", "History", "War"], synopsis: "After D-Day, a squad is sent to bring home a paratrooper whose brothers were killed." },
  { tmdbId: 16869, title: "Inglourious Basterds", year: 2009, genres: ["Drama", "Thriller", "War"], synopsis: "A band of Jewish-American soldiers spreads fear through occupied France." },
];

const IRIS: PromptMember = {
  userId: "u-iris",
  name: "Iris",
  comfortTitles: ["Inception", "The Dark Knight", "Parasite"],
  watchlist: ["Fight Club"],
  vibes: ["Cerebral", "Suspenseful", "Mind-Bending"],
  dealbreakers: ["Horror"],
  streamingServices: ["Netflix"],
  roughDay: false,
};

const THEO: PromptMember = {
  userId: "u-theo",
  name: "Theo",
  comfortTitles: ["Notting Hill", "Amélie", "La La Land"],
  watchlist: ["(500) Days of Summer"],
  vibes: ["Cozy", "Feel-Good", "Romantic"],
  dealbreakers: ["War"],
  streamingServices: ["Netflix"],
  roughDay: false,
};

const REMOVED_ID = 155; // The Dark Knight — must never come back.

const input: MatchingPromptInput = {
  members: [IRIS, THEO],
  moodVibes: ["Suspenseful"],
  moodText: "",
  discoverNew: false,
  keptTitles: [],
  removedTitles: [`The Dark Knight (tmdbId ${REMOVED_ID})`],
  steeringFeedback: "",
  candidates: CANDIDATES,
  solo: false,
};

const prompt = buildMatchingPrompt(input);
const validTmdbIds = new Set(CANDIDATES.map((c) => c.tmdbId));
const byId = new Map(CANDIDATES.map((c) => [c.tmdbId, c]));

/**
 * Titles that serve Theo's cozy / feel-good / romantic profile. The CF spike's
 * central open question is whether a model reconciles two opposed tastes or
 * collapses toward the member with the more "recommendable" one, so this list
 * is the scoring instrument for that, fixed up front rather than chosen after
 * seeing the answers.
 */
const THEO_SERVING = new Set([13, 120467, 194, 105, 601, 2062, 10681, 77338, 19913, 313369, 509, 4951, 129]);
/** Squarely Iris: cerebral, suspenseful, mind-bending, or simply bleak/violent. */
const IRIS_SERVING = new Set([27205, 550, 680, 603, 278, 238, 496243, 76341, 598, 429, 11]);

// ── Output locations ─────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "dev", "research", "openrouter-spike");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * .dev.vars lives in the main checkout, not in a worktree. Walk up until we
 * find one. The key is read into memory and never logged, echoed or written.
 */
function resolveOpenRouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".dev.vars");
    if (existsSync(candidate)) {
      const vars = parseDevVars(readFileSync(candidate, "utf-8"));
      if (vars.OPENROUTER_API_KEY) return vars.OPENROUTER_API_KEY;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("OPENROUTER_API_KEY not found in environment or any .dev.vars up the tree");
}

// ── Models under test ────────────────────────────────────────
//
// Chosen against this app's hard requirements FIRST, price second:
//   - structured_outputs support (the nested MATCHING_RESPONSE_SCHEMA is non-negotiable)
//   - context window >= 32k (9k prompt at production scale + 8k output + headroom)
//   - only reachable by paying OpenRouter — Anthropic and OpenAI arms run on
//     Sam's existing subscriptions and must not consume OpenRouter credit.
//
// Rejected on the hard filter despite steep discounts (see the spike doc):
//   ring-2.6-1t (75% off)  — no structured_outputs
//   tencent/hy3-preview (65% off) — no structured_outputs, no response_format
//   meituan/longcat-2.0 (60% off) — no structured_outputs, no response_format
//   openai/gpt-5.6-* (50% off) — OpenAI arm runs locally via codex CLI

interface ModelUnderTest {
  id: string;
  /** $/M tokens, read from OpenRouter's live models endpoint on 2026-08-01. */
  inRate: number;
  outRate: number;
  /** Why this model is in the bake-off. */
  rationale: string;
  /** Whether the price carries a promotional discount that can expire. */
  discounted: boolean;
}

const MODELS: ModelUnderTest[] = [
  {
    id: "inclusionai/ling-2.6-flash",
    inRate: 0.01,
    outRate: 0.03,
    rationale:
      "The price floor, deliberately. 90% off — the steepest discount in the collection that still clears the structured-output filter. ~250x cheaper than Sonnet 5 at intro rates. Not a reasoning model, so a clean failure here is itself a useful result: it bounds how far down the price curve this task can go.",
    discounted: true,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    inRate: 0.14,
    outRate: 0.28,
    rationale:
      "Strongest all-round cheap candidate: reasoning-capable, structured outputs, 1M context. Appears in the discounted collection at 36% off, so part of this price has a shelf life.",
    discounted: true,
  },
  {
    id: "z-ai/glm-4.7-flash",
    inRate: 0.06,
    outRate: 0.4,
    rationale:
      "Cloudflare-spike bridge. Was CF's 'cheapest credible option' and FAILED there with reproducible upstream 504s that the CF diagnostic traced to capacity, not the model. Running it here isolates platform from model. Undiscounted, so its price is a stable basis for a decision.",
    discounted: false,
  },
];

const SAMPLES = Number(process.env.SPIKE_SAMPLES ?? 8);

interface SampleResult {
  model: string;
  index: number;
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  servedByProvider: string | null;
  reportedModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  rawText: string;
  /** Which response field carried the answer: "content", "reasoning", or null. */
  answerField: "content" | "reasoning" | null;
  finishReason: string | null;
  jsonParsed: boolean;
  isMatchingResponseOk: boolean;
  parseOk: boolean;
  parseError: string | null;
  droppedIds: number[];
  recommendations: { tmdbId: number; title: string; matchScore: number }[];
  violations: string[];
  theoServingCount: number;
  irisServingCount: number;
  namesBoth: boolean;
  weightingLeak: boolean;
  error: string | null;
}

/**
 * The prompt carries a PRIVATE weighting directive in some configurations. This
 * fixture has roughDay false on both members, so the note is the benign
 * "treat all profiles equally" branch — but scan anyway, because a model that
 * echoes the weighting scaffolding at all is a signal worth catching.
 */
const LEAK_PATTERNS = [/65\s*\/\s*35/i, /\bweight(ing|ed)\b/i, /rough day/i, /apply silently/i, /\bPRIVATE\b/];

async function runSample(key: string, model: ModelUnderTest, index: number): Promise<SampleResult> {
  const base: SampleResult = {
    model: model.id, index, ok: false, httpStatus: 0, latencyMs: 0,
    servedByProvider: null, reportedModel: null, promptTokens: null, completionTokens: null,
    costUsd: null, rawText: "", answerField: null, finishReason: null,
    jsonParsed: false, isMatchingResponseOk: false, parseOk: false,
    parseError: null, droppedIds: [], recommendations: [], violations: [],
    theoServingCount: 0, irisServingCount: 0, namesBoth: false, weightingLeak: false, error: null,
  };

  const started = Date.now();
  let res: Response;
  let bodyText: string;
  // The request AND the body read must both sit inside this try. An abort that
  // fires while the body is streaming rejects res.text(), and an unhandled
  // rejection there kills the whole run rather than failing one sample.
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      // Without this a single wedged provider stalls the whole run. 240s is
      // far above the app's own 45s SDK timeout: the point is to capture the reply
      // and its true latency, then judge it against 45s in the report, rather than
      signal: AbortSignal.timeout(240_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "movie-night-openrouter-spike",
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: 16000, // matches callClaude() in src/lib/matching.ts
        response_format: {
          type: "json_schema",
          json_schema: { name: "matching_response", strict: true, schema: MATCHING_RESPONSE_SCHEMA },
        },
        // Deliberately NO `models` array: cross-model fallback would silently
        // answer from a model this spike never certified. See the spike doc §6.2.
        provider: {
          require_parameters: true, // never route to an endpoint that would drop the schema
          data_collection: "deny", // the prompt carries private taste data
        },
        usage: { include: true },
      }),
    });
    bodyText = await res.text();
  } catch (err) {
    base.latencyMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "";
    base.error =
      name === "TimeoutError" || name === "AbortError"
        ? `timeout after ${Date.now() - started}ms`
        : `transport: ${err instanceof Error ? err.message : String(err)}`;
    return base;
  }

  base.latencyMs = Date.now() - started;
  base.httpStatus = res.status;

  if (!res.ok) {
    base.error = `http ${res.status}: ${bodyText.slice(0, 300)}`;
    return base;
  }

  let body: {
    choices?: { message?: { content?: string | null; reasoning?: string | null }; finish_reason?: string }[];
    provider?: string;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };
  try {
    body = JSON.parse(bodyText);
  } catch {
    base.error = `envelope not JSON: ${bodyText.slice(0, 300)}`;
    return base;
  }

  if (body.error) {
    base.error = `api: ${body.error.message ?? "unknown"}`;
    return base;
  }

  base.servedByProvider = body.provider ?? null;
  base.reportedModel = body.model ?? null;
  base.promptTokens = body.usage?.prompt_tokens ?? null;
  base.completionTokens = body.usage?.completion_tokens ?? null;
  base.costUsd = body.usage?.cost ?? null;

  // Reasoning models routed through OpenRouter frequently return the whole
  // structured answer in `reasoning` with `content: null`. Reading only
  // `content` scores those as empty completions, which is a false negative —
  // the model answered, the envelope just put it somewhere else. Take content
  // first, fall back to reasoning, and record which field carried the payload,
  // because that difference is itself a portability finding.
  const choice = body.choices?.[0];
  base.finishReason = choice?.finish_reason ?? null;
  const contentText = choice?.message?.content ?? "";
  const reasoningText = choice?.message?.reasoning ?? "";
  const text = contentText || reasoningText;
  base.answerField = contentText ? "content" : reasoningText ? "reasoning" : null;
  base.rawText = text;
  if (!text) {
    base.error = `empty completion (content and reasoning both empty; finish_reason=${base.finishReason})`;
    return base;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
    base.jsonParsed = true;
  } catch {
    base.error = "JSON.parse failed";
    return base;
  }

  base.isMatchingResponseOk = isMatchingResponse(raw);
  if (!base.isMatchingResponseOk) {
    base.error = "isMatchingResponse rejected";
    return base;
  }

  try {
    const { response, droppedIds } = parseMatchingResponse(text, validTmdbIds);
    base.parseOk = true;
    base.droppedIds = droppedIds;
    base.recommendations = response.recommendations.map((r) => ({
      tmdbId: r.tmdbId,
      title: byId.get(r.tmdbId)?.title ?? String(r.tmdbId),
      matchScore: r.matchScore,
    }));
    for (const rec of response.recommendations) {
      const genres = byId.get(rec.tmdbId)?.genres ?? [];
      if (genres.includes("Horror")) base.violations.push(`Horror dealbreaker: ${rec.tmdbId}`);
      if (genres.includes("War")) base.violations.push(`War dealbreaker: ${rec.tmdbId}`);
      if (rec.tmdbId === REMOVED_ID) base.violations.push(`exclusion list violated: ${rec.tmdbId}`);
      if (THEO_SERVING.has(rec.tmdbId)) base.theoServingCount++;
      if (IRIS_SERVING.has(rec.tmdbId)) base.irisServingCount++;
    }
    base.namesBoth = response.conversational.includes("Iris") && response.conversational.includes("Theo");
    const allText = [response.conversational, ...response.recommendations.map((r) => r.explanation)].join(" ");
    base.weightingLeak = LEAK_PATTERNS.some((p) => p.test(allText));
    base.ok = true;
  } catch (err) {
    base.parseError = err instanceof MatchingError ? err.kind : "unknown";
    base.error = `parseMatchingResponse: ${base.parseError}`;
  }

  return base;
}

function renderModelReport(model: ModelUnderTest, results: SampleResult[]): string {
  const passed = results.filter((r) => r.ok);
  const lines: string[] = [];
  lines.push(`# Bake-off samples — \`${model.id}\``);
  lines.push("");
  lines.push(`**Spike artifact.** Generated by \`scripts/openrouter-spike.ts\`. Prompt: byte-identical to \`prompt-system.txt\` + \`prompt-user.txt\` in this directory.`);
  lines.push("");
  lines.push(`- Why this model: ${model.rationale}`);
  lines.push(`- Published rate: $${model.inRate}/M in, $${model.outRate}/M out`);
  lines.push(`- Promotional discount baked into that price: ${model.discounted ? "**yes — can expire**" : "no"}`);
  lines.push(`- Samples: ${results.length} — **${passed.length} passed \`parseMatchingResponse\`**`);
  lines.push("");
  lines.push("| # | HTTP | provider | answer in | schema ok | parsed | violations | serves Theo | serves Iris | latency | tokens in/out |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.index} | ${r.httpStatus || "—"} | ${r.servedByProvider ?? "—"} | ${r.answerField ?? "—"} | ${r.isMatchingResponseOk ? "yes" : "**no**"} | ${r.parseOk ? "yes" : "**no**"} | ${r.violations.length === 0 ? "none" : `**${r.violations.join("; ")}**`} | ${r.theoServingCount} | ${r.irisServingCount} | ${r.latencyMs} ms | ${r.promptTokens ?? "—"}/${r.completionTokens ?? "—"} |`
    );
  }
  lines.push("");
  for (const r of results) {
    lines.push(`## Sample ${r.index}`);
    lines.push("");
    lines.push(`- model id requested: \`${r.model}\``);
    lines.push(`- model id reported: \`${r.reportedModel ?? "—"}\``);
    lines.push(`- served by provider: \`${r.servedByProvider ?? "—"}\``);
    lines.push(`- answer arrived in field: \`${r.answerField ?? "—"}\` (finish_reason: \`${r.finishReason ?? "—"}\`)`);
    lines.push(`- \`isMatchingResponse\`: **${r.isMatchingResponseOk ? "ACCEPTED" : "REJECTED"}**`);
    lines.push(`- \`parseMatchingResponse\`: **${r.parseOk ? "PASS" : `FAIL (${r.parseError ?? r.error})`}**`);
    lines.push(`- dropped tmdbIds: ${JSON.stringify(r.droppedIds)}`);
    lines.push(`- constraint violations: ${r.violations.length === 0 ? "none" : r.violations.join("; ")}`);
    lines.push(`- names both members in conversational: ${r.namesBoth}`);
    lines.push(`- weighting-scaffolding leak detected: ${r.weightingLeak}`);
    lines.push(`- reported cost: ${r.costUsd != null ? `$${r.costUsd}` : "—"}`);
    if (r.error) lines.push(`- error: \`${r.error}\``);
    if (r.recommendations.length > 0) {
      lines.push("");
      lines.push("Picks (in returned order):");
      lines.push("");
      for (const rec of r.recommendations) {
        const who = THEO_SERVING.has(rec.tmdbId) ? "Theo" : IRIS_SERVING.has(rec.tmdbId) ? "Iris" : "neutral";
        lines.push(`- ${rec.title} (${rec.matchScore}) — serves: ${who}`);
      }
    }
    lines.push("");
    lines.push("<details><summary>Raw response text</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(r.rawText || "(empty)");
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Write the prompt verbatim. This is exactly what is sent below — the same
  //    two strings, no reformatting, no truncation.
  writeFileSync(join(OUT_DIR, "prompt-system.txt"), prompt.system, "utf-8");
  writeFileSync(join(OUT_DIR, "prompt-user.txt"), prompt.user, "utf-8");
  const systemHash = sha256(prompt.system);
  const userHash = sha256(prompt.user);

  console.log(`system: ${prompt.system.length} chars  sha256=${systemHash}`);
  console.log(`user:   ${prompt.user.length} chars  sha256=${userHash}`);

  const key = resolveOpenRouterKey();
  const allResults: SampleResult[] = [];

  for (const model of MODELS) {
    console.log(`\n=== ${model.id} (${SAMPLES} samples) ===`);
    const results: SampleResult[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const r = await runSample(key, model, i);
      results.push(r);
      allResults.push(r);
      console.log(
        `  #${i} http=${r.httpStatus} parse=${r.parseOk ? "PASS" : "FAIL"} ` +
          `theo=${r.theoServingCount} iris=${r.irisServingCount} ` +
          `${r.latencyMs}ms provider=${r.servedByProvider ?? "-"}${r.error ? ` err=${r.error.slice(0, 90)}` : ""}`
      );
    }
    const slug = model.id.replace(/[^a-z0-9]+/gi, "-");
    writeFileSync(join(OUT_DIR, `samples-${slug}.md`), renderModelReport(model, results), "utf-8");
  }

  // 2. Manifest — everything the Sonnet arm needs to reproduce the comparison.
  const totalReported = allResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const manifest = {
    note: "SPIKE ARTIFACT. Generated by scripts/openrouter-spike.ts on 2026-08-01.",
    promptSource: "src/lib/matching.ts buildMatchingPrompt() — unmodified",
    // Read, not restated: the manifest also claims the prompt is unmodified and
    // reproduces byte-for-byte, so a hardcoded version silently mislabels every
    // re-run after a bump.
    promptVersion: PROMPT_VERSION,
    deterministic: true,
    determinismNote:
      "buildMatchingPrompt is a pure function of its input. No clock, no randomness, no environment read. The fixture below is a literal in scripts/openrouter-spike.ts, so the two prompt files reproduce byte-for-byte on any machine.",
    promptFiles: {
      "prompt-system.txt": { chars: prompt.system.length, sha256: systemHash },
      "prompt-user.txt": { chars: prompt.user.length, sha256: userHash },
    },
    identicalToWhatWasSent: true,
    fixture: {
      members: [IRIS, THEO],
      moodVibes: input.moodVibes,
      removedTitles: input.removedTitles,
      discoverNew: input.discoverNew,
      candidateCount: CANDIDATES.length,
    },
    scoringSets: {
      theoServing: [...THEO_SERVING],
      irisServing: [...IRIS_SERVING],
    },
    requestShape: {
      endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
      max_tokens: 16000,
      response_format: "json_schema, strict:true, schema = MATCHING_RESPONSE_SCHEMA",
      provider: { require_parameters: true, data_collection: "deny" },
      modelsArray: "deliberately NOT set — cross-model fallback would break the injection gate",
    },
    samplesPerModel: SAMPLES,
    models: MODELS.map((m) => m.id),
    totalReportedCostUsd: totalReported,
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`\n=== totals ===`);
  console.log(`samples: ${allResults.length}  passed: ${allResults.filter((r) => r.ok).length}`);
  console.log(`reported cost: $${totalReported.toFixed(6)}`);
  console.log(`artifacts: ${OUT_DIR}`);
}

void main();
