import { test, expect } from "@playwright/test"
import { loginAs } from "./helpers/auth"
import { createServiceClient } from "../integration/setup/clients"

// Issue #11: a protected-identity patient's name must read "XXXX" for
// every viewer everywhere it's rendered (lib/supabase/patients.ts's
// mapPatientRow masks it at the data boundary, unconditionally — see its
// comment for why there's deliberately no per-role unmask), and the edit
// form must lock the name field so it can't be overwritten with the
// masked placeholder.

test.describe("protected-identity masking", () => {
  let patientName: string

  test.afterEach(async () => {
    const service = createServiceClient()
    await service.from("patients").delete().eq("name", patientName)
  })

  test("shows XXXX everywhere and locks the name field, for every role", async ({ page }) => {
    patientName = `Protected E2E ${Date.now()}`

    await loginAs(page, "coordinator")

    await page.getByRole("button", { name: "New patient" }).click()
    await expect(page.getByLabel("Name *")).toBeVisible()

    await page.getByLabel("Name *").fill(patientName)
    // Accessible name is "Location" (the associated FieldLabel), not the
    // "Select bed…" placeholder text inside it.
    await page.getByRole("button", { name: "Location" }).click()
    // "Op" (operating room slots) is one of the rooms patient-list.tsx's
    // SHOWN_ROOM_IDS actually renders in the round view — unlike IVA/NIV*/
    // EXTR, which that view deliberately excludes. `force: true` because
    // this button sits inside the bed-picker's animated dialog overlay,
    // which Playwright's actionability "stability" check never considers
    // settled here (confirmed by hand: the element is visible/enabled and
    // the click works correctly — this is a test-environment quirk, not
    // an app bug).
    await page.getByRole("button", { name: "Op bed 1" }).click({ force: true })
    // Wait for the bed-picker's own dialog/overlay to fully unmount —
    // otherwise its closing animation leaves a transparent overlay in
    // place just long enough to swallow the next click.
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByLabel(/Protected identity/).check()
    await page.getByRole("button", { name: "Add patient" }).click()

    // Panel closes once addPatient() resolves.
    await expect(page.getByLabel("Name *")).toHaveCount(0)

    // Real name must never reach the page at all, not even transiently.
    await expect(page.getByText(patientName)).toHaveCount(0)

    // Reload for a fresh server-rendered fetch rather than relying on the
    // realtime broadcast to patch local state — realtime delivery here is
    // issue #6's concern, not this one; this test is about masking, which
    // is applied server-side regardless of how the client learns of the row.
    await page.reload()

    // Patient list (`/`). `exact: true` matches only an element whose
    // entire text is "XXXX" — not the New Patient form's "Protected
    // identity (shows as "XXXX" to staff)" checkbox label, and not any
    // wrapping row/button whose *combined* text happens to contain it.
    // (The row's trigger is a plain <button> in patient-list.tsx and
    // planning-board.tsx but a plain <div> in ward-board.tsx, so this
    // targets text content rather than relying on a consistent role.)
    const xxxxText = page.getByText("XXXX", { exact: true })
    await expect(xxxxText.first()).toBeVisible()

    // Edit form: dialog title and the name field both show the mask, and
    // the field is locked (not a fillable input).
    await xxxxText.first().click()
    await expect(page.getByText("XXXX (protected — locked)")).toBeVisible()
    await expect(page.getByLabel("Name *")).toHaveCount(0)
    await page.keyboard.press("Escape")

    // Planning board
    await page.goto("/planning")
    await expect(page.getByText("XXXX", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(patientName)).toHaveCount(0)

    // Ward board / presentation view
    await page.goto("/presentation")
    await expect(page.getByText("XXXX", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(patientName)).toHaveCount(0)

    // "Every viewer, every role" — not just the coordinator who created it.
    await loginAs(page, "nurse")
    await page.goto("/presentation")
    await expect(page.getByText("XXXX", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(patientName)).toHaveCount(0)
  })
})
