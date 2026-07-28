// ABOUTME: Cloudflare Workers environment bindings declaration.
// ABOUTME: Augments CloudflareEnv with DB, OAuth, JWT, Anthropic, and TMDB secrets.
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ANTHROPIC_API_KEY: string;
  TMDB_API_TOKEN: string;
  MONTHLY_MATCH_LIMIT?: string;
}
