import { defineConfig } from "vitest/config"
import path from "node:path"

const rootDir = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws by default outside Next's RSC bundler (see its
      // package.json `exports` map) — swap in the package's own no-op build
      // so DAL modules can be imported directly under Vitest/Node.
      "server-only": path.resolve(rootDir, "node_modules/server-only/empty.js"),
      "@": path.resolve(rootDir, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // tests/integration/** needs a live local Supabase stack (`supabase
    // start`) and its own globalSetup — run separately via `pnpm test:integration`.
    // tests/e2e/** are Playwright specs, run via `pnpm test:e2e` instead.
    exclude: ["node_modules/**", ".next/**", "tests/integration/**", "tests/e2e/**"],
  },
})
