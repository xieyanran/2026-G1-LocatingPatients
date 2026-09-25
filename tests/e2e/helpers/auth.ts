import type { Page } from "@playwright/test"
import { TEST_PASSWORD, TEST_USER_EMAILS } from "../../integration/setup/test-users"
import type { Role } from "@/lib/auth/roles"

export { TEST_USER_EMAILS }

export async function loginAs(page: Page, role: Role): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(TEST_USER_EMAILS[role])
  await page.getByLabel("Password").fill(TEST_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("/")
  // The redirect lands on a fresh page load; give client hydration a beat
  // to attach handlers before the test starts clicking things (a click on
  // a not-yet-hydrated button is a silent no-op, not an error).
  await page.waitForLoadState("networkidle")
}
