// ABOUTME: Weekly cron orchestrator that refreshes streaming availability from TMDB.
// ABOUTME: Stub for Phase 0 so worker.ts compiles; real logic lands in Phase 3.

export async function runWeeklyRefresh(
  env: CloudflareEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  console.log("runWeeklyRefresh: stub, no-op (Phase 3 implements streaming refresh)");
}
