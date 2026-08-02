// ABOUTME: Tests for the rate_limit_log limiter — window counting, per-(scope, key)
// ABOUTME: isolation, pruning, and the policy numbers each rule is meant to hold.

import { describe, it, expect } from "vitest";
import { createFakeD1, loadMigration, withFailingStatement } from "@/test/fake-d1";
import { RATE_LIMITS, withinRateLimit, recordRateLimitHit, type RateLimitRule } from "./rate-limit";

const TEN_MINUTE_RULE: RateLimitRule = { scope: "test_scope", max: 3, window: "-10 minutes" };
const DAY_RULE: RateLimitRule = { scope: "test_day_scope", max: 3, window: "-24 hours" };

function seedHit(db: D1Database, scope: string, key: string, at: string) {
  return db
    .prepare("INSERT INTO rate_limit_log (scope, key, at) VALUES (?, ?, ?)")
    .bind(scope, key, at)
    .run();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function countHits(db: D1Database, scope: string, key: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM rate_limit_log WHERE scope = ? AND key = ?")
    .bind(scope, key)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("withinRateLimit", () => {
  it("allows a key with fewer hits than the rule's max inside the window", async () => {
    const db = createFakeD1(loadMigration());
    await seedHit(db, TEN_MINUTE_RULE.scope, "k1", minutesAgo(1));
    await seedHit(db, TEN_MINUTE_RULE.scope, "k1", minutesAgo(1));

    await expect(withinRateLimit(db, TEN_MINUTE_RULE, "k1")).resolves.toBe(true);
  });

  it("refuses once the hits inside the window reach the rule's max", async () => {
    const db = createFakeD1(loadMigration());
    for (let i = 0; i < 3; i++) await seedHit(db, TEN_MINUTE_RULE.scope, "k1", minutesAgo(1));

    await expect(withinRateLimit(db, TEN_MINUTE_RULE, "k1")).resolves.toBe(false);
  });

  it("ignores hits older than the rule's window", async () => {
    const db = createFakeD1(loadMigration());
    for (let i = 0; i < 3; i++) await seedHit(db, TEN_MINUTE_RULE.scope, "k1", minutesAgo(15));

    await expect(withinRateLimit(db, TEN_MINUTE_RULE, "k1")).resolves.toBe(true);
  });

  it("counts a longer window's older hits that a ten-minute rule would ignore", async () => {
    // The window is the rule's, not the table's — a day-scoped rule has to see
    // hits a ten-minute rule has already aged out, or a daily cap resets hourly.
    const db = createFakeD1(loadMigration());
    for (let i = 0; i < 3; i++) await seedHit(db, DAY_RULE.scope, "k1", minutesAgo(600));

    await expect(withinRateLimit(db, DAY_RULE, "k1")).resolves.toBe(false);
  });

  it("counts only this rule's scope and only the given key", async () => {
    const db = createFakeD1(loadMigration());
    for (let i = 0; i < 3; i++) {
      await seedHit(db, "other_scope", "k1", minutesAgo(1));
      await seedHit(db, TEN_MINUTE_RULE.scope, "k2", minutesAgo(1));
    }

    await expect(withinRateLimit(db, TEN_MINUTE_RULE, "k1")).resolves.toBe(true);
  });
});

describe("recordRateLimitHit", () => {
  it("records a hit that withinRateLimit then counts", async () => {
    const db = createFakeD1(loadMigration());

    for (let i = 0; i < 3; i++) await recordRateLimitHit(db, TEN_MINUTE_RULE, "k1");

    expect(await countHits(db, TEN_MINUTE_RULE.scope, "k1")).toBe(3);
    await expect(withinRateLimit(db, TEN_MINUTE_RULE, "k1")).resolves.toBe(false);
  });

  it("prunes this key's rows from outside the rule's window", async () => {
    const db = createFakeD1(loadMigration());
    const old = minutesAgo(15);
    await seedHit(db, TEN_MINUTE_RULE.scope, "k1", old);

    await recordRateLimitHit(db, TEN_MINUTE_RULE, "k1");

    const { results } = await db
      .prepare("SELECT at FROM rate_limit_log WHERE scope = ? AND key = ?")
      .bind(TEN_MINUTE_RULE.scope, "k1")
      .all<{ at: string }>();
    expect(results).toHaveLength(1);
    expect(results[0].at).not.toBe(old);
  });

  it("leaves other scopes and other keys alone when it prunes", async () => {
    // Rules carry different windows, so a prune that reached past its own
    // (scope, key) would delete rows another rule still counts.
    const db = createFakeD1(loadMigration());
    const old = minutesAgo(15);
    await seedHit(db, DAY_RULE.scope, "k1", old);
    await seedHit(db, TEN_MINUTE_RULE.scope, "k2", old);

    await recordRateLimitHit(db, TEN_MINUTE_RULE, "k1");

    expect(await countHits(db, DAY_RULE.scope, "k1")).toBe(1);
    expect(await countHits(db, TEN_MINUTE_RULE.scope, "k2")).toBe(1);
  });

  it("still records the hit when the prune fails", async () => {
    // The prune is housekeeping and is deliberately not batched with the
    // INSERT: D1's batch() is a transaction, so a failed prune would roll back
    // the rate-limit record while the caller goes on to spend anyway.
    const db = withFailingStatement(createFakeD1(loadMigration()), {
      match: "DELETE FROM rate_limit_log",
    });

    await expect(recordRateLimitHit(db, TEN_MINUTE_RULE, "k1")).resolves.toBeUndefined();

    expect(await countHits(db, TEN_MINUTE_RULE.scope, "k1")).toBe(1);
  });
});

describe("RATE_LIMITS", () => {
  it("holds the policy numbers documented in docs/security/abuse-surface.md", async () => {
    // These are spend and quota policy, not implementation detail. Changing one
    // changes what a single account can cost us, so it fails here first.
    expect(RATE_LIMITS.groupJoin).toEqual({ scope: "group_join", max: 10, window: "-10 minutes" });
    expect(RATE_LIMITS.match).toEqual({ scope: "match", max: 30, window: "-24 hours" });
    expect(RATE_LIMITS.profileSave).toEqual({
      scope: "profile_save",
      max: 20,
      window: "-10 minutes",
    });
    expect(RATE_LIMITS.titleSearch).toEqual({
      scope: "title_search",
      max: 120,
      window: "-10 minutes",
    });
  });

  it("gives every rule its own scope, so no two rules share a bucket", async () => {
    const scopes = Object.values(RATE_LIMITS).map((rule) => rule.scope);
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});
