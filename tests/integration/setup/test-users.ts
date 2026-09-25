import { createClient } from "@supabase/supabase-js"
import { getLocalSupabaseConfig } from "./config"
import type { Database } from "@/lib/supabase/types"
import type { Role } from "@/lib/auth/roles"

export const TEST_PASSWORD = "local-test-password-only-123!"

export const TEST_USER_EMAILS: Record<Role, string> = {
  nurse: "nurse@test.local",
  doctor: "doctor@test.local",
  coordinator: "coordinator@test.local",
  admin: "admin@test.local",
}

/** Creates (or reuses) the four role test users against the local stack and
 * assigns their `user_roles` row. Safe to call repeatedly — each
 * `supabase db reset` wipes `auth.users`, so this re-creates them; run
 * again with the stack already seeded, it just no-ops per user. */
export async function ensureTestUsers(): Promise<void> {
  const { apiUrl, serviceRoleKey } = getLocalSupabaseConfig()
  const admin = createClient<Database>(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const role of Object.keys(TEST_USER_EMAILS) as Role[]) {
    const email = TEST_USER_EMAILS[role]

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })

    let userId = created?.user?.id
    if (createError) {
      // Already exists from a previous run against this same stack —
      // look it up instead of failing.
      const { data: list, error: listError } = await admin.auth.admin.listUsers()
      if (listError) throw listError
      userId = list.users.find((u) => u.email === email)?.id
      if (!userId) throw createError
    }

    const { error: roleError } = await admin
      .from("user_roles")
      .upsert({ user_id: userId!, role }, { onConflict: "user_id" })
    if (roleError) throw roleError
  }
}
