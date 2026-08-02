// ABOUTME: Live eval suite for the matching engine — calls the REAL Anthropic API.
// ABOUTME: Opt-in only: runs when RUN_LIVE_EVALS=1 (Phase 8 gate); skipped otherwise.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDevVars } from "../../scripts/seed-lib";
import { runMatching, type CandidateTitle, type MatchingPromptInput, type PromptMember } from "./matching";

const RUN_LIVE = Boolean(process.env.RUN_LIVE_EVALS);

function resolveApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const devVarsPath = join(process.cwd(), ".dev.vars");
  if (existsSync(devVarsPath)) {
    const vars = parseDevVars(readFileSync(devVarsPath, "utf-8"));
    if (vars.ANTHROPIC_API_KEY) return vars.ANTHROPIC_API_KEY;
  }
  throw new Error("RUN_LIVE_EVALS=1 requires ANTHROPIC_API_KEY (env or .dev.vars)");
}

// Fixed 30-candidate list: well-known films with their real TMDB ids. Genres
// matter to the assertions (Horror and War entries must never be recommended
// given the dealbreakers below).
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
  // Horror entries (must NEVER surface given Iris's Horror dealbreaker):
  { tmdbId: 694, title: "The Shining", year: 1980, genres: ["Horror", "Thriller"], synopsis: "A writer takes a winter caretaker job at an isolated hotel with a violent past." },
  { tmdbId: 948, title: "Halloween", year: 1978, genres: ["Horror", "Thriller"], synopsis: "A masked killer escapes an asylum and stalks a babysitter on Halloween night." },
  { tmdbId: 539, title: "Psycho", year: 1960, genres: ["Horror", "Thriller"], synopsis: "A secretary on the run checks into a remote motel run by a disturbed young man." },
  // War entries (must NEVER surface given Theo's War dealbreaker):
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

function evalInput(overrides: Partial<MatchingPromptInput> = {}): MatchingPromptInput {
  return {
    members: [IRIS, THEO],
    moodVibes: ["Suspenseful"],
    moodText: "",
    discoverNew: false,
    keptTitles: [],
    removedTitles: [],
    steeringFeedback: "",
    candidates: CANDIDATES,
    solo: false,
    ...overrides,
  };
}

const genresById = new Map(CANDIDATES.map((c) => [c.tmdbId, c.genres]));
const candidateIds = new Set(CANDIDATES.map((c) => c.tmdbId));

it("guards live evals behind RUN_LIVE_EVALS=1", () => {
  // Documents the guard: when the flag is unset, the describe below is
  // reported as skipped and no network call ever happens in a default run.
  expect(RUN_LIVE).toBe(Boolean(process.env.RUN_LIVE_EVALS));
});

describe.skipIf(!RUN_LIVE)("live matching evals (real Anthropic API)", () => {
  it(
    "solo with nothing saved: says so rather than inventing a taste",
    { timeout: 120_000 },
    async () => {
      // The one measurement open-decisions #14 is waiting on. The prompt rule
      // that produces this is shipped and unit-tested; whether the model obeys
      // it — and whether it would have confabulated without it — is unverified
      // until this runs. Written now so it lands the moment a key exists.
      const blank = {
        userId: "u-blank",
        name: "Robin",
        comfortTitles: [],
        watchlist: [],
        vibes: [],
        dealbreakers: [],
        streamingServices: [],
        roughDay: false,
      };
      const response = await runMatching({
        env: { ANTHROPIC_API_KEY: resolveApiKey() },
        input: evalInput({ members: [blank], moodVibes: [], solo: true }),
        context: { groupId: "eval-group", sessionId: "eval-empty-solo", round: 1 },
      });

      expect(response.tasteMap.members).toHaveLength(1);
      const [taste] = response.tasteMap.members;

      // The schema permits the honest answer; the prompt asks for it.
      expect(taste.primaryVibes).toEqual([]);
      expect(taste.genreAffinities).toEqual([]);
      expect(taste.summary).toMatch(/saved|yet|nothing|haven't|not told/i);
      expect(response.tasteMap.overlap.sharedVibes).toEqual([]);
      expect(response.tasteMap.overlap.tensionPoints).toEqual([]);

      // It should still recommend — an empty profile is a cold start, not an error.
      expect(response.recommendations.length).toBeGreaterThanOrEqual(5);
      for (const rec of response.recommendations) {
        expect(candidateIds.has(rec.tmdbId), `unknown tmdbId ${rec.tmdbId}`).toBe(true);
      }
    }
  );

  it(
    "round 1: respects dealbreakers, candidate list, and taste-map shape",
    { timeout: 120_000 },
    async () => {
      const response = await runMatching({
        env: { ANTHROPIC_API_KEY: resolveApiKey() },
        input: evalInput(),
        context: { groupId: "eval-group", sessionId: "eval-round1", round: 1 },
      });

      expect(response.recommendations.length).toBeGreaterThanOrEqual(5);
      expect(response.recommendations.length).toBeLessThanOrEqual(7);

      for (const rec of response.recommendations) {
        expect(candidateIds.has(rec.tmdbId), `unknown tmdbId ${rec.tmdbId}`).toBe(true);
        const genres = genresById.get(rec.tmdbId) ?? [];
        expect(genres, `Horror dealbreaker violated by ${rec.tmdbId}`).not.toContain("Horror");
        expect(genres, `War dealbreaker violated by ${rec.tmdbId}`).not.toContain("War");
      }

      expect(response.tasteMap.members).toHaveLength(2);
      for (const memberTaste of response.tasteMap.members) {
        expect(memberTaste.summary.trim().length).toBeGreaterThan(0);
      }
      expect(response.conversational).toContain("Iris");
      expect(response.conversational).toContain("Theo");
    }
  );

  it(
    "refinement round: keeps kept titles and never returns removed titles",
    { timeout: 120_000 },
    async () => {
      const keptId = 27205; // Inception
      const removedId = 155; // The Dark Knight
      const response = await runMatching({
        env: { ANTHROPIC_API_KEY: resolveApiKey() },
        input: evalInput({
          keptTitles: [`Inception (tmdbId ${keptId})`],
          removedTitles: [`The Dark Knight (tmdbId ${removedId})`],
        }),
        context: { groupId: "eval-group", sessionId: "eval-round2", round: 2 },
      });

      const ids = response.recommendations.map((r) => r.tmdbId);
      expect(ids).toContain(keptId);
      expect(ids).not.toContain(removedId);
    }
  );
});
