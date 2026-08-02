// ABOUTME: Pure logic for the post-deploy smoke check — finding a content-hashed asset in
// ABOUTME: served HTML and judging the landing page, the unauthenticated API and cache headers.
import type { CheckResult } from "./preflight-lib";

/**
 * A `/_next/static/...` script or stylesheet, from a src or href attribute.
 * Everything under that prefix is content-hashed — which is exactly the claim
 * `public/_headers` makes when it marks the whole prefix immutable — so the
 * prefix, not the filename's shape, is the right thing to match. Turbopack's
 * hashes are base36 (`27jktro2p5rq9.js`) with no separator before them.
 */
const HASHED_ASSET = /["'](\/_next\/static\/[^"']+\.(?:js|css))["']/i;

/**
 * Picks one content-hashed asset out of the landing page's HTML. The point is to
 * exercise a URL the browser will treat as permanently cacheable, so it has to
 * come from what production actually served rather than from a guessed filename.
 */
export function extractHashedAssetPath(html: string): string | null {
  return html.match(HASHED_ASSET)?.[1] ?? null;
}

export function landingCheck(status: number, body: string): CheckResult {
  if (status !== 200) {
    return {
      name: "landing page renders",
      ok: false,
      detail: `GET / returned ${status}`,
      remedy: "Watch the failing request: npx wrangler tail --format pretty, then reload the page.",
    };
  }
  if (!/<html|<!doctype html/i.test(body)) {
    return {
      name: "landing page renders",
      ok: false,
      detail: "GET / returned 200 but the body is not HTML",
      remedy: "Check the Worker is serving the OpenNext handler and not only static assets.",
    };
  }
  return { name: "landing page renders", ok: true, detail: `GET / returned 200, ${body.length} bytes of HTML` };
}

/**
 * The negative control from `dev/reports/2026-08-01-e2e-smoke-verification.md`:
 * an unauthenticated `/api/auth/me` must refuse. A 200 means the gate is open; a
 * 500 is what a route whose D1 schema is behind the code looks like from outside,
 * because authenticateRequest runs before each route's own error handling.
 */
export function unauthenticatedApiCheck(status: number, body: string): CheckResult {
  const name = "unauthenticated API refuses";
  if (status === 401) {
    return { name, ok: true, detail: `GET /api/auth/me returned 401 ${body.trim().slice(0, 60)}` };
  }
  if (status === 200) {
    return {
      name,
      ok: false,
      detail: "GET /api/auth/me returned 200 without a session cookie",
      remedy: "Stop. Authentication is not gating this route — do not share the URL until it does.",
    };
  }
  return {
    name,
    ok: false,
    detail: `GET /api/auth/me returned ${status}, expected 401`,
    remedy:
      "A 500 here usually means the schema is behind the code. Run: npm run preflight -- --remote, then npx wrangler tail.",
  };
}

export function cacheControlCheck(header: string | null, path: string): CheckResult {
  const name = "hashed assets are immutable";
  if (header && /immutable/i.test(header)) {
    return { name, ok: true, detail: `${path} → ${header}` };
  }
  return {
    name,
    ok: false,
    detail: `${path} → ${header ?? "no Cache-Control header"}`,
    remedy:
      "public/_headers should mark /_next/static/* immutable. Confirm the file shipped in .open-next/assets, then record in docs/deploy.md what production served before the fix — the finding depends on it.",
  };
}
