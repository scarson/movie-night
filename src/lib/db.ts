// ABOUTME: Shared D1 database helpers: ISO 8601 timestamp SQL fragments and safe JSON column parsing.
// ABOUTME: Ported from twin-cities-tee-times; used by every module that reads/writes D1 rows.

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
