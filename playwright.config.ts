import { defineConfig, devices } from "@playwright/test"

const PORT = 3000

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Runs against the local Supabase stack (`supabase start`), never the
  // hosted project — see .env.development.local. A dedicated port keeps
  // this from colliding with a `pnpm dev` the developer already has open.
  webServer: {
    command: "pnpm dev",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
