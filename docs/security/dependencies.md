# Dependency and supply-chain review

**Date:** 2026-08-02
**Queue item:** 9 in `dev/plans/2026-08-01-next-queue.md`
**Why now:** the app is about to be shared publicly and holds Google OAuth tokens, session material
and an Anthropic key. Its dependency tree had never been reviewed.

**Headline:** the installed Next.js carried **nine advisories**, every one of them fixed in a version
one patch step away. Bumped, and every gate plus the OpenNext build re-verified. What remains is a
single native module that provably does not ship.

---

## The Next.js advisories — fixed

`next@16.2.10` was installed. All nine advisories `npm audit` reports against it share the affected
range **`>=16.0.0 <16.2.11`**:

| Advisory | Severity | Reachable here? |
|---|---|---|
| [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) Middleware/proxy bypass, App Router + Turbopack + single locale | high | No — no locales configured, and auth is `authenticateRequest()`, not middleware |
| [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) SSRF in rewrites via attacker-controlled destination host | high | No — `next.config.ts` is empty; no rewrites |
| [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) DoS in App Router using Server Actions | high | No — no `"use server"` anywhere in `src/` |
| [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) SSRF in Server Actions on custom servers | high | No — same |
| [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) Unbounded Server Action payload, Edge runtime | moderate | No — same |
| [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) Unauthenticated disclosure of internal Server Function endpoints | moderate | No — same |
| [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch) DoS in the Image Optimization API using SVGs | moderate | No — no `next/image`; `poster.tsx` uses a plain `<img>` because optimization is unavailable on Workers |
| **[GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) Cache confusion of response bodies for requests with bodies** | moderate | **Plausibly yes** |
| **[GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) Cache confusion, bodies with invalid UTF-8** | moderate | **Plausibly yes** |

The last two are the reason this is not a paperwork exercise. Every write path in the app is a POST
with a body — `/api/movie-sessions`, `/api/movie-sessions/[id]/match`, `/api/groups`,
`/api/groups/join`, `/api/user/profile` — and a cache that confuses response bodies between such
requests is, in this product, one couple's recommendations served to another. I have not proven the
confusion is reachable through OpenNext's cache adapter; I have not proven it is not, either. The fix
was one patch step away, so the question did not need settling.

**Action:** `next` and `eslint-config-next` → **16.2.12**. That is inside the existing `^16.2.10`
range, so it is a lockfile move, not a range change. Verified after: `tsc` clean, `eslint` clean,
1,564 tests passing, **OpenNext build clean**.

---

## What remains, and why it stays

`npm audit` still reports 5 high entries. All of them are one package, reached two ways.

### `sharp@0.34.5` — build-time only, and it does not ship

[GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj): libvips CVEs, fixed in
sharp ≥0.35.0. Reached via `next → sharp` and `wrangler → miniflare → sharp`. `miniflare` and
`wrangler` are flagged only for depending on it.

Measured rather than assumed:

```
grep -o "sharp" .open-next/worker.js | wc -l     →  0
ls .open-next/server-functions/default/node_modules/sharp  →  not present
```

`wrangler.jsonc` uploads `main` (`worker.ts`, which bundles `.open-next/worker.js`) plus the static
`assets` directory. The bundled worker contains no reference to sharp, and the package is not in the
build output's `node_modules`. The one `require("sharp")` in the tree is inside Next's own
`image-optimizer.js` in the *intermediate* build directory, which is input to the bundler, not output
from it. And sharp is a native module — it could not execute on Workers even if it were bundled.

So this is a vulnerability in a build-host dependency, not in the deployed application.

### Why `wrangler` stays pinned at exactly `4.105.0`

`npm audit` would clear the miniflare/sharp chain with `wrangler@4.118.0`. The exact pin is
deliberate and its reason is recorded in `dev/implementation-log.md` and the Phase 1 plan: **wrangler
≥4.108.0 declares a peer dependency on `@cloudflare/workers-types@^5.x`**, which conflicts with the
pinned v4 workers-types line and fails to resolve (ERESOLVE).

Clearing a dev-only advisory in a package that cannot run on the target platform is not worth a
coordinated major bump of the platform type definitions on the eve of a first deploy. The queue item's
own guidance — *a version bump that breaks the Worker build is worse than a stale-but-working
dependency* — points the same way. **Revisit when workers-types v5 is adopted deliberately, not as a
side effect.**

### `npm audit fix --force` would install `next@9.3.3`

Recorded because it is the trap here: npm's "fix all" for the sharp chain is a seven-major downgrade
of the framework. Never run it on this repo.

---

## Everything else was brought current

`npm update` applied every in-range update; `npm outdated` now reports nothing where *Wanted* differs
from *Current*. Gates re-run after: all green, OpenNext build clean.

Deliberately **not** taken, each a major and none load-bearing for security:

| Package | Current | Latest | Why not |
|---|---|---|---|
| `nanoid` | 5.1.16 | 6.0.0 | Used for ids only. No advisory. A major for nothing. |
| `@cloudflare/workers-types` | 4.x | 5.x | Coupled to the wrangler pin above — one decision, not two. |
| `typescript` | 6.0.3 | 7.0.2 | Whole-repo type surface. Deserves its own change. |
| `eslint` | 9.39.5 | 10.8.0 | Flat-config major; `eslint-config-next` has to agree. |
| `jsdom`, `vite`, `@vitejs/plugin-react`, `@types/node` | — | majors | Test-only. No advisories. |
| `@anthropic-ai/sdk` | 0.112.5 | 0.115.0 | `^0.112.3` does not admit 0.115 (0.x semver). No advisory. The matching engine is the last thing to bump casually before a first deploy. |

---

## The credential path

`arctic` (OAuth) and `jose` (JWT) are the two dependencies that can compromise the app outright.

| Package | Installed | Latest | Licence | Advisories |
|---|---|---|---|---|
| `arctic` | 3.7.0 | 3.7.0 | MIT | none |
| `jose` | 6.2.7 | 6.2.7 | MIT | none |

Both are current to the latest published version after this pass, both MIT, neither has an open
advisory. `jose` moved 6.2.3 → 6.2.7 in the in-range update; it is the single most security-relevant
package in the tree and it is now exactly current.

---

## Install scripts

This npm gates lifecycle scripts, and **none is approved in this project** — every install prints:

```
npm warn allow-scripts   fsevents@2.3.3      (install: node-gyp rebuild)
npm warn allow-scripts   esbuild@0.28.1      (postinstall: node install.js)
npm warn allow-scripts   workerd@1.20260625.1 (postinstall: node install.js)
npm warn allow-scripts   sharp@0.34.5        (install: install scripts present)
npm warn allow-scripts   unrs-resolver@1.12.2
```

That is the correct posture and it should stay: these are the four packages that would run arbitrary
code at install time, and three of them (`esbuild`, `workerd`, `sharp`) download platform binaries.
There is no project `.npmrc`, so the default holds. **Do not run `npm approve-scripts --all`.** If a
build ever needs one of them, approve that one package by name and record why here.

---

## Lockfile and history

- **Lockfile integrity:** `npm ci --dry-run` resolves cleanly against `package-lock.json`.
- **Secrets in history — none.** Scanned all **299 commits across every ref**, not just the tree, for
  `sk-ant-…`, `GOCSPX-…`, `AKIA…`, `ghp_…` and PEM private-key headers.
  - No `.dev.vars`, `.env*`, `*.pem`, `*.key` or `wrangler.toml` has ever been added in any commit on
    any ref (`git log --all --diff-filter=A`).
  - The only `sk-ant-` matches are deliberate placeholders: `sk-ant-your-anthropic-api-key` in
    `.dev.vars.example`, and `sk-ant-local-dummy-not-called` / `sk-ant-local-dummy-not-a-real-key` in
    two reports documenting the local runbook. All obviously non-functional.

---

## What this review did not do

- **No transitive licence audit.** Every direct dependency is MIT; the full transitive tree was not
  enumerated for licence compatibility. The app is not being redistributed as a package, so the
  exposure is low, but the claim here is limited to direct dependencies.
- **No provenance or signature verification.** npm provenance attestations were not checked.
- **No runtime SBOM.** The sharp finding rests on grepping the bundled `worker.js` and the build
  output's `node_modules`, which is direct evidence for that package. It is not a general inventory
  of what the Worker ships.
