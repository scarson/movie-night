// ABOUTME: Self-test for the in-memory D1 fake — verifies insert/select round-trip,
// ABOUTME: DELETE ... RETURNING, and FK cascade delete against the real schema migration.
import { describe, expect, it } from "vitest";
import { createFakeD1, loadMigration } from "./fake-d1";

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

describe("loadMigration", () => {
  it("reads the initial schema migration from disk", () => {
    const sql = loadMigration();
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("CREATE TABLE titles");
  });
});
