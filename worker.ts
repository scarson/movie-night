// ABOUTME: Custom Cloudflare Worker entry point.
// ABOUTME: Wraps OpenNext for HTTP requests + adds scheduled() for cron triggers.

import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { handler } from "./.open-next/server-functions/default/handler.mjs";
import { runWeeklyRefresh } from "./src/lib/cron-handler";

const worker = {
  async fetch(request: Request, env: any, ctx: any) {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      return handler(request, env, ctx);
    });
  },

  // Awaiting and rethrowing marks the Cron Trigger invocation failed in
  // Cloudflare's metrics, which a rejection handed to waitUntil does not — that
  // still reports success. Cron invocations get a 15-minute budget, so awaiting
  // the whole refresh is safe.
  async scheduled(event: any, env: any) {
    try {
      await runWeeklyRefresh(env);
    } catch (err) {
      console.log(JSON.stringify({ event: "cron_failed", message: String(err) }));
      throw err;
    }
  },
};

export default worker;
