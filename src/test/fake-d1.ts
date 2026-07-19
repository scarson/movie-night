// ABOUTME: In-memory D1Database implementation backed by node:sqlite (DatabaseSync).
// ABOUTME: Real SQL semantics (FK cascades, RETURNING) with zero new test dependencies.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads the Phase 1 initial schema migration from disk. */
export function loadMigration(): string {
  return readFileSync(join(process.cwd(), "migrations/0001_initial_schema.sql"), "utf-8");
}

class FakeD1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = []
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db, this.sql, values as SQLInputValue[]);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
    if (row == null) return null;
    if (colName) return (row[colName] as T) ?? null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async run<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number; last_row_id: number };
  }> {
    const stmt = this.db.prepare(this.sql);
    const result = stmt.run(...this.params);
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params) as Record<string, unknown>[];
    return rows.map((row) => Object.values(row)) as T[];
  }
}

/**
 * Builds an in-memory D1Database fake against a fresh :memory: SQLite database,
 * applying the given migration SQL and enabling foreign key enforcement (SQLite
 * defaults FKs to off; D1 enforces them, so the fake must opt in to match).
 */
export function createFakeD1(migrationSql: string): D1Database {
  const sqliteDb = new DatabaseSync(":memory:");
  sqliteDb.exec("PRAGMA foreign_keys = ON");
  sqliteDb.exec(migrationSql);

  const fakeDb = {
    prepare(sql: string): D1PreparedStatement {
      return new FakeD1PreparedStatement(sqliteDb, sql) as unknown as D1PreparedStatement;
    },

    async batch<T = Record<string, unknown>>(
      statements: D1PreparedStatement[]
    ): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }[]> {
      sqliteDb.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await (statement as unknown as FakeD1PreparedStatement).run<T>());
        }
        sqliteDb.exec("COMMIT");
        return results;
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw err;
      }
    },

    async exec(sql: string): Promise<{ count: number; duration: number }> {
      sqliteDb.exec(sql);
      return { count: 0, duration: 0 };
    },

    withSession(): never {
      throw new Error("withSession is not implemented in the fake D1");
    },

    async dump(): Promise<ArrayBuffer> {
      throw new Error("dump is not implemented in the fake D1");
    },
  };

  return fakeDb as unknown as D1Database;
}
