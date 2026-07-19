// ABOUTME: Tests for the TMDB client — pure transforms against fixtures (no network)
// ABOUTME: and URL/header construction for the fetch wrappers via an injected fetch stub.
import { describe, expect, it, vi } from "vitest";
import discoverPageFixture from "../test/fixtures/tmdb-discover-page.json";
import movieDetailFixture from "../test/fixtures/tmdb-movie-detail.json";
import searchFixture from "../test/fixtures/tmdb-search.json";
import {
  detailToEnrichment,
  detailToTitle,
  discoverPageToTitles,
  fetchDiscoverPage,
  fetchGenreMap,
  fetchMovieDetail,
  searchMovies,
  searchResultsToSummaries,
  type GenreMap,
  type TmdbCastMember,
  type TmdbDiscoverResponse,
  type TmdbMovieDetail,
  type TmdbSearchResponse,
} from "./tmdb";

// Fixture provenance: no TMDB_API_TOKEN is available in this environment (no
// .dev.vars present), so per the plan's documented fallback, these three
// fixtures were NOT captured from live TMDB responses. They were transcribed
// from TMDB API v3's stable, versioned response contract (the shapes
// documented at https://developer.themoviedb.org/reference for
// discover-movie, movie-details w/ append_to_response=keywords,credits,watch/providers,
// and movie-search) using real, well-known movie ids/titles (Inception:
// 27205, The Dark Knight: 155) so field names and value shapes are honest.
// The interactive "Try It" response examples on those doc pages require a
// live session and could not be retrieved via WebFetch (confirmed 2026-07-18
// — each page returned only the parameter/schema shell, not a live example).
// Genre id->name pairs match the documented canonical /genre/movie/list
// output (Action=28, Science Fiction=878, Adventure=12, Drama=18, Crime=80,
// Animation=16, Family=10751, Documentary=99).

const GENRE_MAP: GenreMap = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  18: "Drama",
  80: "Crime",
  99: "Documentary",
  878: "Science Fiction",
  10751: "Family",
};

describe("discoverPageToTitles", () => {
  it("maps discover results to title fields, extracting year and resolving genre_ids", () => {
    const titles = discoverPageToTitles(discoverPageFixture as TmdbDiscoverResponse, GENRE_MAP);

    expect(titles).toHaveLength(3);
    expect(titles[0]).toEqual({
      tmdbId: 27205,
      title: "Inception",
      year: 2010,
      genres: ["Action", "Science Fiction", "Adventure"],
      synopsis: discoverPageFixture.results[0].overview,
      posterPath: "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      voteCount: 36421,
      voteAverage: 8.369,
      popularity: 83.952,
    });
  });

  it("maps an empty release_date and null poster_path to null, not a crash", () => {
    const titles = discoverPageToTitles(discoverPageFixture as TmdbDiscoverResponse, GENRE_MAP);
    const untitled = titles.find((t) => t.tmdbId === 9999999);

    expect(untitled).toBeDefined();
    expect(untitled?.year).toBeNull();
    expect(untitled?.posterPath).toBeNull();
    expect(untitled?.genres).toEqual(["Animation", "Family"]);
  });

  it("drops genre_ids that have no entry in the genre map instead of inserting undefined", () => {
    const titles = discoverPageToTitles(
      { ...discoverPageFixture, results: [{ ...discoverPageFixture.results[0], genre_ids: [28, 424242] }] } as TmdbDiscoverResponse,
      GENRE_MAP
    );

    expect(titles[0].genres).toEqual(["Action"]);
  });
});

describe("detailToTitle", () => {
  it("maps a full detail response to a TitleFields object using the embedded genres array (not genre_ids)", () => {
    const title = detailToTitle(movieDetailFixture as TmdbMovieDetail, GENRE_MAP);

    expect(title).toEqual({
      tmdbId: 27205,
      title: "Inception",
      year: 2010,
      genres: ["Action", "Science Fiction", "Adventure"],
      synopsis: movieDetailFixture.overview,
      posterPath: "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      voteCount: 36421,
      voteAverage: 8.369,
      popularity: 83.952,
    });
  });

  it("falls back to the genre map by id when a genres entry is missing its name", () => {
    const detail = {
      ...movieDetailFixture,
      genres: [{ id: 28, name: "" }, { id: 878, name: undefined as unknown as string }],
    } as TmdbMovieDetail;

    const title = detailToTitle(detail, GENRE_MAP);

    expect(title.genres).toEqual(["Action", "Science Fiction"]);
  });
});

describe("detailToEnrichment", () => {
  it("extracts the top 8 cast names ordered by billing order, keyword strings, and the US streaming subset", () => {
    const enrichment = detailToEnrichment(movieDetailFixture as TmdbMovieDetail);

    expect(enrichment.topCast).toEqual([
      "Leonardo DiCaprio",
      "Joseph Gordon-Levitt",
      "Elliot Page",
      "Tom Hardy",
      "Ken Watanabe",
      "Dileep Rao",
      "Cillian Murphy",
      "Tom Berenger",
    ]);
    expect(enrichment.topCast).toHaveLength(8);
    expect(enrichment.keywords).toContain("dream");
    expect(enrichment.keywords).toContain("subconscious");
    expect(enrichment.keywords).toHaveLength(10);
    expect(enrichment.streaming).toEqual({
      link: "https://www.themoviedb.org/movie/27205-inception/watch?locale=US",
      flatrate: ["Max"],
      rent: ["Apple TV", "Amazon Video"],
      buy: ["Apple TV"],
    });
  });

  it("sorts cast by order even when the source array is out of order", () => {
    const cast = (movieDetailFixture.credits.cast as TmdbCastMember[]).slice(0, 3);
    const shuffled = [cast[2], cast[0], cast[1]];
    const detail = { ...movieDetailFixture, credits: { cast: shuffled } } as unknown as TmdbMovieDetail;

    const enrichment = detailToEnrichment(detail);

    expect(enrichment.topCast).toEqual(["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page"]);
  });

  it("returns an empty streaming object when there is no US entry", () => {
    const detail = { ...movieDetailFixture, "watch/providers": { results: {} } } as TmdbMovieDetail;

    const enrichment = detailToEnrichment(detail);

    expect(enrichment.streaming).toEqual({});
  });

  it("returns empty arrays when keywords/credits/watch-providers are entirely absent", () => {
    const { keywords: _k, credits: _c, "watch/providers": _w, ...bare } = movieDetailFixture;
    const enrichment = detailToEnrichment(bare as TmdbMovieDetail);

    expect(enrichment.topCast).toEqual([]);
    expect(enrichment.keywords).toEqual([]);
    expect(enrichment.streaming).toEqual({});
  });
});

describe("searchResultsToSummaries", () => {
  it("maps search results to id/title/year/posterPath summaries", () => {
    const summaries = searchResultsToSummaries(searchFixture as TmdbSearchResponse);

    expect(summaries).toEqual([
      { tmdbId: 27205, title: "Inception", year: 2010, posterPath: "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg" },
      { tmdbId: 137955, title: "Inception: The Cobol Job", year: 2010, posterPath: null },
    ]);
  });
});

describe("network wrappers (URL/header construction only, no real network)", () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }

  it("fetchGenreMap requests /genre/movie/list with a bearer token and returns an id->name map", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ genres: [{ id: 28, name: "Action" }, { id: 12, name: "Adventure" }] }));

    const map = await fetchGenreMap("test-token-123", fetchStub as unknown as typeof fetch);

    expect(map).toEqual({ 28: "Action", 12: "Adventure" });
    const [url, options] = fetchStub.mock.calls[0];
    expect(String(url)).toContain("https://api.themoviedb.org/3/genre/movie/list");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-token-123");
    expect((options.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("fetchDiscoverPage requests /discover/movie with sort_by, vote_count.gte, page, and include_adult params", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(discoverPageFixture));

    const json = await fetchDiscoverPage(3, "test-token-123", fetchStub as unknown as typeof fetch);

    expect(json.results).toHaveLength(3);
    const [url] = fetchStub.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/3/discover/movie");
    expect(parsed.searchParams.get("sort_by")).toBe("popularity.desc");
    expect(parsed.searchParams.get("vote_count.gte")).toBe("50");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("include_adult")).toBe("false");
  });

  it("fetchMovieDetail requests /movie/{id} with append_to_response=keywords,credits,watch/providers", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(movieDetailFixture));

    const json = await fetchMovieDetail(27205, "test-token-123", fetchStub as unknown as typeof fetch);

    expect(json.id).toBe(27205);
    const [url] = fetchStub.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/3/movie/27205");
    expect(parsed.searchParams.get("append_to_response")).toBe("keywords,credits,watch/providers");
  });

  it("searchMovies requests /search/movie with the query param", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(searchFixture));

    const json = await searchMovies("Inception", "test-token-123", fetchStub as unknown as typeof fetch);

    expect(json.results).toHaveLength(2);
    const [url] = fetchStub.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/3/search/movie");
    expect(parsed.searchParams.get("query")).toBe("Inception");
  });

  it("throws a TmdbError with the response status on a non-ok response", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response("Invalid API key", { status: 401 }));

    await expect(fetchGenreMap("bad-token", fetchStub as unknown as typeof fetch)).rejects.toMatchObject({
      status: 401,
      name: "TmdbError",
    });
  });
});
