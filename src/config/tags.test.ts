// ABOUTME: Tests for the tag vocabulary — verifies GENRE_TAG_TO_TMDB maps every
// ABOUTME: GENRE_TAG to either null (prompt-level only) or a real TMDB genre name.

import { describe, it, expect } from "vitest";
import { GENRE_TAGS, GENRE_TAG_TO_TMDB } from "./tags";

// The full TMDB movie genre list from GET /genre/movie/list (stable, versioned API).
const TMDB_MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Science Fiction",
  "TV Movie",
  "Thriller",
  "War",
  "Western",
];

describe("GENRE_TAG_TO_TMDB", () => {
  it("has an entry for every GENRE_TAG", () => {
    for (const tag of GENRE_TAGS) {
      expect(Object.hasOwn(GENRE_TAG_TO_TMDB, tag), `missing entry for "${tag}"`).toBe(true);
    }
  });

  it("has no entries beyond the GENRE_TAGS vocabulary", () => {
    expect(Object.keys(GENRE_TAG_TO_TMDB).sort()).toEqual([...GENRE_TAGS].sort());
  });

  it("maps every tag to null or a real TMDB movie genre name", () => {
    for (const tag of GENRE_TAGS) {
      const mapped = GENRE_TAG_TO_TMDB[tag];
      if (mapped !== null) {
        expect(TMDB_MOVIE_GENRES, `"${tag}" maps to unknown TMDB genre "${mapped}"`).toContain(mapped);
      }
    }
  });

  it("maps the renamed and prompt-only tags per the locked table", () => {
    expect(GENRE_TAG_TO_TMDB["Sci-Fi"]).toBe("Science Fiction");
    expect(GENRE_TAG_TO_TMDB["Musical"]).toBe("Music");
    expect(GENRE_TAG_TO_TMDB["True Crime"]).toBeNull();
    expect(GENRE_TAG_TO_TMDB["Superhero"]).toBeNull();
    expect(GENRE_TAG_TO_TMDB["Horror"]).toBe("Horror");
  });
});
