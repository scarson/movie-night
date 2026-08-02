// ABOUTME: Pure logic for the deploy preflight — migration expectations parsed out of DDL,
// ABOUTME: schema comparison, and the per-check pass/fail results with their remedies.

/** Which database the run is checking. Every remedy is phrased for one or the other. */
export type Target = "local" | "remote";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** What to run to make a failing check pass. A failure without one is half a check. */
  remedy?: string;
}

/**
 * A schema fact a migration asserts. `absent` is what a DROP leaves behind: the
 * object must NOT exist, which is how an unapplied drop is detectable at all.
 */
export type SchemaExpectation =
  | { kind: "table"; name: string }
  | { kind: "index"; name: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "absent"; name: string };

/** An expectation together with the migration file that introduced it. */
export interface SourcedExpectation {
  expectation: SchemaExpectation;
  source: string;
}

/**
 * The live schema, exactly as `SELECT type, name, sql FROM sqlite_master`
 * returns it. Columns are read out of each table's stored DDL rather than from
 * `pragma_table_info`, which D1 refuses with `not authorized: SQLITE_AUTH` when
 * called across every table in one statement. SQLite rewrites the stored `sql`
 * in place on `ALTER TABLE … ADD COLUMN`, so it is an accurate column list.
 */
export interface SchemaSnapshot {
  objects: { type: string; name: string; sql: string | null }[];
}

const TABLE_LEVEL_CONSTRAINTS = new Set(["primary", "foreign", "unique", "check", "constraint"]);

/** The column names declared by a stored `CREATE TABLE` statement. */
export function columnsFromCreateTable(sql: string): string[] {
  if (!/^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\b/i.test(sql)) return [];

  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open === -1 || close <= open) return [];

  const body = sql.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inString = false;
  for (const ch of body) {
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts
    .map((part) => part.trim().replace(/^["`[]/, "").match(/^\w+/)?.[0] ?? "")
    .filter((name) => name !== "" && !TABLE_LEVEL_CONSTRAINTS.has(name.toLowerCase()));
}

export const DATABASE_NAME = "movie-night-db";

/** Per-file reasons printed before the rest are elided as a count. */
const MAX_REASONS_SHOWN = 3;

/**
 * Parses JSON with comments and trailing commas — the dialect wrangler.jsonc is
 * written in. Hand-rolled rather than pulled in as a dependency: the preflight
 * reads exactly one config file, and a parser small enough to test outright is
 * cheaper than a supply-chain addition.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[++i] ?? "";
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Strips SQL comments so commented-out DDL is not read as an expectation —
 * 0004 documents its own rollback as commented CREATE INDEX lines, and taking
 * those literally would demand the very indexes it drops. Quote tracking keeps
 * a `--` inside a string literal intact.
 */
function stripComments(sql: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

const CREATE_TABLE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi;
const CREATE_INDEX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi;
const DROP_INDEX = /\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?["`[]?(\w+)/gi;
const DROP_TABLE = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`[]?(\w+)/gi;
const ADD_COLUMN = /\bALTER\s+TABLE\s+["`[]?(\w+)["`\]]?\s+ADD\s+(?:COLUMN\s+)?["`[]?(\w+)/gi;

function keyOf(expectation: SchemaExpectation): string {
  return expectation.kind === "column"
    ? `column:${expectation.table}.${expectation.column}`
    : `object:${expectation.name}`;
}

/**
 * Reads every migration in the order given and returns the schema facts the set
 * declares, with later files overriding earlier ones about the same object — so
 * an index 0001 creates and 0004 drops ends up as a single `absent` expectation
 * sourced to 0004.
 *
 * This is the mechanism that replaces `docs/deploy.md`'s unchecked markdown
 * checkbox: a new migration is covered the moment it lands in `migrations/`,
 * with nothing to remember to update.
 */
export function migrationExpectations(files: { name: string; sql: string }[]): SourcedExpectation[] {
  const byKey = new Map<string, SourcedExpectation>();

  const record = (expectation: SchemaExpectation, source: string): void => {
    byKey.delete(keyOf(expectation));
    byKey.set(keyOf(expectation), { expectation, source });
  };

  for (const { name, sql } of files) {
    const clean = stripComments(sql);
    for (const [, table] of clean.matchAll(CREATE_TABLE)) record({ kind: "table", name: table }, name);
    for (const [, index] of clean.matchAll(CREATE_INDEX)) record({ kind: "index", name: index }, name);
    for (const [, table, column] of clean.matchAll(ADD_COLUMN)) {
      record({ kind: "column", table, column }, name);
    }
    for (const [, index] of clean.matchAll(DROP_INDEX)) record({ kind: "absent", name: index }, name);
    for (const [, table] of clean.matchAll(DROP_TABLE)) record({ kind: "absent", name: table }, name);
  }

  return [...byKey.values()];
}

/** The expectations the live schema does not satisfy. Empty means fully migrated. */
export function unmetExpectations(
  expectations: SourcedExpectation[],
  snapshot: SchemaSnapshot
): SourcedExpectation[] {
  const objects = new Set(snapshot.objects.map((o) => o.name));
  const columns = new Set(
    snapshot.objects.flatMap((o) =>
      columnsFromCreateTable(o.sql ?? "").map((column) => `${o.name}.${column}`)
    )
  );

  return expectations.filter(({ expectation }) => {
    switch (expectation.kind) {
      case "table":
      case "index":
        return !objects.has(expectation.name);
      case "column":
        return !columns.has(`${expectation.table}.${expectation.column}`);
      case "absent":
        return objects.has(expectation.name);
    }
  });
}

function describeExpectation(expectation: SchemaExpectation): string {
  switch (expectation.kind) {
    case "table":
      return `missing table ${expectation.name}`;
    case "index":
      return `missing index ${expectation.name}`;
    case "column":
      return `missing column ${expectation.table}.${expectation.column}`;
    case "absent":
      return `${expectation.name} still present, should have been dropped`;
  }
}

export function migrationCheck(
  unmet: SourcedExpectation[],
  fileCount: number,
  target: Target
): CheckResult {
  if (unmet.length === 0) {
    return {
      name: "migrations applied",
      ok: true,
      detail: `every schema object declared by ${fileCount} migration file(s) is present`,
    };
  }

  const sources = [...new Set(unmet.map((u) => u.source))].sort();
  // Grouped by file because that is the unit you act on: a wholly unapplied
  // 0001 is one command to run, not seventeen missing objects to read.
  const bySource = sources.map((source) => {
    const reasons = unmet.filter((u) => u.source === source).map((u) => describeExpectation(u.expectation));
    const shown = reasons.slice(0, MAX_REASONS_SHOWN).join(", ");
    const rest = reasons.length - MAX_REASONS_SHOWN;
    return `  ${source}: ${shown}${rest > 0 ? `, and ${rest} more` : ""}`;
  });

  return {
    name: "migrations applied",
    ok: false,
    detail: bySource.join("\n"),
    remedy: [
      "Apply the outstanding migrations in numeric order:",
      ...sources.map(
        (source) => `  npx wrangler d1 execute ${DATABASE_NAME} --${target} --file=migrations/${source}`
      ),
    ].join("\n"),
  };
}

export function secretCheck(required: string[], present: string[], target: Target): CheckResult {
  const have = new Set(present);
  const missing = required.filter((name) => !have.has(name));

  if (missing.length === 0) {
    return {
      name: "secrets set",
      ok: true,
      detail: `all ${required.length} required secrets present (names only, values never read)`,
    };
  }

  return {
    name: "secrets set",
    ok: false,
    detail: `missing: ${missing.join(", ")}`,
    remedy:
      target === "remote"
        ? ["Set each one (wrangler prompts for the value):", ...missing.map((n) => `  npx wrangler secret put ${n}`)].join("\n")
        : `Add a KEY=VALUE line for each of ${missing.join(", ")} to .dev.vars (gitignored), or export them into the environment.`,
  };
}

/** Drops the colour codes wrangler wraps its errors in, so they read plainly in a report. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Whether a wrangler failure means "this Worker has never been deployed" rather
 * than a real error. Before the first deploy that is the expected state, and it
 * says something true and useful: no secrets are set.
 */
export function isWorkerMissing(stderr: string): boolean {
  return /not found|does not exist|10007/.test(stripAnsi(stderr));
}

export function catalogCheck(count: number, target: Target): CheckResult {
  if (count > 0) {
    return { name: "titles catalog non-empty", ok: true, detail: `${count} title(s) in the catalog` };
  }

  return {
    name: "titles catalog non-empty",
    ok: false,
    detail: "the titles table is empty — matching has no candidates and every match returns thin results",
    remedy:
      target === "remote"
        ? "  npx tsx scripts/seed.ts --remote --pages 25   (needs TMDB_API_TOKEN in the environment or .dev.vars)"
        : "  npm run seed:local -- --pages 25   (needs TMDB_API_TOKEN in the environment or .dev.vars)",
  };
}

export interface D1BindingConfig {
  binding: string;
  database_name: string;
  database_id: string;
}

export function bindingCheck(bindings: D1BindingConfig[], expected: string): CheckResult {
  const found = bindings.find((b) => b.binding === expected);

  if (found && found.database_id && found.database_name) {
    return {
      name: `${expected} binding configured`,
      ok: true,
      detail: `${expected} → ${found.database_name} (${found.database_id})`,
    };
  }

  return {
    name: `${expected} binding configured`,
    ok: false,
    detail: found
      ? `${expected} is declared but has no database_name/database_id`
      : `no d1_databases entry binds ${expected}`,
    remedy: `Add or complete the ${expected} entry under d1_databases in wrangler.jsonc. Create the database first if it does not exist: npx wrangler d1 create ${DATABASE_NAME}`,
  };
}

/**
 * The cron is checked against the Wrangler config rather than the account
 * because `wrangler deploy` replaces the Worker's triggers with whatever
 * `triggers.crons` holds — the config is what registers the trigger, so a
 * correct config plus a `scheduled` export is what "registered as expected"
 * means at preflight time. Confirm it landed after deploying: see
 * docs/deploy.md §Post-deploy verification.
 */
export function cronCheck(
  configured: string[],
  expected: string[],
  hasScheduledHandler: boolean
): CheckResult {
  const matches =
    configured.length === expected.length && configured.every((cron, i) => cron === expected[i]);

  if (!matches) {
    return {
      name: "cron trigger registered",
      ok: false,
      detail: `wrangler.jsonc declares [${configured.join(", ") || "none"}], expected [${expected.join(", ")}]`,
      remedy: `Set triggers.crons to ["${expected.join('", "')}"] in wrangler.jsonc. The weekly refresh sweeps STALE_TITLES_LIMIT titles per run and is sized for a weekly cadence — a faster cron burns TMDB quota without refreshing more of the catalog.`,
    };
  }

  if (!hasScheduledHandler) {
    return {
      name: "cron trigger registered",
      ok: false,
      detail: `[${configured.join(", ")}] is configured but the Worker exports no scheduled handler, so the trigger fires into nothing`,
      remedy: "Restore the scheduled() export in worker.ts (it delegates to runScheduled in src/lib/cron-handler.ts).",
    };
  }

  return {
    name: "cron trigger registered",
    ok: true,
    detail: `[${configured.join(", ")}] configured, scheduled() handler present`,
  };
}

export function formatCheck(result: CheckResult): string {
  const separator = result.detail.includes("\n") ? "\n" : " ";
  const head = `${result.ok ? "PASS" : "FAIL"}  ${result.name}:${separator}${result.detail}`;
  return result.ok || !result.remedy ? head : `${head}\n      → ${result.remedy.replace(/\n/g, "\n      ")}`;
}
