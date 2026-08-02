// ABOUTME: SPIKE ARTIFACT. Scores subscription-arm bake-off samples (Sonnet subagents, GPT via codex)
// ABOUTME: against the app's own isMatchingResponse/parseMatchingResponse and the taste-collapse metric.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isMatchingResponse, parseMatchingResponse } from "../src/lib/matching";

/** Scoring sets from dev/research/openrouter-spike/manifest.json — the fixture's per-member serving ids. */
const THEO_SERVING = new Set([13, 120467, 194, 105, 601, 2062, 10681, 77338, 19913, 313369, 509, 4951, 129]);
const IRIS_SERVING = new Set([27205, 550, 680, 603, 278, 238, 496243, 76341, 598, 429, 11]);
/** The round's exclusion: The Dark Knight. A recommendation carrying it is a hard constraint violation. */
const EXCLUDED = 155;

const VALID_IDS = new Set<number>([...THEO_SERVING, ...IRIS_SERVING, EXCLUDED]);

/**
 * Returns the LAST balanced top-level JSON object that parses. Codex transcripts echo the
 * prompt — which itself contains the response JSON Schema — so the first brace in the file
 * belongs to the schema, not the answer. Scanning backwards finds the reply.
 */
function extractJson(raw: string): string | null {
  const starts: number[] = [];
  let depth = 0;
  let start = -1;
  const spans: Array<[number, number]> = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        spans.push([start, i + 1]);
        start = -1;
      }
    }
  }
  void starts;

  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const candidate = raw.slice(spans[i][0], spans[i][1]);
    try {
      const value: unknown = JSON.parse(candidate);
      if (isRecordish(value) && "recommendations" in value) return candidate;
    } catch {
      // keep scanning backwards
    }
  }
  return spans.length ? raw.slice(spans[spans.length - 1][0], spans[spans.length - 1][1]) : null;
}

function isRecordish(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Score {
  sample: string;
  parsed: boolean;
  validShape: boolean;
  theo: number;
  iris: number;
  unknownIds: number[];
  excludedReturned: boolean;
  descending: boolean;
  userIdsEchoed: string[];
  note: string;
}

function score(sample: string, raw: string): Score {
  const base: Score = {
    sample, parsed: false, validShape: false, theo: 0, iris: 0,
    unknownIds: [], excludedReturned: false, descending: true, userIdsEchoed: [], note: "",
  };

  const json = extractJson(raw);
  if (!json) return { ...base, note: "no JSON object found" };

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ...base, note: `JSON.parse failed: ${(err as Error).message}` };
  }
  base.parsed = true;
  base.validShape = isMatchingResponse(value);

  let parsedResult: ReturnType<typeof parseMatchingResponse>;
  try {
    parsedResult = parseMatchingResponse(json, VALID_IDS);
  } catch (err) {
    const kind = (err as { kind?: string }).kind ?? "threw";
    return { ...base, note: `parseMatchingResponse: ${kind}` };
  }

  const recs = parsedResult.response.recommendations;
  for (const rec of recs) {
    if (THEO_SERVING.has(rec.tmdbId)) base.theo += 1;
    else if (IRIS_SERVING.has(rec.tmdbId)) base.iris += 1;
    else base.unknownIds.push(rec.tmdbId);
    if (rec.tmdbId === EXCLUDED) base.excludedReturned = true;
  }

  const scores = recs.map((r) => r.matchScore);
  base.descending = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
  base.userIdsEchoed = parsedResult.response.tasteMap.members.map((m) => m.userId);
  base.unknownIds.push(...parsedResult.droppedIds);

  return base;
}

function scoreDir(label: string, dir: string, pattern: RegExp): void {
  if (!existsSync(dir)) {
    console.log(`\n## ${label}\n(directory absent: ${dir})`);
    return;
  }
  const files = readdirSync(dir).filter((f) => pattern.test(f)).sort();
  const rows = files.map((f) => score(f, readFileSync(join(dir, f), "utf-8")));

  console.log(`\n## ${label} (n=${rows.length})`);
  let theo = 0;
  let iris = 0;
  let usable = 0;
  for (const r of rows) {
    if (r.note === "") {
      usable += 1;
      theo += r.theo;
      iris += r.iris;
    }
    console.log(
      `${r.sample}: parsed=${r.parsed} shape=${r.validShape} theo=${r.theo} iris=${r.iris}` +
        ` excluded=${r.excludedReturned} desc=${r.descending} ids=[${r.userIdsEchoed.join(",")}]` +
        (r.unknownIds.length ? ` UNKNOWN=[${r.unknownIds.join(",")}]` : "") +
        (r.note ? ` NOTE=${r.note}` : "")
    );
  }
  console.log(`TOTALS ${label}: usable=${usable}/${rows.length} theo=${theo} iris=${iris}` +
    (theo + iris > 0 ? ` split=${((theo / (theo + iris)) * 100).toFixed(0)}% Theo` : ""));
}

const scratch = process.argv[2];
if (!scratch) {
  console.error("usage: tsx scripts/bakeoff-score.ts <scratchpad-dir>");
  process.exit(1);
}
scoreDir("Sonnet — no schema in prompt", join(scratch, "sonnetarm"), /^raw-\d+\.json$/);
scoreDir("Sonnet — schema in prompt", join(scratch, "sonnetarm2"), /^raw-\d+\.json$/);
scoreDir("GPT-5.6-sol — no schema in prompt", join(scratch, "gptarm"), /^raw-\d+\.txt$/);
scoreDir("GPT-5.6-sol — schema in prompt", join(scratch, "gptarm3"), /^raw-\d+\.txt$/);
