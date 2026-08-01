// ABOUTME: Self-test for the statement recorder — verifies that executions are what get
// ABOUTME: recorded, that a batch counts as one round trip, and that unbound reads are seen.
import { describe, expect, it } from "vitest";
import { createFakeD1, loadMigration } from "./fake-d1";
import { recordStatements } from "./statement-recorder";

function insertUser(db: D1Database, id: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, "Sam", "2026-01-01T00:00:00.000Z");
}

describe("recordStatements", () => {
  it("records a statement executed without binding any parameters", async () => {
    const { db, statements } = recordStatements(createFakeD1(loadMigration()));

    await db.prepare("SELECT COUNT(*) as count FROM users").first();

    expect(statements).toEqual([{ sql: "SELECT COUNT(*) as count FROM users", boundParams: 0 }]);
  });

  it("records the parameter count a bound statement was executed with", async () => {
    const { db, statements } = recordStatements(createFakeD1(loadMigration()));

    await db.prepare("SELECT id FROM users WHERE id = ? OR id = ?").bind("u1", "u2").all();

    expect(statements).toEqual([
      { sql: "SELECT id FROM users WHERE id = ? OR id = ?", boundParams: 2 },
    ]);
  });

  it("ignores a statement that was prepared and bound but never executed", async () => {
    const { db, statements, roundTrips } = recordStatements(createFakeD1(loadMigration()));

    db.prepare("SELECT id FROM users WHERE id = ?").bind("u1");

    expect(statements).toEqual([]);
    expect(roundTrips).toEqual([]);
  });

  it("counts each separately executed statement as its own round trip", async () => {
    const { db, roundTrips } = recordStatements(createFakeD1(loadMigration()));

    await insertUser(db, "u1").run();
    await db.prepare("SELECT id FROM users WHERE id = ?").bind("u1").first();

    expect(roundTrips).toHaveLength(2);
    expect(roundTrips.map((trip) => trip.length)).toEqual([1, 1]);
  });

  it("counts a batch as one round trip carrying every statement in it", async () => {
    const { db, statements, roundTrips } = recordStatements(createFakeD1(loadMigration()));

    await insertUser(db, "u1").run();
    const [count] = await db.batch<{ count: number }>([
      db.prepare("SELECT COUNT(*) as count FROM users"),
      db.prepare("SELECT id FROM users WHERE id = ?").bind("u1"),
    ]);

    // The batch still has to work: recording must not swallow its results.
    expect(count.results).toEqual([{ count: 1 }]);
    expect(roundTrips).toHaveLength(2);
    expect(roundTrips[1]).toEqual([
      { sql: "SELECT COUNT(*) as count FROM users", boundParams: 0 },
      { sql: "SELECT id FROM users WHERE id = ?", boundParams: 1 },
    ]);
    expect(statements).toHaveLength(3);
  });

  it("refuses a batch statement not prepared from this handle", async () => {
    const base = createFakeD1(loadMigration());
    const { db } = recordStatements(base);

    await expect(db.batch([base.prepare("SELECT COUNT(*) as count FROM users")])).rejects.toThrow(
      /not prepared from this handle/
    );
  });
});
