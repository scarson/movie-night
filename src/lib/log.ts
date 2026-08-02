// ABOUTME: One-line JSON event logger — the app's structured-logging convention.
// ABOUTME: Stable `event` name plus flat scalar fields, with credential-shaped names redacted.

/**
 * Values a log field may hold. Deliberately narrow: an object or a Response
 * would let a whole user row or a request header set reach the log by accident,
 * and the type is the cheapest place to stop that.
 */
export type LogValue = string | number | boolean | null | undefined | readonly (string | number)[];

export type LogFields = Record<string, LogValue>;

export type LogSink = (line: string) => void;

/**
 * Field-name fragments that must never carry a value into a log line. This
 * catches the naming, not the content — a field called `message` can still
 * carry a token if a caller puts one there, so the rule in
 * docs/deploy.md §Observability still has to be followed by hand.
 */
const REDACTED_NAME_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "credential",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "jwt",
  "email",
];

const REDACTED = "[redacted]";

/**
 * Emits a single JSON line: `{"event":"<name>", …fields}`. `event` leads so the
 * lines group and grep predictably in `wrangler tail` and Workers Logs.
 * Undefined fields are dropped rather than serialised as null, so an absent
 * value costs nothing.
 *
 * Pass `console.error` as the sink for operator-actionable conditions; Workers
 * Logs records the level alongside the line.
 */
export function logEvent(event: string, fields: LogFields = {}, sink: LogSink = console.log): void {
  const line: Record<string, LogValue> = { event };
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    line[name] = isRedactedName(name) ? REDACTED : value;
  }
  sink(JSON.stringify(line));
}

function isRedactedName(name: string): boolean {
  const lowered = name.toLowerCase();
  return REDACTED_NAME_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}
