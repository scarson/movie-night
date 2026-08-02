// ABOUTME: Deploy preflight — verifies secrets, bindings, applied migrations, a non-empty
// ABOUTME: catalog and the cron trigger against --local or --remote, reporting pass/fail + remedy.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDevVars } from "./seed-lib";
import {
  DATABASE_NAME,
  bindingCheck,
  catalogCheck,
  cronCheck,
  formatCheck,
  isWorkerMissing,
  migrationCheck,
  migrationExpectations,
  parseJsonc,
  secretCheck,
  stripAnsi,
  unmetExpectations,
  type CheckResult,
  type D1BindingConfig,
  type SchemaSnapshot,
  type Target,
} from "./preflight-lib";

/** Every binding the app reads at runtime. Kept in step with env.d.ts by hand. */
const REQUIRED_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "JWT_SECRET",
  "ANTHROPIC_API_KEY",
  "TMDB_API_TOKEN",
];

const D1_BINDING = "DB";

/** The weekly refresh is sized for this cadence — see src/lib/cron-handler.ts. */
const EXPECTED_CRONS = ["0 9 * * 1"];

interface WranglerConfig {
  triggers?: { crons?: string[] };
  d1_databases?: D1BindingConfig[];
}

function parseArgs(argv: string[]): Target {
  const local = argv.includes("--local");
  const remote = argv.includes("--remote");
  if (local === remote) {
    console.error("Usage: npm run preflight -- --local | --remote");
    process.exit(2);
  }
  return local ? "local" : "remote";
}

function runWrangler(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["wrangler", ...args], { encoding: "utf-8" });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? String(result.error) : ""}`,
  };
}

/**
 * Wrangler prints a banner before its JSON, so the payload starts at the first
 * `[`. `--json` suppresses the banner on d1 execute but not on every command.
 */
function parseJsonPayload(stdout: string): unknown {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error(`no JSON payload in wrangler output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

/**
 * Secret NAMES only. `wrangler secret list` never returns values and `.dev.vars`
 * is read only for its keys, so no value can reach the output of this script.
 */
function presentSecretNames(target: Target): {
  names: string[];
  workerMissing?: boolean;
  error?: string;
} {
  if (target === "local") {
    const devVarsPath = resolve(process.cwd(), ".dev.vars");
    const fromFile = existsSync(devVarsPath)
      ? Object.keys(parseDevVars(readFileSync(devVarsPath, "utf-8")))
      : [];
    const fromEnv = REQUIRED_SECRETS.filter((name) => process.env[name]);
    return { names: [...new Set([...fromFile, ...fromEnv])] };
  }

  const result = runWrangler(["secret", "list", "--format", "json"]);
  if (!result.ok) {
    // The Worker not existing yet is the expected state before the first deploy,
    // and it means exactly zero secrets are set — a finding, not an error.
    if (isWorkerMissing(result.stderr)) return { names: [], workerMissing: true };
    return { names: [], error: stripAnsi(result.stderr).trim() };
  }
  const payload = parseJsonPayload(result.stdout) as { name: string }[];
  return { names: payload.map((entry) => entry.name) };
}

interface DatabaseFacts {
  snapshot: SchemaSnapshot;
  titleCount: number | null;
}

const SCHEMA_QUERY = "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'";
const CATALOG_QUERY = "SELECT COUNT(*) AS n FROM titles";

function queryDatabase(target: Target, command: string): { rows?: { results: unknown[] }[]; error?: string } {
  const result = runWrangler(["d1", "execute", DATABASE_NAME, `--${target}`, "--json", "--command", command]);
  if (!result.ok) return { error: (result.stderr || result.stdout).trim() };
  return { rows: parseJsonPayload(result.stdout) as { results: unknown[] }[] };
}

/**
 * Reads the schema and the catalog size in two calls rather than one. They are
 * separate because `SELECT COUNT(*) FROM titles` fails outright when the table
 * does not exist, and bundling it would lose the schema read that explains why —
 * an absent table is the migration check's finding to report, not the catalog's.
 */
function readDatabaseFacts(target: Target): { facts: DatabaseFacts; error?: string } {
  const empty: DatabaseFacts = { snapshot: { objects: [] }, titleCount: null };

  const schema = queryDatabase(target, SCHEMA_QUERY);
  if (!schema.rows) return { facts: empty, error: schema.error };
  const snapshot: SchemaSnapshot = { objects: schema.rows[0].results as SchemaSnapshot["objects"] };

  const catalog = queryDatabase(target, CATALOG_QUERY);
  const count = catalog.rows?.[0]?.results?.[0] as { n: number } | undefined;
  return { facts: { snapshot, titleCount: count ? Number(count.n) : null } };
}

function migrationFiles(): { name: string; sql: string }[] {
  const dir = resolve(process.cwd(), "migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf-8") }));
}

function main(): void {
  const target = parseArgs(process.argv.slice(2));
  const config = parseJsonc(readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf-8")) as WranglerConfig;
  const workerSource = readFileSync(resolve(process.cwd(), "worker.ts"), "utf-8");

  const results: CheckResult[] = [];

  results.push(bindingCheck(config.d1_databases ?? [], D1_BINDING));
  results.push(cronCheck(config.triggers?.crons ?? [], EXPECTED_CRONS, /\bscheduled\s*\(/.test(workerSource)));

  const secrets = presentSecretNames(target);
  if (secrets.error) {
    results.push({
      name: "secrets set",
      ok: false,
      detail: `could not list secrets: ${secrets.error.split("\n")[0]}`,
      remedy: "Check you are logged in (npx wrangler whoami) and that wrangler.jsonc names the right Worker.",
    });
  } else if (secrets.workerMissing) {
    results.push({
      name: "secrets set",
      ok: false,
      detail: "the Worker does not exist on this account yet, so none of its secrets are set",
      remedy: [
        "Set each secret — the first one creates the Worker (wrangler prompts for the value):",
        ...REQUIRED_SECRETS.map((name) => `  npx wrangler secret put ${name}`),
      ].join("\n"),
    });
  } else {
    results.push(secretCheck(REQUIRED_SECRETS, secrets.names, target));
  }

  const files = migrationFiles();
  const database = readDatabaseFacts(target);
  if (database.error) {
    results.push({
      name: "migrations applied",
      ok: false,
      detail: `could not read the ${target} database: ${database.error}`,
      remedy:
        target === "local"
          ? "Build the local database first: rm -rf .wrangler/state/v3/d1 && npm run migrate:local"
          : `Confirm ${DATABASE_NAME} exists and you are logged in: npx wrangler d1 list`,
    });
  } else {
    results.push(
      migrationCheck(unmetExpectations(migrationExpectations(files), database.facts.snapshot), files.length, target)
    );
    results.push(
      database.facts.titleCount === null
        ? {
            name: "titles catalog non-empty",
            ok: false,
            detail: "could not count titles — the table does not exist yet",
            remedy: "Apply the migrations first (see the migrations check above), then seed the catalog.",
          }
        : catalogCheck(database.facts.titleCount, target)
    );
  }

  console.log(`Deploy preflight — target: ${target}\n`);
  for (const result of results) console.log(formatCheck(result));

  const failed = results.filter((result) => !result.ok).length;
  console.log(
    failed === 0
      ? `\n${results.length}/${results.length} checks passed. Safe to run npm run deploy.`
      : `\n${failed} of ${results.length} checks failed. Fix them before running npm run deploy.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
