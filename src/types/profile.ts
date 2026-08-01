// ABOUTME: Shared shapes for the taste-profile API — why a referenced tmdb id
// ABOUTME: could not be added to the catalog during a save.

/**
 * `not-found` is permanent: TMDB has no such movie, so the remedy is to pick a
 * different one. `unavailable` is everything else — a 5xx, a network failure, a
 * refused catalog write — and may well succeed on the next save.
 */
export type SkippedTitleReason = "not-found" | "unavailable";

export interface SkippedTitle {
  tmdbId: number;
  reason: SkippedTitleReason;
}
