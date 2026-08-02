// ABOUTME: The matching error taxonomy as the person waiting experiences it — whether
// ABOUTME: a retry can succeed, whether a way out exists, and what to call the failure.

export interface ErrorFraming {
  /**
   * Used by the results page. The ritual and quick-match screens keep their own
   * "Not tonight, apparently" for every kind and read only `retry` and `loosen`
   * — see `dev/research/open-decisions.md` #13, which is the open question of
   * whether they should adopt these instead.
   */
  heading: string;
  retry: boolean;
  loosen?: boolean;
}

/**
 * Body copy is always the server's own string; this only picks the framing and
 * the way out, so the two can never drift apart.
 *
 * A Map, not an object literal: `kind` arrives over the wire, and a plain index
 * lookup would resolve inherited keys like "constructor" to something truthy
 * and skip the fallback entirely.
 */
export const ERROR_FRAMING = new Map<string, ErrorFraming>([
  ["timeout", { heading: "Our movie brain is having a lie-down", retry: true }],
  ["overloaded", { heading: "Our movie brain is having a lie-down", retry: true }],
  // Indistinguishable from a transient outage on this side, and an operator
  // rotating a key back is the far commoner case than one that stays revoked.
  ["provider_auth", { heading: "Our movie brain is having a lie-down", retry: true }],
  // The provider's own 429 — the one genuinely momentary member of the family.
  ["rate_limited", { heading: "Everyone picked tonight", retry: true }],
  // Not momentary, despite sharing a status code with the one above. The cap
  // counts `recommendations` rows since the 1st of the UTC month, and a refusal
  // writes no row, so the number a retry is measured against cannot move until
  // the month rolls over or an operator raises the limit.
  ["monthly_cap", { heading: "Everyone picked tonight", retry: false }],
  ["malformed", { heading: "That came back garbled", retry: true }],
  [
    "thin_results",
    { heading: "That was a tough brief — loosen a dealbreaker?", retry: false, loosen: true },
  ],
  ["round_limit", { heading: "That's the evening's last round", retry: false }],
  // Same reason as the monthly cap, over a shorter window: a day, not a moment.
  ["daily_limit", { heading: "That's today's last round", retry: false }],
  ["left_group", { heading: "You've left this group", retry: false }],
]);

export const DEFAULT_FRAMING: ErrorFraming = { heading: "That didn't work", retry: true };

export function framingFor(kind: string | null): ErrorFraming {
  return ERROR_FRAMING.get(kind ?? "") ?? DEFAULT_FRAMING;
}
