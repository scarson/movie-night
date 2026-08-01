// ABOUTME: Wraps a D1Database so every statement a caller binds is recorded with its
// ABOUTME: parameter count, making chunking and per-request round-trip counts assertable.

/** One bound statement, as the caller issued it. */
export interface BoundStatement {
  sql: string;
  boundParams: number;
}

/**
 * Records each `prepare(sql).bind(...)` pair and then delegates unchanged.
 *
 * The fake D1 rejects only *above* D1's 100-parameter ceiling, so a statement
 * sitting exactly at the limit is indistinguishable from one with headroom
 * unless the width itself is asserted — the blind spot
 * `docs/pitfalls/implementation-pitfalls.md` PLAT-1 describes. Statement counts
 * also stand in for round-trips, which is what chunking a per-id loop removes.
 *
 * Only statements that are bound are recorded; a `prepare(sql).all()` with no
 * parameters never reaches the interception point.
 */
export function recordStatements(db: D1Database): {
  db: D1Database;
  statements: BoundStatement[];
} {
  const statements: BoundStatement[] = [];

  const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement =>
    Object.assign(Object.create(statement) as D1PreparedStatement, {
      bind(...values: unknown[]): D1PreparedStatement {
        // Bind first, so the fake's parameter ceiling still throws before we record.
        const bound = statement.bind(...values);
        statements.push({ sql, boundParams: values.length });
        return wrapStatement(bound, sql);
      },
    });

  const wrapped = Object.assign(Object.create(db) as D1Database, {
    prepare(sql: string): D1PreparedStatement {
      return wrapStatement(db.prepare(sql), sql);
    },
  });

  return { db: wrapped, statements };
}
