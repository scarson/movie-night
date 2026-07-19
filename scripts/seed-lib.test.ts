// ABOUTME: Tests for the seed script's pure helpers — SQL statement construction
// ABOUTME: (escaping, NULL handling, JSON serialization) and .dev.vars parsing.
import { describe, expect, it } from "vitest";
import { parseDevVars, titleToInsertStatement, type SeedTitle } from "./seed-lib";

const BASE_TITLE: SeedTitle = {
  tmdbId: 27205,
  title: "Inception",
  year: 2010,
  genres: ["Action", "Science Fiction"],
  synopsis: "A thief who steals corporate secrets.",
  posterPath: "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
  voteCount: 36421,
  voteAverage: 8.369,
  popularity: 83.952,
  topCast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
  keywords: ["dream", "subconscious"],
  streaming: { link: "https://example.com/watch", flatrate: ["Max"] },
};

describe("titleToInsertStatement", () => {
  it("builds an exact INSERT OR REPLACE statement for a fully-populated title", () => {
    const sql = titleToInsertStatement(BASE_TITLE, "2026-07-18T00:00:00.000Z");

    expect(sql).toBe(
      "INSERT OR REPLACE INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path, vote_count, vote_average, popularity, top_cast, keywords, streaming, seasons, last_refreshed_at, created_at, updated_at) VALUES " +
        "(27205, 'movie', 'Inception', 2010, '[\"Action\",\"Science Fiction\"]', 'A thief who steals corporate secrets.', '/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg', 36421, 8.369, 83.952, " +
        "'[\"Leonardo DiCaprio\",\"Joseph Gordon-Levitt\"]', '[\"dream\",\"subconscious\"]', '{\"link\":\"https://example.com/watch\",\"flatrate\":[\"Max\"]}', NULL, " +
        "'2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z');"
    );
  });

  it("escapes a single quote in the title by doubling it", () => {
    const sql = titleToInsertStatement({ ...BASE_TITLE, title: "Ocean's Eleven" }, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain("'Ocean''s Eleven'");
    expect(sql).not.toMatch(/[^']'Ocean's Eleven'/);
  });

  it("escapes a single quote in the synopsis", () => {
    const sql = titleToInsertStatement(
      { ...BASE_TITLE, synopsis: "It's a heist movie about dreams." },
      "2026-07-18T00:00:00.000Z"
    );

    expect(sql).toContain("'It''s a heist movie about dreams.'");
  });

  it("escapes a single quote inside a JSON-serialized array value", () => {
    const sql = titleToInsertStatement({ ...BASE_TITLE, topCast: ["Ke Huy Quan's Cameo"] }, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain('\'["Ke Huy Quan\'\'s Cameo"]\'');
  });

  it("emits a bare NULL literal (not a quoted string) for a null year", () => {
    const sql = titleToInsertStatement({ ...BASE_TITLE, year: null }, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain("'Inception', NULL, '[\"Action\",\"Science Fiction\"]'");
  });

  it("emits a bare NULL literal for a null poster_path", () => {
    const sql = titleToInsertStatement({ ...BASE_TITLE, posterPath: null }, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain("'A thief who steals corporate secrets.', NULL, 36421");
  });

  it("always emits a bare NULL for seasons (movies only)", () => {
    const sql = titleToInsertStatement(BASE_TITLE, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain(", NULL, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z');");
  });

  it("serializes empty arrays and an empty streaming object as valid JSON, not NULL", () => {
    const sql = titleToInsertStatement(
      { ...BASE_TITLE, genres: [], topCast: [], keywords: [], streaming: {} },
      "2026-07-18T00:00:00.000Z"
    );

    expect(sql).toContain("'[]'");
    expect(sql).toContain("'{}'");
    expect(sql).not.toContain("NULL, NULL");
  });

  it("coerces a non-numeric popularity value to 0 instead of interpolating it raw (SQL injection defense)", () => {
    const hostile = { ...BASE_TITLE, popularity: "1); DROP TABLE titles;--" as unknown as number };

    const sql = titleToInsertStatement(hostile, "2026-07-18T00:00:00.000Z");

    expect(sql).not.toContain("DROP TABLE");
    expect(sql).toContain("36421, 8.369, 0, '[\"Leonardo DiCaprio\",\"Joseph Gordon-Levitt\"]'");
  });
});

describe("titleToInsertStatement numeric coercion", () => {
  it("coerces NaN-producing vote_count to 0", () => {
    const hostile = { ...BASE_TITLE, voteCount: Number.NaN };
    const sql = titleToInsertStatement(hostile, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain(", 'A thief who steals corporate secrets.', '/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg', 0, 8.369, 83.952,");
  });

  it("truncates a non-integer tmdbId to an integer via Math.trunc", () => {
    const sql = titleToInsertStatement({ ...BASE_TITLE, tmdbId: 27205.9 }, "2026-07-18T00:00:00.000Z");

    expect(sql).toContain("(27205, 'movie'");
  });
});

describe("parseDevVars", () => {
  it("parses simple KEY=VALUE lines", () => {
    const vars = parseDevVars("TMDB_API_TOKEN=abc123\nJWT_SECRET=xyz789\n");

    expect(vars).toEqual({ TMDB_API_TOKEN: "abc123", JWT_SECRET: "xyz789" });
  });

  it("ignores blank lines and #-comments", () => {
    const vars = parseDevVars("# comment\n\nTMDB_API_TOKEN=abc123\n  # another comment\n");

    expect(vars).toEqual({ TMDB_API_TOKEN: "abc123" });
  });

  it("strips matching surrounding double or single quotes from values", () => {
    const vars = parseDevVars('TOKEN_A="quoted-value"\nTOKEN_B=\'single-quoted\'\n');

    expect(vars).toEqual({ TOKEN_A: "quoted-value", TOKEN_B: "single-quoted" });
  });

  it("ignores lines with no '=' instead of throwing", () => {
    const vars = parseDevVars("not-a-valid-line\nTMDB_API_TOKEN=abc123\n");

    expect(vars).toEqual({ TMDB_API_TOKEN: "abc123" });
  });

  it("splits only on the first '=' so values containing '=' survive intact", () => {
    const vars = parseDevVars("JWT_SECRET=abc=def=ghi\n");

    expect(vars).toEqual({ JWT_SECRET: "abc=def=ghi" });
  });

  it("returns an empty object for empty content", () => {
    expect(parseDevVars("")).toEqual({});
  });
});
