// ABOUTME: Tests for the deploy preflight's pure logic — migration expectations derived
// ABOUTME: from DDL, schema comparison, and the secret/catalog/cron/binding checks.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindingCheck,
  catalogCheck,
  columnsFromCreateTable,
  cronCheck,
  formatCheck,
  isWorkerMissing,
  migrationCheck,
  migrationExpectations,
  parseJsonc,
  secretCheck,
  stripAnsi,
  unmetExpectations,
  type SchemaSnapshot,
} from "./preflight-lib";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

function realMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
}

/**
 * A snapshot satisfying every expectation the real migrations declare. Columns
 * ride inside each table's stored DDL, which is how SQLite reports them: an
 * ALTER TABLE ... ADD COLUMN rewrites sqlite_master.sql in place.
 */
function fullySchemaedSnapshot(): SchemaSnapshot {
  const columnsByTable = new Map<string, string[]>();
  const snapshot: SchemaSnapshot = { objects: [] };

  for (const { expectation } of migrationExpectations(realMigrations())) {
    if (expectation.kind === "index") snapshot.objects.push({ type: "index", name: expectation.name, sql: null });
    if (expectation.kind === "table") columnsByTable.set(expectation.name, columnsByTable.get(expectation.name) ?? []);
    if (expectation.kind === "column") {
      columnsByTable.set(expectation.table, [...(columnsByTable.get(expectation.table) ?? []), expectation.column]);
    }
  }
  for (const [table, columns] of columnsByTable) {
    snapshot.objects.push({
      type: "table",
      name: table,
      sql: `CREATE TABLE ${table} (id TEXT PRIMARY KEY${columns.map((c) => `, ${c} TEXT`).join("")})`,
    });
  }
  return snapshot;
}

describe("columnsFromCreateTable", () => {
  it("reads the columns out of stored table DDL, including one appended by ALTER TABLE", () => {
    // Byte-for-byte the sql SQLite stores for `sessions` after 0002 is applied.
    const stored =
      "CREATE TABLE sessions (\n  token_hash TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  expires_at TEXT NOT NULL,\n  created_at TEXT NOT NULL\n, rotated_at TEXT)";

    expect(columnsFromCreateTable(stored)).toEqual([
      "token_hash",
      "user_id",
      "expires_at",
      "created_at",
      "rotated_at",
    ]);
  });

  it("skips table-level constraints, which are not columns", () => {
    const stored =
      "CREATE TABLE group_members (group_id TEXT, user_id TEXT, PRIMARY KEY (group_id, user_id), FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE (group_id), CHECK (group_id <> ''))";

    expect(columnsFromCreateTable(stored)).toEqual(["group_id", "user_id"]);
  });

  it("is not confused by a comma inside a column's own parentheses", () => {
    expect(columnsFromCreateTable("CREATE TABLE t (a NUMERIC(10, 2), b TEXT)")).toEqual(["a", "b"]);
  });

  it("returns nothing for DDL that is not a CREATE TABLE", () => {
    expect(columnsFromCreateTable("CREATE INDEX idx_a ON t(a)")).toEqual([]);
  });
});

describe("parseJsonc", () => {
  it("reads the project's own wrangler.jsonc", () => {
    const config = parseJsonc(readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf-8")) as {
      name: string;
      triggers: { crons: string[] };
      d1_databases: { binding: string }[];
    };

    expect(config.name).toBe("movie-night");
    expect(config.triggers.crons).toEqual(["0 9 * * 1"]);
    expect(config.d1_databases[0].binding).toBe("DB");
  });

  it("tolerates line comments, block comments and trailing commas", () => {
    const parsed = parseJsonc(`{
      // a line comment
      "a": 1, /* a block comment */
      "b": ["x", "y",],
    }`);

    expect(parsed).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("leaves comment-like sequences inside strings alone", () => {
    expect(parseJsonc('{"url": "https://example.com/a", "esc": "a\\"// b"}')).toEqual({
      url: "https://example.com/a",
      esc: 'a"// b',
    });
  });
});

describe("migrationExpectations", () => {
  it("derives a column expectation from ALTER TABLE ... ADD COLUMN", () => {
    const expectations = migrationExpectations([
      { name: "0002_x.sql", sql: "ALTER TABLE sessions ADD COLUMN rotated_at TEXT;" },
    ]);

    expect(expectations).toEqual([
      { expectation: { kind: "column", table: "sessions", column: "rotated_at" }, source: "0002_x.sql" },
    ]);
  });

  it("derives table and index expectations, including IF NOT EXISTS forms", () => {
    const expectations = migrationExpectations([
      {
        name: "0001_x.sql",
        sql: `CREATE TABLE users (id TEXT PRIMARY KEY);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id ON users(id);`,
      },
    ]);

    expect(expectations.map((e) => e.expectation)).toEqual([
      { kind: "table", name: "users" },
      { kind: "index", name: "idx_users_id" },
    ]);
  });

  it("ignores DDL that is only mentioned inside a comment", () => {
    // 0004 documents its own rollback as commented-out CREATE INDEX lines. Reading
    // those as expectations would demand indexes the migration deliberately drops.
    const expectations = migrationExpectations([
      {
        name: "0004_x.sql",
        sql: `-- To roll back:
              --   CREATE INDEX idx_recommendations_session ON recommendations(session_id);
              CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations(created_at);`,
      },
    ]);

    expect(expectations.map((e) => e.expectation)).toEqual([
      { kind: "index", name: "idx_recommendations_created_at" },
    ]);
  });

  it("lets a later migration's DROP INDEX override an earlier migration's CREATE", () => {
    const expectations = migrationExpectations([
      { name: "0001_x.sql", sql: "CREATE INDEX idx_a ON t(a);" },
      { name: "0004_x.sql", sql: "DROP INDEX IF EXISTS idx_a;" },
    ]);

    expect(expectations).toEqual([{ expectation: { kind: "absent", name: "idx_a" }, source: "0004_x.sql" }]);
  });

  it("reads the project's real migrations without choking on them", () => {
    const expectations = migrationExpectations(realMigrations());
    const kinds = expectations.map((e) => e.expectation);

    expect(kinds).toContainEqual({ kind: "table", name: "titles" });
    expect(kinds).toContainEqual({ kind: "column", table: "sessions", column: "rotated_at" });
    expect(kinds).toContainEqual({ kind: "column", table: "titles", column: "last_refresh_attempt_at" });
    expect(kinds).toContainEqual({ kind: "index", name: "idx_recommendations_created_at" });
    // 0001 creates it, 0004 drops it.
    expect(kinds).toContainEqual({ kind: "absent", name: "idx_recommendations_session" });
    expect(kinds).not.toContainEqual({ kind: "index", name: "idx_recommendations_session" });
  });
});

describe("unmetExpectations", () => {
  it("finds nothing against a database carrying every migration", () => {
    expect(unmetExpectations(migrationExpectations(realMigrations()), fullySchemaedSnapshot())).toEqual([]);
  });

  it("detects the unapplied 0003 by its missing column, and names the file to run", () => {
    const snapshot = fullySchemaedSnapshot();
    const titles = snapshot.objects.find((o) => o.name === "titles")!;
    titles.sql = titles.sql!.replace(", last_refresh_attempt_at TEXT", "");

    const unmet = unmetExpectations(migrationExpectations(realMigrations()), snapshot);

    expect(unmet).toEqual([
      {
        expectation: { kind: "column", table: "titles", column: "last_refresh_attempt_at" },
        source: "0003_title_refresh_attempt.sql",
      },
    ]);
  });

  it("detects a missing table", () => {
    const unmet = unmetExpectations(
      [{ expectation: { kind: "table", name: "titles" }, source: "0001.sql" }],
      { objects: [] }
    );

    expect(unmet).toHaveLength(1);
  });

  it("detects an index a migration should have dropped but which is still present", () => {
    const unmet = unmetExpectations(
      [{ expectation: { kind: "absent", name: "idx_a" }, source: "0004.sql" }],
      { objects: [{ type: "index", name: "idx_a", sql: null }] }
    );

    expect(unmet).toEqual([{ expectation: { kind: "absent", name: "idx_a" }, source: "0004.sql" }]);
  });
});

describe("migrationCheck", () => {
  it("passes when nothing is unmet", () => {
    const result = migrationCheck([], 4, "remote");

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("4");
  });

  it("fails with the exact wrangler command for each unapplied migration", () => {
    const result = migrationCheck(
      [
        {
          expectation: { kind: "column", table: "titles", column: "last_refresh_attempt_at" },
          source: "0003_title_refresh_attempt.sql",
        },
      ],
      4,
      "remote"
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("titles.last_refresh_attempt_at");
    expect(result.remedy).toContain(
      "npx wrangler d1 execute movie-night-db --remote --file=migrations/0003_title_refresh_attempt.sql"
    );
  });

  it("summarises per migration file rather than listing every object of a wholly unapplied schema", () => {
    const unmet = unmetExpectations(migrationExpectations(realMigrations()), { objects: [] });

    const result = migrationCheck(unmet, 4, "remote");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("0001_initial_schema.sql");
    expect(result.detail).toContain("0004_recommendation_indexes.sql");
    // One line per file, not one per object — 0001 alone declares 17 of them.
    expect(result.detail.split("\n")).toHaveLength(4);
  });

  it("names the local database in the remedy when checking local", () => {
    const result = migrationCheck(
      [{ expectation: { kind: "table", name: "titles" }, source: "0001_initial_schema.sql" }],
      4,
      "local"
    );

    expect(result.remedy).toContain("--local");
    expect(result.remedy).not.toContain("--remote");
  });
});

describe("secretCheck", () => {
  it("passes when every required secret is present", () => {
    const result = secretCheck(["JWT_SECRET", "TMDB_API_TOKEN"], ["TMDB_API_TOKEN", "JWT_SECRET"], "remote");

    expect(result.ok).toBe(true);
  });

  it("names the missing secrets and the command that sets them", () => {
    const result = secretCheck(
      ["GOOGLE_CLIENT_ID", "JWT_SECRET", "ANTHROPIC_API_KEY"],
      ["JWT_SECRET"],
      "remote"
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("GOOGLE_CLIENT_ID");
    expect(result.detail).toContain("ANTHROPIC_API_KEY");
    expect(result.detail).not.toContain("JWT_SECRET");
    expect(result.remedy).toContain("npx wrangler secret put GOOGLE_CLIENT_ID");
    expect(result.remedy).toContain("npx wrangler secret put ANTHROPIC_API_KEY");
  });

  it("points at .dev.vars rather than wrangler secret put when checking local", () => {
    const result = secretCheck(["JWT_SECRET"], [], "local");

    expect(result.remedy).toContain(".dev.vars");
    expect(result.remedy).not.toContain("wrangler secret put");
  });

  it("never carries a secret value, only names", () => {
    // The runner passes names; this pins that the formatter cannot be handed one
    // by a caller that reads values by mistake.
    const result = secretCheck(["JWT_SECRET"], ["JWT_SECRET"], "remote");

    expect(formatCheck(result)).not.toMatch(/=/);
  });
});

describe("isWorkerMissing", () => {
  it("recognises wrangler's not-found error, which is the expected state before the first deploy", () => {
    // Verbatim from `npx wrangler secret list` against this account, 2026-08-01.
    const stderr = `✘ [ERROR] Worker "movie-night" not found.

  If this is a new Worker, run \`wrangler deploy\` first to create it.
  Otherwise, check that the Worker name is correct and you're logged into the right account.`;

    expect(isWorkerMissing(stderr)).toBe(true);
  });

  it("recognises the API error code form", () => {
    expect(isWorkerMissing("This Worker does not exist on your account. [code: 10007]")).toBe(true);
  });

  it("does not swallow an authentication failure as a missing Worker", () => {
    expect(isWorkerMissing("Authentication error [code: 10000]")).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("removes the colour codes wrangler writes around its errors", () => {
    const coloured = "\u001b[31m\u2718 \u001b[41;31m[\u001b[41;97mERROR\u001b[41;31m]\u001b[0m boom";

    expect(stripAnsi(coloured)).toBe("\u2718 [ERROR] boom");
  });
});

describe("catalogCheck", () => {
  it("fails on an empty titles table, because the app is unusable without one", () => {
    const result = catalogCheck(0, "remote");

    expect(result.ok).toBe(false);
    expect(result.remedy).toContain("scripts/seed.ts --remote");
  });

  it("passes on a seeded catalog and reports the count", () => {
    const result = catalogCheck(1042, "remote");

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("1042");
  });

  it("points at npm run seed:local when checking local", () => {
    expect(catalogCheck(0, "local").remedy).toContain("npm run seed:local");
  });
});

describe("bindingCheck", () => {
  it("passes when the expected D1 binding is configured", () => {
    const result = bindingCheck(
      [{ binding: "DB", database_name: "movie-night-db", database_id: "abc" }],
      "DB"
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("movie-night-db");
  });

  it("fails when the binding is absent", () => {
    const result = bindingCheck([{ binding: "OTHER", database_name: "x", database_id: "y" }], "DB");

    expect(result.ok).toBe(false);
    expect(result.remedy).toContain("wrangler.jsonc");
  });

  it("fails when the binding has no database_id", () => {
    const result = bindingCheck([{ binding: "DB", database_name: "movie-night-db", database_id: "" }], "DB");

    expect(result.ok).toBe(false);
  });
});

describe("cronCheck", () => {
  it("passes when the configured crons match and a scheduled handler exists", () => {
    expect(cronCheck(["0 9 * * 1"], ["0 9 * * 1"], true).ok).toBe(true);
  });

  it("fails when the cron expression drifted from the one the refresh is sized for", () => {
    const result = cronCheck(["*/5 * * * *"], ["0 9 * * 1"], true);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("*/5 * * * *");
    expect(result.remedy).toContain("wrangler.jsonc");
  });

  it("fails when no cron is configured at all", () => {
    expect(cronCheck([], ["0 9 * * 1"], true).ok).toBe(false);
  });

  it("fails when the Worker exports no scheduled handler, since the trigger would fire into nothing", () => {
    const result = cronCheck(["0 9 * * 1"], ["0 9 * * 1"], false);

    expect(result.ok).toBe(false);
    expect(result.remedy).toContain("worker.ts");
  });
});

describe("formatCheck", () => {
  it("marks a pass without printing a remedy", () => {
    const line = formatCheck({ name: "secrets", ok: true, detail: "5 present" });

    expect(line).toContain("PASS");
    expect(line).toContain("secrets");
    expect(line).not.toContain("→");
  });

  it("starts a multi-line detail on its own line so the first entry is not buried in the header", () => {
    const line = formatCheck({ name: "migrations", ok: false, detail: "  a: x\n  b: y", remedy: "run this" });

    expect(line.split("\n")[0]).toBe("FAIL  migrations:");
  });

  it("marks a failure and prints its remedy", () => {
    const line = formatCheck({ name: "migrations", ok: false, detail: "1 unapplied", remedy: "run this" });

    expect(line).toContain("FAIL");
    expect(line).toContain("run this");
  });
});
