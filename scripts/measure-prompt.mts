// ABOUTME: Measures the real assembled matching prompt at representative and worst-case
// ABOUTME: sizes, so the cost model rests on characters counted rather than guessed.
import { buildMatchingPrompt } from "../src/lib/matching";
import type { CandidateTitle, PromptMember } from "../src/lib/matching";

/** Longest realistic first-sentence synopsis, at the 160-char clamp. */
const LONG_SYNOPSIS =
  "A disillusioned architect returns to the coastal town where she grew up and discovers " +
  "that the house her father built is scheduled for demolition within the week.";

/** A plausible genre spread; the renderer joins these with ", ". */
const GENRES = ["Drama", "Science Fiction", "Adventure"];

function candidates(count: number, synopsis: string): CandidateTitle[] {
  return Array.from({ length: count }, (_, i) => ({
    tmdbId: 100000 + i,
    title: `The Remains of the Longest Possible Title ${i}`,
    year: 1990 + (i % 36),
    genres: GENRES,
    synopsis,
    posterPath: null,
    voteAverage: 7.5,
    voteCount: 1000,
    popularity: 100 - i / 10,
    topCast: [],
    keywords: [],
    streaming: null,
  })) as unknown as CandidateTitle[];
}

function member(name: string, scale: "typical" | "max"): PromptMember {
  const titles = scale === "max" ? 50 : 5;
  const watch = scale === "max" ? 50 : 3;
  const tags = scale === "max" ? 30 : 6;
  const breakers = scale === "max" ? 30 : 2;
  const services = scale === "max" ? 10 : 3;
  return {
    userId: name,
    name,
    comfortTitles: Array.from({ length: titles }, (_, i) => `Comfort Film Number ${i}`),
    watchlist: Array.from({ length: watch }, (_, i) => `Watchlist Film Number ${i}`),
    vibes: Array.from({ length: tags }, (_, i) => `Vibe Tag ${i}`),
    dealbreakers: Array.from({ length: breakers }, (_, i) => `Dealbreaker ${i}`),
    streamingServices: Array.from({ length: services }, (_, i) => `Service ${i}`),
    roughDay: false,
  };
}

interface Shape {
  label: string;
  system: string;
  user: string;
}

function shapes(): Shape[] {
  const out: Shape[] = [];

  // Representative: a couple, a first round, a seeded catalog.
  const rep = buildMatchingPrompt({
    members: [member("Alex", "typical"), member("Jordan", "typical")],
    moodVibes: ["Cozy", "Cerebral", "Slow-Burn"],
    moodText: "Something we can both sink into after a long week.",
    discoverNew: false,
    keptTitles: [],
    removedTitles: [],
    steeringFeedback: "",
    candidates: candidates(200, "A thief who steals corporate secrets through dream-sharing technology."),
    solo: false,
  });
  out.push({ label: "representative — couple, round 1", ...rep });

  // Solo, first round.
  const solo = buildMatchingPrompt({
    members: [member("Alex", "typical")],
    moodVibes: ["Cozy"],
    moodText: "",
    discoverNew: false,
    keptTitles: [],
    removedTitles: [],
    steeringFeedback: "",
    candidates: candidates(200, "A thief who steals corporate secrets through dream-sharing technology."),
    solo: true,
  });
  out.push({ label: "solo — round 1", ...solo });

  // Worst case: every documented ceiling at once.
  const worst = buildMatchingPrompt({
    members: [member("Alexandra Featherstonehaugh", "max"), member("Jordan Ellery-Whitcombe", "max")],
    moodVibes: Array.from({ length: 30 }, (_, i) => `Mood Tag ${i}`),
    moodText: "x".repeat(200),
    discoverNew: true,
    keptTitles: Array.from({ length: 50 }, (_, i) => `Kept Film ${i}`),
    removedTitles: Array.from({ length: 100 }, (_, i) => `Removed Film Number ${i}`),
    steeringFeedback: "y".repeat(300),
    candidates: candidates(200, LONG_SYNOPSIS),
    solo: false,
  });
  out.push({ label: "worst case — every ceiling at once", ...worst });

  return out;
}

const enc = new TextEncoder();
const chars = (s: string) => s.length;
const bytes = (s: string) => enc.encode(s).length;

// Anthropic's count_tokens endpoint needs an API key, which this project does
// not have. tiktoken is not an option — it is OpenAI's tokenizer and undercounts
// Claude by ~15-20% on prose and far more on structured text. So the measured
// quantity here is characters, and the token figure is presented as a band across
// defensible chars-per-token ratios rather than as one invented number.
const RATIOS = [3.2, 3.6, 4.0];

console.log("=".repeat(78));
console.log("MEASURED PROMPT SIZES (characters and bytes are exact)");
console.log("=".repeat(78));

const rows: { label: string; system: number; user: number; total: number; bytes: number }[] = [];
for (const s of shapes()) {
  const total = chars(s.system) + chars(s.user);
  rows.push({
    label: s.label,
    system: chars(s.system),
    user: chars(s.user),
    total,
    bytes: bytes(s.system) + bytes(s.user),
  });
  console.log(`\n${s.label}`);
  console.log(`  system : ${chars(s.system).toLocaleString()} chars`);
  console.log(`  user   : ${chars(s.user).toLocaleString()} chars`);
  console.log(`  TOTAL  : ${total.toLocaleString()} chars / ${(bytes(s.system) + bytes(s.user)).toLocaleString()} bytes`);
  console.log(`  token estimate at ${RATIOS.join(" / ")} chars-per-token:`);
  console.log(`    ${RATIOS.map((r) => Math.round(total / r).toLocaleString()).join(" / ")} tokens`);
}

console.log(`\n${"=".repeat(78)}`);
console.log("CACHE ELIGIBILITY — Claude Sonnet 5 minimum cacheable prefix is 1024 tokens");
console.log("=".repeat(78));
for (const r of rows) {
  const band = RATIOS.map((ratio) => Math.round(r.system / ratio));
  console.log(
    `${r.label.padEnd(38)} system ${r.system.toLocaleString().padStart(6)} chars ` +
      `≈ ${band.join("/")} tokens  → ${Math.max(...band) < 1024 ? "BELOW the 1024 minimum" : "clears the minimum"}`
  );
}

console.log(`\n${"=".repeat(78)}`);
console.log("WHAT SHARE OF THE PROMPT IS THE CANDIDATE BLOCK");
console.log("=".repeat(78));
for (const s of shapes()) {
  const marker = "CANDIDATES (recommend only from this list):\n";
  const idx = s.user.indexOf(marker);
  const block = idx === -1 ? "" : s.user.slice(idx);
  const total = chars(s.system) + chars(s.user);
  console.log(
    `${s.label.padEnd(38)} ${chars(block).toLocaleString().padStart(7)} chars = ` +
      `${((chars(block) / total) * 100).toFixed(1)}% of the whole prompt`
  );
}

// ── Output side ──────────────────────────────────────────────────────────────
// The figure every prior cost table pivots on is an ESTIMATED 3,000 output
// tokens. A real `tokens_out` needs a deployed app; what can be measured today
// is the size of a schema-conformant response written at realistic prose
// lengths. That is what follows.

const recommendation = (id: number, score: number, words: number) => ({
  tmdbId: id,
  matchScore: score,
  explanation: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
});

function response(recCount: number, memberCount: number, prose: "tight" | "generous") {
  const explanationWords = prose === "generous" ? 45 : 25;
  const summaryWords = prose === "generous" ? 40 : 20;
  const conversationalWords = prose === "generous" ? 220 : 110;
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  return {
    tasteMap: {
      members: Array.from({ length: memberCount }, (_, i) => ({
        userId: `user-${i}`,
        name: `Member Name ${i}`,
        summary: words(summaryWords),
        primaryVibes: ["Cozy", "Cerebral", "Slow-Burn", "Mind-Bending"],
        genreAffinities: ["Drama", "Science Fiction", "Documentary"],
      })),
      overlap: {
        summary: words(summaryWords),
        sharedVibes: ["Mind-Bending", "Emotional"],
        tensionPoints: ["Pacing", "Ambiguous endings", "Runtime past two hours"],
      },
    },
    recommendations: Array.from({ length: recCount }, (_, i) =>
      recommendation(100000 + i, 95 - i * 3, explanationWords)
    ),
    conversational: words(conversationalWords),
  };
}

console.log(`\n${"=".repeat(78)}`);
console.log("MEASURED RESPONSE SIZES (schema-conformant JSON, as the model must emit it)");
console.log("=".repeat(78));
const outShapes: [string, string][] = [
  ["floor — 5 recs, solo, tight prose", JSON.stringify(response(5, 1, "tight"))],
  ["typical — 6 recs, couple, tight prose", JSON.stringify(response(6, 2, "tight"))],
  ["generous — 7 recs, couple, long prose", JSON.stringify(response(7, 2, "generous"))],
];
for (const [label, json] of outShapes) {
  const band = RATIOS.map((r) => Math.round(json.length / r));
  console.log(
    `${label.padEnd(40)} ${json.length.toLocaleString().padStart(6)} chars ≈ ${band.join(" / ")} tokens`
  );
}
