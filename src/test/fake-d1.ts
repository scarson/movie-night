// ABOUTME: In-memory D1Database implementation backed by node:sqlite (DatabaseSync).
// ABOUTME: Real SQL semantics (FK cascades, RETURNING) with zero new test dependencies.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads the Phase 1 initial schema migration from disk. */
export function loadMigration(): string {
  return readFileSync(join(process.cwd(), "migrations/0001_initial_schema.sql"), "utf-8");
}

/**
 * Cloudflare D1's hard limit on bound parameters per query. node:sqlite's own
 * default (SQLITE_MAX_VARIABLE_NUMBER = 999) is far higher, so without this
 * check the fake would silently accept queries that real D1 rejects — the exact
 * blind spot that let uncapped cross-member IN(...) lists ship. Enforcing it
 * here makes the fake honest, so any query binding >100 params fails a test.
 * See https://developers.cloudflare.com/d1/platform/limits/
 */
export const D1_MAX_BOUND_PARAMS = 100;

class FakeD1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = []
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    if (values.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${values.length} > ${D1_MAX_BOUND_PARAMS})`
      );
    }
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

export interface FailureInjection {
  /** Fail when the statement's SQL matches. Substring for a literal, RegExp for a pattern. */
  match: string | RegExp;
  /** Fail only the Nth matching execution (1-based). Defaults to every match. */
  onCall?: number;
  /** The error thrown. Defaults to `new Error("D1_ERROR: injected failure")`. */
  error?: Error;
}

/**
 * Delegates to a real fake-D1 statement, throwing at execution time when the
 * gate says this SQL is the one that should fail. bind() rewraps so the
 * injection survives the new instance FakeD1PreparedStatement.bind() returns.
 */
class FailingPreparedStatement {
  constructor(
    private readonly inner: D1PreparedStatement,
    private readonly sql: string,
    private readonly gate: (sql: string) => void
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FailingPreparedStatement(
      this.inner.bind(...values),
      this.sql,
      this.gate
    ) as unknown as D1PreparedStatement;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    this.gate(this.sql);
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.gate(this.sql);
    return this.inner.all<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.gate(this.sql);
    return this.inner.run<T>();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    this.gate(this.sql);
    return this.inner.raw<T>();
  }
}

/**
 * Wraps a fake D1 so a chosen statement throws, leaving every other statement
 * working. Interrupted-success paths (a write that fails after earlier writes
 * committed) are otherwise unreachable in this suite — see
 * docs/pitfalls/testing-pitfalls.md §3.
 */
export function withFailingStatement(db: D1Database, injection: FailureInjection): D1Database {
  const { match, onCall } = injection;
  const error = injection.error ?? new Error("D1_ERROR: injected failure");
  let matchedExecutions = 0;

  const gate = (sql: string): void => {
    // String.prototype.search leaves a global RegExp's lastIndex alone, so a /g
    // pattern cannot go stale between statements.
    const matched = typeof match === "string" ? sql.includes(match) : sql.search(match) !== -1;
    if (!matched) return;
    matchedExecutions += 1;
    if (onCall === undefined || matchedExecutions === onCall) throw error;
  };

  const wrappedDb = {
    prepare(sql: string): D1PreparedStatement {
      return new FailingPreparedStatement(db.prepare(sql), sql, gate) as unknown as D1PreparedStatement;
    },

    // The wrapped statements handed in carry the gate, so the underlying batch's
    // BEGIN/ROLLBACK still sees the injected throw and rolls the transaction back.
    batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return db.batch<T>(statements);
    },

    exec(sql: string): Promise<D1ExecResult> {
      return db.exec(sql);
    },

    withSession(): never {
      throw new Error("withSession is not implemented in the fake D1");
    },

    dump(): Promise<ArrayBuffer> {
      return db.dump();
    },
  };

  return wrappedDb as unknown as D1Database;
}
