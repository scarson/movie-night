// ABOUTME: Self-test for the in-memory D1 fake — verifies insert/select round-trip,
// ABOUTME: DELETE ... RETURNING, FK cascade delete, and statement failure injection.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  D1_MAX_BOUND_PARAMS,
  createFakeD1,
  injectedFailureCount,
  loadMigration,
  withFailingStatement,
} from "./fake-d1";

describe("createFakeD1", () => {
  it("round-trips an insert and select", async () => {
    const db = createFakeD1(loadMigration());

    await db
      .prepare(
        "INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("u1", "g1", "u1@example.com", "Sam", "2026-01-01T00:00:00.000Z")
      .run();

    const row = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind("u1")
      .first<{ id: string; email: string; name: string }>();

    expect(row).toEqual(
      expect.objectContaining({ id: "u1", email: "u1@example.com", name: "Sam" })
    );
  });

  it("first() returns null when no row matches", async () => {
    const db = createFakeD1(loadMigration());
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind("missing").first();
    expect(row).toBeNull();
  });

  it("all() returns every matching row wrapped in { results }", async () => {
    const db = createFakeD1(loadMigration());
    await db.batch([
      db
        .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind("u1", "g1", "u1@example.com", "Sam", "2026-01-01T00:00:00.000Z"),
      db
        .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind("u2", "g2", "u2@example.com", "Alex", "2026-01-01T00:00:00.000Z"),
    ]);

    const { results } = await db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>();
    expect(results).toEqual([{ id: "u1" }, { id: "u2" }]);
  });

  it("run() reports the number of changed rows via meta.changes", async () => {
    const db = createFakeD1(loadMigration());
    const result = await db
      .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("u1", "g1", "u1@example.com", "Sam", "2026-01-01T00:00:00.000Z")
      .run();

    expect(result.meta.changes).toBe(1);
  });

  it("supports DELETE ... RETURNING (auth refresh-token rotation depends on this)", async () => {
    const db = createFakeD1(loadMigration());
    await db
      .prepare(
        "INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("u1", "g1", "u1@example.com", "Sam", "2026-01-01T00:00:00.000Z")
      .run();
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("hash1", "u1", "2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();

    const claimed = await db
      .prepare("DELETE FROM sessions WHERE token_hash = ? RETURNING *")
      .bind("hash1")
      .first<{ token_hash: string; user_id: string }>();

    expect(claimed).toEqual(
      expect.objectContaining({ token_hash: "hash1", user_id: "u1" })
    );

    const remaining = await db.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind("hash1").first();
    expect(remaining).toBeNull();
  });

  it("cascades deletes across foreign keys (PRAGMA foreign_keys = ON)", async () => {
    const db = createFakeD1(loadMigration());
    await db
      .prepare(
        "INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("u1", "g1", "u1@example.com", "Sam", "2026-01-01T00:00:00.000Z")
      .run();
    await db
      .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
      .bind("grp1", "Movie Night", "ABC123", "2026-01-01T00:00:00.000Z")
      .run();
    await db
      .prepare(
        "INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)"
      )
      .bind("gm1", "grp1", "u1", "2026-01-01T00:00:00.000Z")
      .run();

    const beforeDelete = await db.prepare("SELECT * FROM group_members WHERE id = ?").bind("gm1").first();
    expect(beforeDelete).not.toBeNull();

    await db.prepare("DELETE FROM users WHERE id = ?").bind("u1").run();

    const afterDelete = await db.prepare("SELECT * FROM group_members WHERE id = ?").bind("gm1").first();
    expect(afterDelete).toBeNull();
  });
});

describe("withFailingStatement", () => {
  const NOW = "2026-01-01T00:00:00.000Z";
  const EXPIRES = "2026-02-01T00:00:00.000Z";

  async function seedUser(db: D1Database, id: string) {
    await db
      .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, `g-${id}`, `${id}@example.com`, "Sam", NOW)
      .run();
  }

  // Literal SQL, deliberately unbound: it keeps the bind() cases below as the only
  // thing proving the injection survives FakeD1PreparedStatement.bind()'s new instance.
  const insertSession = (hash: string) =>
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)` +
    ` VALUES ('${hash}', 'u1', '${EXPIRES}', '${NOW}')`;

  const INSERT_SESSION_BOUND =
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)";

  it("passes every statement through when nothing matches", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO nothing",
    });
    await seedUser(db, "u1");

    const row = await db.prepare("SELECT id FROM users WHERE id = ?").bind("u1").first();
    expect(row).toEqual({ id: "u1" });
  });

  it("rejects the matching statement with the injected error and writes no row", async () => {
    const injected = new Error("D1_ERROR: network connection lost");
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
      error: injected,
    });
    await seedUser(db, "u1");

    await expect(db.prepare(insertSession("hash1")).run()).rejects.toBe(injected);

    // The statement must fail instead of running, not run and then fail.
    const { results } = await db.prepare("SELECT token_hash FROM sessions").all();
    expect(results).toEqual([]);
  });

  it("leaves non-matching statements working while one statement fails", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });
    await seedUser(db, "u1");
    await expect(db.prepare(insertSession("hash1")).run()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );

    await db
      .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("u2", "g-u2", "u2@example.com", "Alex", NOW)
      .run();
    const { results } = await db.prepare("SELECT id FROM users ORDER BY id").all();
    expect(results).toEqual([{ id: "u1" }, { id: "u2" }]);
  });

  it("matches on a RegExp as well as on a substring", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: /INSERT\s+INTO\s+sessions/,
    });
    await seedUser(db, "u1");

    await expect(db.prepare(insertSession("hash1")).run()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );
  });

  it("fails only the nth matching execution when onCall is set", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
      onCall: 2,
    });
    await seedUser(db, "u1");

    await db.prepare(insertSession("hash1")).run();
    await expect(db.prepare(insertSession("hash2")).run()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );
    // The third execution must land: onCall names one execution, not a threshold.
    await db.prepare(insertSession("hash3")).run();

    const { results } = await db.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all();
    expect(results).toEqual([{ token_hash: "hash1" }, { token_hash: "hash3" }]);
    expect(injectedFailureCount(db)).toBe(1);
  });

  it("matches anywhere in the statement, not just at its start", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "FROM users WHERE id",
    });
    await seedUser(db, "u1");

    await expect(db.prepare("SELECT id FROM users WHERE id = ?").bind("u1").first()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );
    expect(injectedFailureCount(db)).toBe(1);
  });

  it("re-tests a global RegExp from the start of each statement", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      // A /g pattern carries lastIndex between calls, which would make every
      // other statement slip past a matcher built on RegExp.test.
      match: /INSERT INTO sessions/g,
    });
    await seedUser(db, "u1");

    for (const hash of ["hash1", "hash2", "hash3"]) {
      await expect(db.prepare(insertSession(hash)).run()).rejects.toThrow(
        "D1_ERROR: injected failure"
      );
    }

    expect(injectedFailureCount(db)).toBe(3);
  });

  it("rejects an onCall below 1, which could never fire", () => {
    expect(() =>
      withFailingStatement(createFakeD1(loadMigration()), {
        match: "INSERT INTO sessions",
        onCall: 0,
      })
    ).toThrow("onCall is 1-based");
  });

  it("counts onCall per wrapper rather than globally", async () => {
    const base = createFakeD1(loadMigration());
    await seedUser(base, "u1");
    const first = withFailingStatement(base, { match: "INSERT INTO sessions", onCall: 2 });
    const second = withFailingStatement(base, { match: "INSERT INTO sessions", onCall: 2 });

    await first.prepare(insertSession("hash1")).run();
    // A counter shared across wrappers would make this the second match and fail it.
    await second.prepare(insertSession("hash2")).run();

    // Each wrapper reaches its own second match independently.
    await expect(first.prepare(insertSession("hash3")).run()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );
    await expect(second.prepare(insertSession("hash4")).run()).rejects.toThrow(
      "D1_ERROR: injected failure"
    );

    const { results } = await base.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all();
    expect(results).toEqual([{ token_hash: "hash1" }, { token_hash: "hash2" }]);
  });

  it("throws when the statement is executed, not when it is prepared or bound", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "SELECT id FROM users",
    });
    await seedUser(db, "u1");

    let stmt: D1PreparedStatement | undefined;
    expect(() => {
      stmt = db.prepare("SELECT id FROM users WHERE id = ?").bind("u1");
    }).not.toThrow();

    await expect(stmt!.first()).rejects.toThrow("D1_ERROR: injected failure");
    await expect(stmt!.all()).rejects.toThrow("D1_ERROR: injected failure");
    await expect(stmt!.raw()).rejects.toThrow("D1_ERROR: injected failure");
  });

  it("rolls the whole batch back when a statement inside it fails", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO group_members",
    });
    await seedUser(db, "u1");

    await expect(
      db.batch([
        db
          .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
          .bind("grp1", "Movie Night", "ABC123", NOW),
        db
          .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
          .bind("gm1", "grp1", "u1", NOW),
      ])
    ).rejects.toThrow("D1_ERROR: injected failure");

    const group = await db.prepare("SELECT id FROM groups WHERE id = ?").bind("grp1").first();
    expect(group).toBeNull();

    // The rollback must stop at the batch's BEGIN, not unwind earlier writes.
    const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind("u1").first();
    expect(user).toEqual({ id: "u1" });
  });

  it("keeps injecting through bind(), which returns a fresh statement instance", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });
    await seedUser(db, "u1");

    await expect(
      db.prepare(INSERT_SESSION_BOUND).bind("hash1", "u1", EXPIRES, NOW).run()
    ).rejects.toThrow("D1_ERROR: injected failure");

    const { results } = await db.prepare("SELECT token_hash FROM sessions").all();
    expect(results).toEqual([]);
  });

  it("counts onCall across separate prepare().bind() chains", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
      onCall: 2,
    });
    await seedUser(db, "u1");

    await db.prepare(INSERT_SESSION_BOUND).bind("hash1", "u1", EXPIRES, NOW).run();
    await expect(
      db.prepare(INSERT_SESSION_BOUND).bind("hash2", "u1", EXPIRES, NOW).run()
    ).rejects.toThrow("D1_ERROR: injected failure");
    await db.prepare(INSERT_SESSION_BOUND).bind("hash3", "u1", EXPIRES, NOW).run();

    const { results } = await db.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all();
    expect(results).toEqual([{ token_hash: "hash1" }, { token_hash: "hash3" }]);
  });

  it("gates exec() as well as prepared statements", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), { match: "DROP TABLE sessions" });

    await expect(db.exec("DROP TABLE sessions")).rejects.toThrow("D1_ERROR: injected failure");

    const table = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .bind("sessions")
      .first();
    expect(table).toEqual({ name: "sessions" });
  });

  it("still enforces the D1 bound-parameter ceiling, ahead of the injected failure", () => {
    // The ceiling is D1's documented hard limit, not a tunable — a fake that
    // drifts above it is the blind spot testing-pitfalls §7 was written about.
    expect(D1_MAX_BOUND_PARAMS).toBe(100);

    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });

    // Matching SQL, so the ceiling has to win at bind() before execution gates.
    expect(() =>
      db.prepare(INSERT_SESSION_BOUND).bind(...new Array(101).fill(null))
    ).toThrow("D1_ERROR: too many SQL variables (101 > 100)");

    expect(() => db.prepare(INSERT_SESSION_BOUND).bind(...new Array(100).fill(null))).not.toThrow();
  });

  it("refuses a batch statement not prepared from this handle", async () => {
    const base = createFakeD1(loadMigration());
    const db = withFailingStatement(base, { match: "INSERT INTO group_members" });
    const other = withFailingStatement(base, { match: "INSERT INTO group_members" });
    await seedUser(db, "u1");

    const foreign = [
      base
        .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
        .bind("grp1", "Movie Night", "ABC123", NOW),
      other
        .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
        .bind("gm1", "grp1", "u1", NOW),
    ];

    for (const statement of foreign) {
      await expect(
        db.batch([
          db
            .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
            .bind("grp2", "Second", "DEF456", NOW),
          statement,
        ])
      ).rejects.toThrow("batch() received a statement not prepared from this handle");
    }
  });

  it("reports how many times the injection fired", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });
    await seedUser(db, "u1");
    expect(injectedFailureCount(db)).toBe(0);

    await expect(db.prepare(insertSession("hash1")).run()).rejects.toThrow();
    await expect(db.prepare(insertSession("hash2")).run()).rejects.toThrow();

    expect(injectedFailureCount(db)).toBe(2);
  });

  it("reports zero firings when the match never matches", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO nothing",
    });
    await seedUser(db, "u1");
    await db.prepare(insertSession("hash1")).run();

    expect(injectedFailureCount(db)).toBe(0);
  });

  it("reports zero firings when onCall overshoots the matching executions", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
      onCall: 5,
    });
    await seedUser(db, "u1");
    await db.prepare(insertSession("hash1")).run();
    await db.prepare(insertSession("hash2")).run();

    // Two statements matched and none failed: a count of matches would say 2.
    expect(injectedFailureCount(db)).toBe(0);
  });

  it("rejects a db it did not wrap", () => {
    expect(() => injectedFailureCount(createFakeD1(loadMigration()))).toThrow(
      "db was not built by withFailingStatement"
    );
  });

  it("builds the default error per throw, so annotating one cannot taint the next", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });
    await seedUser(db, "u1");

    // Callers recovering from a D1 failure routinely annotate what they caught.
    await db
      .prepare(insertSession("hash1"))
      .run()
      .catch((err: Error) => {
        err.message += " (first attempt)";
      });

    await expect(db.prepare(insertSession("hash2")).run()).rejects.toThrow(
      /^D1_ERROR: injected failure$/
    );

    // Both executions must have failed, or the annotation never ran.
    expect(injectedFailureCount(db)).toBe(2);
  });
});

describe("loadMigration", () => {
  it("reads the schema from disk", () => {
    const sql = loadMigration();
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("CREATE TABLE titles");
  });

  // While migrations/ holds a single file, the assertions below are the only
  // thing separating "reads the whole directory, in order" from "reads 0001".
  // loadMigration resolves its directory from process.cwd(), so a temporary cwd
  // is the injection point; vitest's forks pool makes process.chdir available.
  // Under pool: "threads" process.chdir is undefined and this test would throw.
  it("concatenates every migration in filename order and ignores non-SQL files", async () => {
    const root = mkdtempSync(join(tmpdir(), "movie-night-migrations-"));
    mkdirSync(join(root, "migrations"));
    // Written out of filename order. How much that discriminates depends on the
    // filesystem — APFS hands back readdir results already ordered, so the sort
    // is only provably load-bearing where readdir is hash-ordered, as on ext4.
    // The ordering assertion states the property on either.
    // Filename order t1..t4; written scrambled so creation order cannot pass for it.
    for (const name of ["0003_t3", "0001_t1", "0004_t4", "0002_t2"]) {
      const table = name.slice(5);
      // Ends on a comment with no trailing newline, as a hand-written migration
      // can, so a missing separator would comment out the next file's first line.
      writeFileSync(
        join(root, "migrations", `${name}.sql`),
        `CREATE TABLE ${table} (id TEXT);\n-- end of ${table}`
      );
    }
    writeFileSync(join(root, "migrations", "notes.txt"), "CREATE TABLE not_a_migration (id TEXT);\n");

    // The cwd is borrowed for one synchronous call and every assertion runs
    // after it is handed back, so no other test can observe the change.
    const originalCwd = process.cwd();
    let sql: string;
    process.chdir(root);
    try {
      sql = loadMigration();
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }

    expect(sql).not.toContain("not_a_migration");
    const positions = ["t1", "t2", "t3", "t4"].map((table) =>
      sql.indexOf(`CREATE TABLE ${table}`)
    );
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Every table has to survive into a real database, not just into the string.
    const { results } = await createFakeD1(sql)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("builds a database carrying every table the deployed schema has", async () => {
    const db = createFakeD1(loadMigration());

    // A migration that adds or drops a table belongs in the list below.
    // NOT LIKE 'sqlite_%' drops the sqlite_sequence table SQLite creates for
    // rate_limit_log's AUTOINCREMENT id — it is internal, not part of the schema.
    const { results } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual([
      "group_members",
      "groups",
      "movie_sessions",
      "profiles",
      "rate_limit_log",
      "recommendations",
      "session_members",
      "sessions",
      "tension_axes",
      "titles",
      "users",
      "watch_history",
      "watch_ratings",
    ]);
  });
});
