// ABOUTME: Pure helpers for the TMDB seed script — SQL statement construction and
// ABOUTME: .dev.vars parsing — split out from scripts/seed.ts so they're unit-testable.
import type { StreamingInfo } from "../src/lib/tmdb";

export interface SeedTitle {
  tmdbId: number;
  title: string;
  year: number | null;
  genres: string[];
  synopsis: string;
  posterPath: string | null;
  voteCount: number;
  voteAverage: number;
  popularity: number;
  topCast: string[];
  keywords: string[];
  streaming: StreamingInfo;
}

/** Escapes a string for use as a single-quoted SQL literal (doubles embedded `'`). */
export function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Coerces to a finite integer, falling back to 0. Defense-in-depth: TMDB is an
 * external, untrusted response source, so numeric fields must never be
 * interpolated into SQL text without a numeric coercion — a malformed or
 * hostile upstream field could otherwise inject arbitrary SQL.
 */
function sqlInt(value: number): string {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? String(n) : "0";
}

/** Coerces to a finite number, falling back to 0 (see sqlInt's rationale). */
function sqlFloat(value: number): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "0";
}

const TITLES_COLUMNS = [
  "tmdb_id",
  "content_type",
  "title",
  "year",
  "genres",
  "synopsis",
  "poster_path",
  "vote_count",
  "vote_average",
  "popularity",
  "top_cast",
  "keywords",
  "streaming",
  "seasons",
  "last_refreshed_at",
  "last_refresh_attempt_at",
  "created_at",
  "updated_at",
] as const;

/**
 * Builds an `INSERT OR REPLACE INTO titles (...) VALUES (...)` statement for one
 * title row. All string/JSON values are SQL-escaped via sqlQuote; all numeric
 * values are coerced through Number()/Math.trunc so a malformed upstream field
 * can never inject raw SQL. `seasons` is always NULL — this seed script only
 * indexes movies. `now` is injected so the function stays pure and testable.
 *
 * `last_refresh_attempt_at` carries `now` alongside `last_refreshed_at`: the
 * seed reached TMDB for this row, which is an attempt and a success both.
 * INSERT OR REPLACE rebuilds the row from these columns alone, so omitting it
 * would reset the attempt stamp the weekly refresh selects candidates on and
 * make the whole re-seeded catalog look due again the moment it was written.
 */
export function titleToInsertStatement(title: SeedTitle, now: string): string {
  const values = [
    sqlInt(title.tmdbId),
    sqlQuote("movie"),
    sqlQuote(title.title),
    title.year == null ? "NULL" : sqlInt(title.year),
    sqlQuote(JSON.stringify(title.genres)),
    sqlQuote(title.synopsis),
    title.posterPath == null ? "NULL" : sqlQuote(title.posterPath),
    sqlInt(title.voteCount),
    sqlFloat(title.voteAverage),
    sqlFloat(title.popularity),
    sqlQuote(JSON.stringify(title.topCast)),
    sqlQuote(JSON.stringify(title.keywords)),
    sqlQuote(JSON.stringify(title.streaming)),
    "NULL",
    sqlQuote(now),
    sqlQuote(now),
    sqlQuote(now),
    sqlQuote(now),
  ];
  return `INSERT OR REPLACE INTO titles (${TITLES_COLUMNS.join(", ")}) VALUES (${values.join(", ")});`;
}

/**
 * Minimal KEY=VALUE parser for `.dev.vars` (tsx does not load it automatically,
 * unlike Wrangler). Ignores blank lines and `#`-comments; strips matching
 * surrounding single or double quotes; splits only on the first `=` so values
 * containing `=` survive intact.
 */
export function parseDevVars(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    vars[key] = value;
  }
  return vars;
}
