// ABOUTME: Tests for the post-deploy smoke check's pure logic — asset discovery from
// ABOUTME: served HTML, cache-header evaluation, and the unauthenticated response checks.
import { describe, expect, it } from "vitest";
import {
  cacheControlCheck,
  extractHashedAssetPath,
  landingCheck,
  unauthenticatedApiCheck,
} from "./smoke-lib";

describe("extractHashedAssetPath", () => {
  it("finds a chunk in a script tag", () => {
    // Turbopack's real output: a base36 content hash, no extension-preserving suffix.
    const html = `<html><head><script src="/_next/static/chunks/27jktro2p5rq9.js" async></script></head></html>`;

    expect(extractHashedAssetPath(html)).toBe("/_next/static/chunks/27jktro2p5rq9.js");
  });

  it("finds a stylesheet in a link tag when no script tag precedes it", () => {
    const html = `<link rel="stylesheet" href="/_next/static/chunks/3q0wak5j2u5n5.css">`;

    expect(extractHashedAssetPath(html)).toBe("/_next/static/chunks/3q0wak5j2u5n5.css");
  });

  it("ignores assets outside /_next/static, which are not content-hashed", () => {
    expect(extractHashedAssetPath(`<script src="/sw.js"></script>`)).toBeNull();
  });

  it("returns null for HTML with no assets at all", () => {
    expect(extractHashedAssetPath("<html><body>hi</body></html>")).toBeNull();
  });
});

describe("cacheControlCheck", () => {
  it("passes on the immutable long-lived header public/_headers sets", () => {
    const result = cacheControlCheck("public, max-age=31536000, immutable", "/_next/static/chunks/a.js");

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("immutable");
  });

  it("fails on the revalidate-every-time default, quoting what was actually served", () => {
    const result = cacheControlCheck("public, max-age=0, must-revalidate", "/_next/static/chunks/a.js");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("max-age=0, must-revalidate");
    expect(result.remedy).toContain("public/_headers");
  });

  it("fails when the response carries no Cache-Control at all", () => {
    expect(cacheControlCheck(null, "/_next/static/chunks/a.js").ok).toBe(false);
  });
});

describe("landingCheck", () => {
  it("passes on a 200 that actually rendered the app", () => {
    const result = landingCheck(200, '<html><body><div id="__next">Movie Night</div></body></html>');

    expect(result.ok).toBe(true);
  });

  it("fails on a 500", () => {
    const result = landingCheck(500, "Internal Server Error");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("500");
    expect(result.remedy).toContain("wrangler tail");
  });

  it("fails on a 200 that served no HTML, which is what a broken asset route looks like", () => {
    expect(landingCheck(200, "not html at all").ok).toBe(false);
  });
});

describe("unauthenticatedApiCheck", () => {
  it("passes on the 401 an unauthenticated /api/auth/me must return", () => {
    const result = unauthenticatedApiCheck(401, '{"error":"Unauthorized"}');

    expect(result.ok).toBe(true);
  });

  it("fails on a 200, which would mean the route answered without a session", () => {
    const result = unauthenticatedApiCheck(200, '{"userId":"user-1"}');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("200");
  });

  it("fails on a 500, which is what an unapplied migration looks like from outside", () => {
    const result = unauthenticatedApiCheck(500, "Internal Server Error");

    expect(result.ok).toBe(false);
    expect(result.remedy).toContain("preflight");
  });
});
