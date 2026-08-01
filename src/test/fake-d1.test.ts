// ABOUTME: Self-test for the in-memory D1 fake — verifies insert/select round-trip,
// ABOUTME: DELETE ... RETURNING, FK cascade delete, and statement failure injection.
import { describe, expect, it } from "vitest";
import { D1_MAX_BOUND_PARAMS, createFakeD1, loadMigration, withFailingStatement } from "./fake-d1";

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

  it("rejects the matching statement with the injected error", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
      error: new Error("D1_ERROR: network connection lost"),
    });
    await seedUser(db, "u1");

    await expect(db.prepare(insertSession("hash1")).run()).rejects.toThrow(
      "D1_ERROR: network connection lost"
    );
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

    const { results } = await db.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all();
    expect(results).toEqual([{ token_hash: "hash1" }]);
  });

  it("counts onCall per wrapper rather than globally", async () => {
    const base = createFakeD1(loadMigration());
    await seedUser(base, "u1");
    const first = withFailingStatement(base, { match: "INSERT INTO sessions", onCall: 2 });
    const second = withFailingStatement(base, { match: "INSERT INTO sessions", onCall: 2 });

    await first.prepare(insertSession("hash1")).run();
    // A shared counter would make this the second matching execution and fail it.
    await second.prepare(insertSession("hash2")).run();

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
  });

  it("keeps injecting through bind(), which returns a fresh statement instance", async () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });
    await seedUser(db, "u1");

    await expect(
      db.prepare(INSERT_SESSION_BOUND).bind("hash1", "u1", EXPIRES, NOW).run()
    ).rejects.toThrow("D1_ERROR: injected failure");
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

    const { results } = await db.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all();
    expect(results).toEqual([{ token_hash: "hash1" }]);
  });

  it("still enforces the D1 bound-parameter ceiling", () => {
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "INSERT INTO sessions",
    });

    expect(() =>
      db.prepare("SELECT 1").bind(...new Array(D1_MAX_BOUND_PARAMS + 1).fill(null))
    ).toThrow(`D1_ERROR: too many SQL variables (101 > ${D1_MAX_BOUND_PARAMS})`);
  });
});

describe("loadMigration", () => {
  it("reads the schema from disk", () => {
    const sql = loadMigration();
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("CREATE TABLE titles");
  });

  it("builds a database carrying every table the deployed schema has", async () => {
    const db = createFakeD1(loadMigration());

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
