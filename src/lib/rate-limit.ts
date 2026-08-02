// ABOUTME: Rate limiting over the rate_limit_log table. A rule is a (scope, max,
// ABOUTME: window) triple counted per key; RATE_LIMITS is the whole app's ledger.

import { sqliteIsoNow } from "@/lib/db";

export interface RateLimitRule {
  /** rate_limit_log.scope — one bucket per rule, so windows never interfere. */
  readonly scope: string;
  /** Hits allowed within the window before the rule refuses. */
  readonly max: number;
  /** SQLite datetime modifier bounding the window, e.g. "-10 minutes". */
  readonly window: string;
}

/**
 * Every rate limit in the app, in one place, because "what bounds this route?"
 * is a question that has to be answerable without reading every handler.
 * See docs/security/abuse-surface.md for the per-route exposure these bound.
 */
export const RATE_LIMITS = {
  /**
   * Invite-code enumeration. Codes are 8 characters from a 54-symbol alphabet,
   * so guessing is hopeless at any rate; this exists so a script cannot turn
   * the join endpoint into a free oracle. A real person types a code they were
   * given, gets it wrong once or twice, and stops.
   */
  groupJoin: { scope: "group_join", max: 10, window: "-10 minutes" },

  /**
   * The app's only route that spends money: one round is up to four Sonnet
   * calls (2 attempts x maxRetries 1), roughly $0.04 typical and $0.16 worst
   * case. MAX_ROUNDS_PER_SESSION caps a session at 10 rounds, but sessions are
   * free to create, so that ceiling bounds nothing on its own.
   *
   * 30/day is two full 10-round evenings plus half again for error retries —
   * beyond any real evening's use. It caps one account at ~$1.20/day typical
   * and ~$4.80 worst case, and means draining the 2000-call global monthly
   * budget takes a single actor 67 days instead of one afternoon.
   */
  match: { scope: "match", max: 30, window: "-24 hours" },

  /**
   * A profile save enriches every referenced tmdb id we don't hold yet: up to
   * MAX_UNKNOWN_IDS_PER_PUT (50) sequential TMDB detail fetches and 50 D1
   * writes, measured at ~4.2s even when every fetch fails instantly.
   *
   * Saving is an explicit button press, so 20 per 10 minutes is one save every
   * 30 seconds sustained — far above any editing rhythm. It holds the novel-id
   * enrichment rate for one account under 100 TMDB fetches a minute; repeat
   * saves of the same titles cost nothing, because enrichment is a cache fill.
   */
  profileSave: { scope: "profile_save", max: 20, window: "-10 minutes" },

  /**
   * Only the TMDB half of title search is metered — a local-catalog hit costs
   * one indexed D1 read and does not touch our TMDB credentials.
   *
   * The picker debounces at 250ms and a person spends ~5 debounced requests
   * per title they look up, so 120 per 10 minutes covers ~24 titles searched
   * in a ten-minute stretch — one every 25 seconds, sustained, which no one
   * types for ten minutes straight. A script sitting on the debounce floor
   * (4 req/s) crosses it in 30 seconds. At ten users all at the ceiling the
   * app draws 2 TMDB requests a second, well inside TMDB's ~50/s guidance.
   */
  titleSearch: { scope: "title_search", max: 120, window: "-10 minutes" },
} as const satisfies Record<string, RateLimitRule>;

/**
 * True when `key` has fewer than `rule.max` hits recorded inside the window.
 *
 * Check-then-act: a caller racing itself can slip one extra operation past the
 * ceiling. Accepted deliberately — the blast radius is a single extra request's
 * cost, and no locking is worth that.
 */
export async function withinRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  key: string
): Promise<boolean> {
  const row = await db
    .prepare(
      // rule.window is a module constant, never request data.
      `SELECT COUNT(*) as count FROM rate_limit_log
       WHERE scope = ? AND key = ? AND at >= ${sqliteIsoNow(rule.window)}`
    )
    .bind(rule.scope, key)
    .first<{ count: number }>();

  return (row?.count ?? 0) < rule.max;
}

/** Records one hit against `key`, counted by withinRateLimit until it ages out. */
export async function recordRateLimitHit(
  db: D1Database,
  rule: RateLimitRule,
  key: string
): Promise<void> {
  await db
    .prepare("INSERT INTO rate_limit_log (scope, key, at) VALUES (?, ?, ?)")
    .bind(rule.scope, key, new Date().toISOString())
    .run();

  // Housekeeping only, and deliberately NOT batched with the insert above: D1's
  // batch() is a transaction, so a failed prune would roll back the rate-limit
  // record while the caller proceeds with the operation anyway. Scoped to
  // (scope, key) so it uses idx_rate_limit_scope_key and so rules with
  // different windows never delete each other's rows. Rows older than the
  // window are already invisible to withinRateLimit; this discards the only
  // record of abuse outside the window, which nothing reads today.
  try {
    await db
      .prepare(
        `DELETE FROM rate_limit_log
         WHERE scope = ? AND key = ? AND at < ${sqliteIsoNow(rule.window)}`
      )
      .bind(rule.scope, key)
      .run();
  } catch {
    // A failed prune must never fail a rate-limit record.
  }
}
