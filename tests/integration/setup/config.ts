import { execFileSync } from "node:child_process"

export interface LocalSupabaseConfig {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}

let cached: LocalSupabaseConfig | null = null

/** Reads connection details for the local `supabase start` stack. These
 * tests talk to Postgres/PostgREST directly (not through the Next.js app),
 * so they need the stack's URL and keys — fetched live via the CLI rather
 * than hard-coded, since `supabase start` always prints them but a
 * developer could still override ports in supabase/config.toml. */
export function getLocalSupabaseConfig(): LocalSupabaseConfig {
  if (cached) return cached

  let raw: string
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    throw new Error(
      "Local Supabase stack isn't running. These are integration tests against " +
        "the real local stack — run `npx supabase start` first (see issue #9).",
    )
  }

  const status = JSON.parse(raw) as {
    API_URL: string
    ANON_KEY: string
    SERVICE_ROLE_KEY: string
  }

  cached = {
    apiUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  }
  return cached
}
