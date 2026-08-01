// ABOUTME: Shared D1 database helpers: ISO 8601 timestamp SQL fragments and safe JSON column parsing.
// ABOUTME: Used by every module that reads or writes D1 rows.

/**
 * SQL fragment for ISO 8601 "now" timestamps compatible with JS toISOString().
 *
 * SQLite's datetime() returns "YYYY-MM-DD HH:MM:SS" (space separator) but
 * JS toISOString() returns "YYYY-MM-DDTHH:MM:SS.sssZ" (T separator).
 * Lexicographic comparisons between these formats produce wrong results
 * because 'T' (ASCII 84) > ' ' (ASCII 32).
 *
 * This helper returns a strftime() expression that produces ISO 8601 format,
 * ensuring correct comparisons with stored JS timestamps.
 */
export function sqliteIsoNow(modifier?: string): string {
  if (modifier) {
    return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${modifier}')`;
  }
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/**
 * D1 rejects any query binding more than 100 parameters. Split id lists into
 * chunks below that ceiling so callers can run one IN(...) query per chunk and
 * merge the results. 90 leaves headroom for any fixed params in the same query.
 */
export const D1_IN_CHUNK_SIZE = 90;

/** Splits an array into consecutive chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Parses a JSON-shaped TEXT column, falling back to a default when the value
 * is null/undefined or fails to parse (e.g. corrupted or pre-migration data).
 */
export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
