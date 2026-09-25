import { defineConfig } from "vitest/config"
import path from "node:path"

const rootDir = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/setup/global-setup.ts"],
    // These share one local Supabase stack and, for the concurrency test,
    // deliberately-contended rows — run files one at a time so they can't
    // interfere with each other.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
