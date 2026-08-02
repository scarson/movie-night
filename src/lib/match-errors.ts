// ABOUTME: The matching error taxonomy as the person waiting experiences it — the
// ABOUTME: heading to use, whether a retry can succeed, and whether a way out exists.

export interface ErrorFraming {
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
  ["rate_limited", { heading: "Everyone picked tonight", retry: true }],
  ["monthly_cap", { heading: "Everyone picked tonight", retry: true }],
  ["malformed", { heading: "That came back garbled", retry: true }],
  [
    "thin_results",
    { heading: "That was a tough brief — loosen a dealbreaker?", retry: false, loosen: true },
  ],
  ["round_limit", { heading: "That's the evening's last round", retry: false }],
  // retry: false, unlike the other 429s — the window is a day, not a moment,
  // and the default framing would offer a retry button that cannot succeed.
  ["daily_limit", { heading: "That's today's last round", retry: false }],
  ["left_group", { heading: "You've left this group", retry: false }],
]);

export const DEFAULT_FRAMING: ErrorFraming = { heading: "That didn't work", retry: true };

export function framingFor(kind: string | null): ErrorFraming {
  return ERROR_FRAMING.get(kind ?? "") ?? DEFAULT_FRAMING;
}
