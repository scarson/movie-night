// ABOUTME: SPIKE ARTIFACT. Scores the GPT-5.6 Terra/Luna reasoning-effort sweep, grouping samples by
// ABOUTME: model and effort level and reporting validity, taste balance, and matchScore ordering.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isMatchingResponse, parseMatchingResponse } from "../src/lib/matching";

/** Per-member serving ids for the opposed fixture — from dev/research/openrouter-spike/manifest.json. */
const THEO = new Set([13, 120467, 194, 105, 601, 2062, 10681, 77338, 19913, 313369, 509, 4951, 129]);
const IRIS = new Set([27205, 550, 680, 603, 278, 238, 496243, 76341, 598, 429, 11]);
const EXCLUDED = 155;
const VALID = new Set<number>([...THEO, ...IRIS, EXCLUDED]);

function isRecordish(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Returns the LAST balanced top-level object carrying `recommendations`. Codex transcripts echo the
 * prompt, which itself contains the response JSON Schema, so the first brace belongs to the schema.
 */
function extractJson(raw: string): string | null {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
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
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const candidate = raw.slice(spans[i][0], spans[i][1]);
    try {
      const v: unknown = JSON.parse(candidate);
      if (isRecordish(v) && "recommendations" in v) return candidate;
    } catch {
      // keep scanning backwards
    }
  }
  return null;
}

interface Cell {
  usable: number;
  total: number;
  theo: number;
  iris: number;
  outOfOrder: number;
  excluded: number;
  failures: string[];
}

function blank(): Cell {
  return { usable: 0, total: 0, theo: 0, iris: 0, outOfOrder: 0, excluded: 0, failures: [] };
}

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error("usage: tsx scripts/effort-sweep-score.ts <sweep-dir>");
  process.exit(1);
}

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const cells = new Map<string, Cell>();

for (const file of readdirSync(dir).filter((f) => /^gpt-5\.6-\w+-\w+-\d+\.txt$/.test(f)).sort()) {
  const match = file.match(/^(gpt-5\.6-\w+)-(\w+)-(\d+)\.txt$/);
  if (!match) continue;
  const key = `${match[1]}|${match[2]}`;
  const cell = cells.get(key) ?? blank();
  cell.total += 1;

  const raw = readFileSync(join(dir, file), "utf-8");
  const json = extractJson(raw);
  if (!json) {
    cell.failures.push(`${match[3]}:no-json`);
    cells.set(key, cell);
    continue;
  }
  try {
    const parsed = parseMatchingResponse(json, VALID);
    if (!isMatchingResponse(JSON.parse(json))) cell.failures.push(`${match[3]}:shape`);
    cell.usable += 1;
    const recs = parsed.response.recommendations;
    for (const rec of recs) {
      if (THEO.has(rec.tmdbId)) cell.theo += 1;
      else if (IRIS.has(rec.tmdbId)) cell.iris += 1;
      if (rec.tmdbId === EXCLUDED) cell.excluded += 1;
    }
    // Ordering is measured on what the MODEL returned. parseMatchingResponse may sort; if it does,
    // this reads 0 for every cell and the raw JSON below is the honest source.
    const rawRecs = (JSON.parse(json) as { recommendations: Array<{ matchScore: number }> }).recommendations;
    const scores = rawRecs.map((r) => r.matchScore);
    if (!scores.every((s, i) => i === 0 || scores[i - 1] >= s)) cell.outOfOrder += 1;
  } catch (err) {
    cell.failures.push(`${match[3]}:${(err as { kind?: string }).kind ?? "threw"}`);
  }
  cells.set(key, cell);
}

const models = [...new Set([...cells.keys()].map((k) => k.split("|")[0]))].sort();
for (const model of models) {
  console.log(`\n## ${model}`);
  console.log("effort | usable | Theo:Iris | split | out-of-order | excluded | failures");
  for (const effort of EFFORTS) {
    const cell = cells.get(`${model}|${effort}`);
    if (!cell) continue;
    const tot = cell.theo + cell.iris;
    const split = tot ? `${Math.round((cell.theo / tot) * 100)}% Theo` : "—";
    console.log(
      `${effort.padEnd(6)} | ${cell.usable}/${cell.total}    | ${cell.theo}:${cell.iris}` +
        `      | ${split.padEnd(9)} | ${cell.outOfOrder}/${cell.usable}          | ${cell.excluded}` +
        `        | ${cell.failures.join(",") || "—"}`
    );
  }
}
