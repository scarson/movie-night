// ABOUTME: Wraps a D1Database so every statement a caller executes is recorded with its
// ABOUTME: parameter count, making chunking and per-request round-trip counts assertable.

/** One executed statement, as the caller issued it. */
export interface BoundStatement {
  sql: string;
  boundParams: number;
}

/** What a wrapper knows about itself, so batch() can record and unwrap it. */
interface StatementRecord extends BoundStatement {
  inner: D1PreparedStatement;
}

/** Key under which a wrapper carries its own record. */
const STATEMENT_RECORD = Symbol("statementRecord");

/**
 * Records each statement at the point it executes and then delegates unchanged.
 *
 * The fake D1 rejects only *above* D1's 100-parameter ceiling, so a statement
 * sitting exactly at the limit is indistinguishable from one with headroom
 * unless the width itself is asserted — the blind spot
 * `docs/pitfalls/implementation-pitfalls.md` PLAT-1 describes.
 *
 * `roundTrips` is what a request costs over the network: one entry per call to
 * the database, holding the statements that call carried. A `batch()` is a
 * single entry however many statements it sends, because D1 sends it as one
 * request. `statements` is the same data flattened, for assertions about
 * chunking that do not care how the statements were grouped.
 *
 * Recording on execution rather than on `bind` is what makes the counts a
 * round-trip budget: a statement with no parameters never binds, and a
 * statement that is prepared but never executed costs nothing.
 *
 * **Requires the fake's state to be reachable through the prototype chain.** Each
 * wrapper is an `Object.create` of the real object, so any method this file does
 * not override resolves `db`, `sql` and `params` off their prototype. That holds
 * while those are ordinary properties — TypeScript's `private` is a compile-time
 * marker and erases to exactly that. ECMAScript `#private` fields in
 * `fake-d1.ts` are not reachable through a prototype, and adopting them there
 * would make every delegated call throw here, so the two files have to stay in
 * step. For the same reason a fake method must not assign to `this`: the write
 * would land on the wrapper as an own property and leave the real object
 * untouched. Nothing assigns today.
 */
export function recordStatements(db: D1Database): {
  db: D1Database;
  statements: BoundStatement[];
  roundTrips: BoundStatement[][];
} {
  const statements: BoundStatement[] = [];
  const roundTrips: BoundStatement[][] = [];

  const record = (trip: StatementRecord[]): void => {
    const entries = trip.map(({ sql, boundParams }) => ({ sql, boundParams }));
    roundTrips.push(entries);
    statements.push(...entries);
  };

  const wrapStatement = (
    statement: D1PreparedStatement,
    sql: string,
    boundParams: number
  ): D1PreparedStatement => {
    const self: StatementRecord = { inner: statement, sql, boundParams };
    return Object.assign(Object.create(statement) as D1PreparedStatement, {
      [STATEMENT_RECORD]: self,

      bind(...values: unknown[]): D1PreparedStatement {
        // Bind first, so the fake's parameter ceiling still throws before we wrap.
        const bound = statement.bind(...values);
        return wrapStatement(bound, sql, values.length);
      },

      first<T>(colName?: string): Promise<T | null> {
        record([self]);
        return colName === undefined ? statement.first<T>() : statement.first<T>(colName);
      },

      all<T>(): Promise<D1Result<T>> {
        record([self]);
        return statement.all<T>();
      },

      run<T>(): Promise<D1Result<T>> {
        record([self]);
        return statement.run<T>();
      },

      raw<T>(): Promise<T[]> {
        record([self]);
        return statement.raw<T>();
      },
    });
  };

  const wrapped = Object.assign(Object.create(db) as D1Database, {
    prepare(sql: string): D1PreparedStatement {
      return wrapStatement(db.prepare(sql), sql, 0);
    },

    // Delegates the inner statements rather than the wrappers, so the one entry
    // recorded here is not joined by an entry per statement as the batch runs
    // them. A statement from anywhere else carries no record and would be
    // invisible, so refuse it rather than under-count the round trip.
    async batch<T>(batched: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const records = batched.map(
        (statement) => (statement as unknown as Record<symbol, StatementRecord | undefined>)[STATEMENT_RECORD]
      );
      if (records.some((entry) => entry === undefined)) {
        throw new Error("recordStatements: batch() received a statement not prepared from this handle");
      }
      const present = records as StatementRecord[];
      record(present);
      return db.batch<T>(present.map((entry) => entry.inner));
    },
  });

  return { db: wrapped, statements, roundTrips };
}
