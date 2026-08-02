// ABOUTME: SPIKE ARTIFACT (2026-08-01 Cloudflare Workers AI research) — not production code.
// ABOUTME: Builds a real matching prompt via buildMatchingPrompt, posts it to a Workers AI bake-off worker, judges the reply.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildMatchingPrompt,
  isMatchingResponse,
  parseMatchingResponse,
  MatchingError,
  type CandidateTitle,
  type MatchingPromptInput,
  type PromptMember,
} from "@/lib/matching";
import { MATCHING_RESPONSE_SCHEMA } from "@/types/matching";

// Same fixtures the app's live Anthropic eval suite uses (src/lib/matching.eval.test.ts),
// so the Workers AI result is judged against the same brief Anthropic is judged against.
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
const genresById = new Map(CANDIDATES.map((c) => [c.tmdbId, c.genres]));

const PROMPT_OUT = process.env.SPIKE_PROMPT_OUT;
if (PROMPT_OUT) {
  mkdirSync(dirname(PROMPT_OUT), { recursive: true });
  writeFileSync(
    PROMPT_OUT,
    JSON.stringify({ ...prompt, schema: MATCHING_RESPONSE_SCHEMA }, null, 2)
  );
  console.log(`Wrote prompt to ${PROMPT_OUT}`);
  console.log(`system chars: ${prompt.system.length}, user chars: ${prompt.user.length}`);
}

const ENDPOINT = process.env.SPIKE_ENDPOINT;
const MODEL = process.env.SPIKE_MODEL;

async function bakeOff(ENDPOINT: string, MODEL: string) {
  const started = Date.now();
  const res = await fetch(
    `${ENDPOINT}?model=${encodeURIComponent(MODEL)}&json=${process.env.SPIKE_JSON ?? "1"}`
  );
  const body = (await res.json()) as { text?: string; usage?: unknown; error?: string };
  const latencyMs = Date.now() - started;

  console.log(`\n=== ${MODEL} ===`);
  console.log(`http ${res.status}  latency ${latencyMs}ms`);
  console.log(`usage: ${JSON.stringify(body.usage)}`);
  if (body.error) {
    console.log(`ERROR: ${body.error}`);
    return;
  }

  const text = body.text ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.log(`JSON.parse: FAIL`);
    console.log(text.slice(0, 600));
    return;
  }
  console.log(`JSON.parse: ok`);
  console.log(`isMatchingResponse: ${isMatchingResponse(raw) ? "PASS" : "FAIL"}`);
  if (!isMatchingResponse(raw)) {
    console.log(JSON.stringify(raw, null, 2).slice(0, 1500));
    return;
  }

  try {
    const { response, droppedIds } = parseMatchingResponse(text, validTmdbIds);
    console.log(`parseMatchingResponse: PASS (dropped ${JSON.stringify(droppedIds)})`);
    console.log(`recommendations: ${response.recommendations.length}`);
    const violations: string[] = [];
    for (const rec of response.recommendations) {
      const genres = genresById.get(rec.tmdbId) ?? [];
      if (genres.includes("Horror")) violations.push(`Horror dealbreaker: ${rec.tmdbId}`);
      if (genres.includes("War")) violations.push(`War dealbreaker: ${rec.tmdbId}`);
      if (rec.tmdbId === REMOVED_ID) violations.push(`exclusion list violated: ${rec.tmdbId}`);
    }
    console.log(`taste map members: ${response.tasteMap.members.length}`);
    console.log(`conversational names both: ${response.conversational.includes("Iris") && response.conversational.includes("Theo")}`);
    console.log(`violations: ${violations.length === 0 ? "none" : violations.join("; ")}`);
    console.log(
      `picks: ${response.recommendations
        .map((r) => `${CANDIDATES.find((c) => c.tmdbId === r.tmdbId)?.title ?? r.tmdbId} (${r.matchScore})`)
        .join(", ")}`
    );
  } catch (err) {
    const kind = err instanceof MatchingError ? err.kind : "unknown";
    console.log(`parseMatchingResponse: FAIL (${kind})`);
  }
}

if (ENDPOINT && MODEL) {
  void bakeOff(ENDPOINT, MODEL);
}
