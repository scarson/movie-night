// ABOUTME: Vitest configuration — node environment, @ alias to src, global test APIs.
// ABOUTME: Runs src/**/*.test.{ts,tsx} and scripts/**/*.test.ts in forked processes with vitest-setup.ts.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    pool: "forks",
    setupFiles: ["./vitest-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
