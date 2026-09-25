import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getLocalSupabaseConfig } from "./config"
import { TEST_PASSWORD, TEST_USER_EMAILS } from "./test-users"
import type { Database } from "@/lib/supabase/types"
import type { Role } from "@/lib/auth/roles"

/** An anon-key client with no session — what an unauthenticated visitor's
 * requests to PostgREST look like. */
export function createAnonClient(): SupabaseClient<Database> {
  const { apiUrl, anonKey } = getLocalSupabaseConfig()
  return createClient<Database>(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Signs in as one of the four seeded test roles via GoTrue's password
 * grant — the same auth flow the app itself uses, just driven directly
 * instead of through the login page. */
export async function signInAs(role: Role): Promise<SupabaseClient<Database>> {
  const client = createAnonClient()
  const { error } = await client.auth.signInWithPassword({
    email: TEST_USER_EMAILS[role],
    password: TEST_PASSWORD,
  })
  if (error) throw error
  return client
}

export function createServiceClient(): SupabaseClient<Database> {
  const { apiUrl, serviceRoleKey } = getLocalSupabaseConfig()
  return createClient<Database>(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
