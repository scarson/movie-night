// ABOUTME: Post-deploy smoke check — fetches the deployed origin and verifies the landing
// ABOUTME: page, the unauthenticated API refusal, and immutable caching of hashed assets.
import { formatCheck, type CheckResult } from "./preflight-lib";
import { cacheControlCheck, extractHashedAssetPath, landingCheck, unauthenticatedApiCheck } from "./smoke-lib";

const DEFAULT_ORIGIN = "https://movienight.scarson.io";

function parseOrigin(argv: string[]): string {
  const raw = argv.find((arg) => !arg.startsWith("-")) ?? DEFAULT_ORIGIN;
  const origin = raw.startsWith("http") ? raw : `https://${raw}`;
  return origin.replace(/\/+$/, "");
}

async function main(): Promise<void> {
  const origin = parseOrigin(process.argv.slice(2));
  const results: CheckResult[] = [];

  let html = "";
  try {
    const landing = await fetch(`${origin}/`, { redirect: "follow" });
    html = await landing.text();
    results.push(landingCheck(landing.status, html));
  } catch (err) {
    results.push({
      name: "landing page renders",
      ok: false,
      detail: `GET ${origin}/ failed: ${String(err)}`,
      remedy: "Confirm the custom domain is attached to the Worker and its certificate has been provisioned.",
    });
  }

  try {
    const me = await fetch(`${origin}/api/auth/me`);
    results.push(unauthenticatedApiCheck(me.status, await me.text()));
  } catch (err) {
    results.push({
      name: "unauthenticated API refuses",
      ok: false,
      detail: `GET ${origin}/api/auth/me failed: ${String(err)}`,
      remedy: "Confirm the Worker is deployed and routing API paths.",
    });
  }

  const assetPath = extractHashedAssetPath(html);
  if (assetPath === null) {
    results.push({
      name: "hashed assets are immutable",
      ok: false,
      detail: "no content-hashed /_next/static asset was found in the landing HTML to test",
      remedy: "Check the landing page rendered at all (see the check above) before reading anything into this.",
    });
  } else {
    const asset = await fetch(`${origin}${assetPath}`, { method: "GET" });
    results.push(cacheControlCheck(asset.headers.get("cache-control"), assetPath));
  }

  console.log(`Post-deploy smoke — ${origin}\n`);
  for (const result of results) console.log(formatCheck(result));

  const failed = results.filter((result) => !result.ok).length;
  console.log(
    failed === 0
      ? `\n${results.length}/${results.length} automated checks passed. Continue with the signed-in steps in docs/deploy.md §Post-deploy verification.`
      : `\n${failed} of ${results.length} automated checks failed.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
