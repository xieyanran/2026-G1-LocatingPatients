"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { Role } from "@/lib/auth/roles"

const CurrentUserRoleContext = createContext<Role | null>(null)

/** Makes the signed-in user's role available to client components so the UI
 * can hide actions the DAL would reject anyway (issue #10) — e.g. a doctor
 * (read-only per lib/supabase/patients.server.ts's requireRole calls)
 * shouldn't see a "New patient" button that would just 403 server-side. */
export function CurrentUserRoleProvider({
  role,
  children,
}: {
  role: Role | null
  children: ReactNode
}) {
  return (
    <CurrentUserRoleContext.Provider value={role}>
      {children}
    </CurrentUserRoleContext.Provider>
  )
}

export function useCurrentUserRole(): Role | null {
  return useContext(CurrentUserRoleContext)
}
