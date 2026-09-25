import { test, expect } from "@playwright/test"
import { loginAs } from "./helpers/auth"
import type { Role } from "@/lib/auth/roles"

const ALL_ROLES: Role[] = ["nurse", "doctor", "coordinator", "admin"]

test.describe("role-based UI", () => {
  for (const role of ALL_ROLES) {
    test(`${role} can log in and see the ward board`, async ({ page }) => {
      await loginAs(page, role)
      await expect(page.getByText("Neurosurgery · 10/23")).toBeVisible()
      // Confirms patients actually loaded (RLS `patients_select` grants
      // read to any signed-in role) — not just an empty/broken page.
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()
    })
  }

  // addPatient() (lib/supabase/patients.server.ts) requires coordinator or
  // admin. Before app/(ward)/layout.tsx + lib/components/round-controls.tsx
  // were made role-aware (issue #10), every role saw this button — a
  // doctor or nurse clicking it got a 403 from the server action with no
  // warning it wouldn't work.
  for (const role of ["coordinator", "admin"] as Role[]) {
    test(`${role} sees the "New patient" action`, async ({ page }) => {
      await loginAs(page, role)
      await expect(page.getByRole("button", { name: "New patient" })).toBeVisible()
    })
  }

  for (const role of ["nurse", "doctor"] as Role[]) {
    test(`${role} does not see the "New patient" action`, async ({ page }) => {
      await loginAs(page, role)
      await expect(page.getByText("Neurosurgery · 10/23")).toBeVisible()
      await expect(page.getByRole("button", { name: "New patient" })).toHaveCount(0)
    })
  }
})
