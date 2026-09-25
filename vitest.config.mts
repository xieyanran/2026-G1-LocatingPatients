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
    exclude: ["node_modules/**", ".next/**"],
  },
})
