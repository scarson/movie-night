# Implementation log

## Task 0.1: Initialize Next.js project skeleton

**Built:** `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`. Extended `.gitignore` with `next-env.d.ts`, `.open-next/`, `.wrangler/`, `.DS_Store`.

**Decisions:**
- `package.json` scripts/deps written verbatim from the plan, except two version pins that had to change to make `npm install` resolve (see Gotchas/Deviations below).
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` copied verbatim from `/Users/sam/Code/twin-cities-tee-times` per plan Steps 2-4.
- `layout.tsx`/`page.tsx` written minimal (no Nav/AuthProvider/LocationProvider — those are tee-times-specific and out of scope for Phase 0) with `// ABOUTME:` headers, per plan Step 5. `globals.css` is a single `@import "tailwindcss";` line.
- `eslint.config.mjs` ignores list extended with `"mockup.jsx"` (not in tee-times' config, since tee-times has no such file) — `mockup.jsx` is functional-spec reference material at repo root, not application code, and was failing `react/no-unescaped-entities` lint checks pre-existing in that file.

**Gotchas / Deviations (see plan's Deviations subsection for the canonical record):**
1. `wrangler@^4.105.0` resolves to `4.112.0` on a fresh install, and wrangler ≥4.108.0 declares a peer dependency on `@cloudflare/workers-types@^5.x`, conflicting with the plan-pinned `@cloudflare/workers-types@^4.20260701.1` (ERESOLVE). Pinned `wrangler` to the exact version tee-times' lockfile uses (`4.105.0`, no caret) to stay in the v4 workers-types family, matching the reference implementation exactly.
2. `@anthropic-ai/sdk@^0.116.0` (as specified in the plan) does not exist on the npm registry — latest published version at execution time was `0.112.3`. Pinned to `^0.112.3`.

**Check results:**
- `npm install`: 735 packages, no errors (after the two pins above). 2 moderate audit advisories reported, not investigated further (transitive, pre-existing upstream, no fix available without `--force`) — out of scope for Phase 0.
- `npx tsc --noEmit`: clean, no output.
- `npm run lint`: clean, no output (after adding `mockup.jsx` to eslint ignores).
- `npm run build`: succeeded — `next build` compiled, static pages generated for `/` and `/_not-found`.
