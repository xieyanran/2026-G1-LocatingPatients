import "server-only"
import { createClient } from "@/lib/supabase/server"
import { isRole, type Role } from "./roles"

export type CurrentUser = {
  id: string
  email: string | null
  role: Role | null
}

/** Re-validates the session against Supabase Auth (not just the cookie) and
 * looks up the caller's assigned role. Returns null if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle()

  return {
    id: user.id,
    email: user.email ?? null,
    role: isRole(roleRow?.role) ? roleRow.role : null,
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized: not signed in")
  return user
}

/** Throws if the caller isn't signed in or doesn't have one of `roles`.
 * This is the application-layer check — RLS (supabase/migrations/*_enable_rls.sql)
 * is the check that still applies even if this is skipped or bypassed. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser()
  if (!user.role || !roles.includes(user.role)) {
    throw new Error(`Forbidden: requires role ${roles.join(" or ")}`)
  }
  return user
}
