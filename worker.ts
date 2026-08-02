// ABOUTME: Custom Cloudflare Worker entry point.
// ABOUTME: Wraps OpenNext for HTTP requests + adds scheduled() for cron triggers.

import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { handler } from "./.open-next/server-functions/default/handler.mjs";
import { runScheduled } from "./src/lib/cron-handler";

const worker = {
  async fetch(request: Request, env: any, ctx: any) {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      return handler(request, env, ctx);
    });
  },

  // The awaited call, its logging and its rethrow live in runScheduled so they
  // are reachable from a test — this file imports build-time OpenNext artifacts
  // and cannot itself be imported by one.
  async scheduled(event: any, env: any) {
    await runScheduled(event, env);
  },
};

export default worker;
