// ABOUTME: TMDB API v3 client — thin fetch wrappers (tokens passed explicitly, no env access)
// ABOUTME: plus pure transforms from TMDB JSON shapes into our TitleRow-shaped fields.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export class TmdbError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TmdbError";
    this.status = status;
  }
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbGenreListResponse {
  genres: TmdbGenre[];
}

export interface TmdbDiscoverResult {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  genre_ids: number[];
  poster_path: string | null;
  vote_count: number;
  vote_average: number;
  popularity: number;
}

export interface TmdbDiscoverResponse {
  page: number;
  results: TmdbDiscoverResult[];
  total_pages: number;
  total_results: number;
}

export type TmdbSearchResponse = TmdbDiscoverResponse;

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  order: number;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority: number;
}

export interface TmdbWatchProvidersCountry {
  link?: string;
  flatrate?: TmdbWatchProvider[];
  rent?: TmdbWatchProvider[];
  buy?: TmdbWatchProvider[];
}

export interface TmdbMovieDetail {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  genres: TmdbGenre[];
  poster_path: string | null;
  vote_count: number;
  vote_average: number;
  popularity: number;
  keywords?: { keywords: TmdbKeyword[] };
  credits?: { cast: TmdbCastMember[] };
  "watch/providers"?: { results: Record<string, TmdbWatchProvidersCountry> };
}

export type GenreMap = Record<number, string>;

export interface TitleFields {
  tmdbId: number;
  title: string;
  year: number | null;
  genres: string[];
  synopsis: string;
  posterPath: string | null;
  voteCount: number;
  voteAverage: number;
  popularity: number;
}

export interface StreamingInfo {
  link?: string;
  flatrate?: string[];
  rent?: string[];
  buy?: string[];
}

export interface TitleEnrichment {
  topCast: string[];
  keywords: string[];
  streaming: StreamingInfo;
}

export interface SearchSummary {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
}

function extractYear(releaseDate: string): number | null {
  if (!releaseDate) return null;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

function resolveGenreNames(ids: number[], genreMap: GenreMap): string[] {
  return ids.map((id) => genreMap[id]).filter((name): name is string => Boolean(name));
}

/** Maps a discover-page result (genre_ids only) into TitleFields via the genre id->name map. */
export function discoverPageToTitles(json: TmdbDiscoverResponse, genreMap: GenreMap): TitleFields[] {
  return json.results.map((result) => ({
    tmdbId: result.id,
    title: result.title,
    year: extractYear(result.release_date),
    genres: resolveGenreNames(result.genre_ids, genreMap),
    synopsis: result.overview,
    posterPath: result.poster_path,
    voteCount: result.vote_count,
    voteAverage: result.vote_average,
    popularity: result.popularity,
  }));
}

/**
 * Maps a movie-detail response into TitleFields. Detail responses carry a full
 * `genres: [{id, name}]` array (unlike discover's `genre_ids`); the genre map is
 * consulted only as a defensive fallback if an entry's name is ever missing.
 */
export function detailToTitle(json: TmdbMovieDetail, genreMap: GenreMap): TitleFields {
  return {
    tmdbId: json.id,
    title: json.title,
    year: extractYear(json.release_date),
    genres: json.genres
      .map((genre) => genre.name || genreMap[genre.id])
      .filter((name): name is string => Boolean(name)),
    synopsis: json.overview,
    posterPath: json.poster_path,
    voteCount: json.vote_count,
    voteAverage: json.vote_average,
    popularity: json.popularity,
  };
}

/** Extracts the top-8 billed cast names, keyword strings, and the US watch-provider subset. */
export function detailToEnrichment(json: TmdbMovieDetail): TitleEnrichment {
  const cast = json.credits?.cast ?? [];
  const topCast = [...cast]
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)
    .map((member) => member.name);

  const keywords = (json.keywords?.keywords ?? []).map((keyword) => keyword.name);

  const us = json["watch/providers"]?.results?.US;
  const streaming: StreamingInfo = us
    ? {
        ...(us.link ? { link: us.link } : {}),
        ...(us.flatrate ? { flatrate: us.flatrate.map((p) => p.provider_name) } : {}),
        ...(us.rent ? { rent: us.rent.map((p) => p.provider_name) } : {}),
        ...(us.buy ? { buy: us.buy.map((p) => p.provider_name) } : {}),
      }
    : {};

  return { topCast, keywords, streaming };
}

/** Maps search results (same shape as discover results) to lightweight id/title/year/poster summaries. */
export function searchResultsToSummaries(json: TmdbSearchResponse): SearchSummary[] {
  return json.results.map((result) => ({
    tmdbId: result.id,
    title: result.title,
    year: extractYear(result.release_date),
    posterPath: result.poster_path,
  }));
}

async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | boolean>,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new TmdbError(`TMDB request failed: ${response.status} ${path}`, response.status);
  }

  return (await response.json()) as T;
}

export async function fetchGenreMap(token: string, fetchImpl: typeof fetch = fetch): Promise<GenreMap> {
  const json = await tmdbGet<TmdbGenreListResponse>("/genre/movie/list", {}, token, fetchImpl);
  const map: GenreMap = {};
  for (const genre of json.genres) map[genre.id] = genre.name;
  return map;
}

export async function fetchDiscoverPage(
  page: number,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<TmdbDiscoverResponse> {
  return tmdbGet<TmdbDiscoverResponse>(
    "/discover/movie",
    { sort_by: "popularity.desc", "vote_count.gte": 50, page, include_adult: false },
    token,
    fetchImpl
  );
}

export async function fetchMovieDetail(
  id: number,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<TmdbMovieDetail> {
  return tmdbGet<TmdbMovieDetail>(
    `/movie/${id}`,
    { append_to_response: "keywords,credits,watch/providers" },
    token,
    fetchImpl
  );
}

export async function searchMovies(
  query: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<TmdbSearchResponse> {
  return tmdbGet<TmdbSearchResponse>("/search/movie", { query }, token, fetchImpl);
}
