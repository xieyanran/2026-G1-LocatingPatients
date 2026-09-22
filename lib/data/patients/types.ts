import { z } from "zod"
import { RoomSchema } from "@/lib/constants/locations"
import { QUICK_ICON_IDS } from "@/lib/constants/quick-icons"

// ── Personal number ──────────────────────────────────────────────────────────

/**
 * Normalises a raw personal number string to YYYYMMDD-XXXX.
 *
 * Accepted input formats:
 *   YYYYMMDD-XXXX  (canonical — returned as-is)
 *   YYYYMMDDXXXX   (no dash   — dash inserted)
 *   YYMMDD-XXXX    (2-digit year — century prepended)
 *   YYMMDDXXXX     (2-digit year, no dash)
 *
 * Century rule (current year 2026, currentYY = 26):
 *   YY ≤ currentYY  →  20YY   (e.g. 26 → 2026, 03 → 2003)
 *   YY > currentYY  →  19YY   (e.g. 27 → 1927, 74 → 1974)
 */
function normalisePersonalNumber(raw: string): string | null {
  const withoutDash = raw.trim().replace(/-/g, "")
  if (!withoutDash) return null

  let digits: string

  if (withoutDash.length === 10) {
    const yy = parseInt(withoutDash.slice(0, 2), 10)
    const currentYY = new Date().getFullYear() % 100
    const century = yy <= currentYY ? "20" : "19"
    digits = century + withoutDash
  } else if (withoutDash.length === 12) {
    digits = withoutDash
  } else {
    // Unknown length — pass through so the regex rejects it with a clear error.
    return raw.trim()
  }

  return `${digits.slice(0, 8)}-${digits.slice(8)}`
}

/**
 * Accepts all four personal number input formats and stores the result as
 * YYYYMMDD-XXXX. Accepts `null`, `undefined`, and `""` (treated as absent).
 */
export const PersonalNumberSchema = z.preprocess(
  (val): string | null => {
    if (val == null || val === "") return null
    if (typeof val === "string") return normalisePersonalNumber(val)
    return null
  },
  z
    .string()
    .refine(
      (val) => /^\d{8}-\d{4}$/.test(val),
      "Personal number must be in YYYYMMDD-XXXX format",
    )
    .nullable(),
)

// ── Care level ───────────────────────────────────────────────────────────────

export const CareLevelSchema = z.object({
  medicine: z.enum(["A", "B", "C"]),
  nursing: z.number().int().min(1).max(3),
})

// ── Location ─────────────────────────────────────────────────────────────────

export const PatientLocationSchema = z.object({
  room: RoomSchema,
  bed: z.number().int().min(1),
})

// ── Patient ──────────────────────────────────────────────────────────────────

export const QuickIconSchema = z.enum(QUICK_ICON_IDS)

export const PatientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  note: z.string().nullable(),
  plannedOperation: z.string().nullable(),
  plannedCheckIn: z.string().nullable(),   // YYYY-MM-DD
  plannedCheckOut: z.string().nullable(),  // YYYY-MM-DD
  location: PatientLocationSchema.nullable(),
  personalNumber: PersonalNumberSchema,
  careLevel: CareLevelSchema.nullable(),
  quickIcons: z.array(QuickIconSchema).default([]),
  /** PRD 4.1: staff other than coordinator/admin should see "XXXX" instead
   * of the real name. The real value is still stored — masking happens at
   * render time via `displayPatientName()`, not here. */
  protectedIdentity: z.boolean().default(false),
})

/** Input for creating a patient. Only `name` is required; all other fields default to null. */
export const CreatePatientInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  note: z.string().nullable().optional(),
  plannedOperation: z.string().nullable().optional(),
  plannedCheckIn: z.string().nullable().optional(),
  plannedCheckOut: z.string().nullable().optional(),
  location: PatientLocationSchema.nullable().optional(),
  personalNumber: PersonalNumberSchema.optional(),
  careLevel: CareLevelSchema.nullable().optional(),
  quickIcons: z.array(QuickIconSchema).optional(),
  protectedIdentity: z.boolean().optional(),
})

/** All fields optional — only provided fields are written. */
export const UpdatePatientInputSchema = PatientSchema.omit({ id: true })
  .partial()
  .extend({ quickIcons: z.array(QuickIconSchema).optional() })

// ── Inferred types ───────────────────────────────────────────────────────────

export type PatientLocation = z.infer<typeof PatientLocationSchema>
export type CareLevel = z.infer<typeof CareLevelSchema>
export type Patient = z.infer<typeof PatientSchema>
export type { QuickIconId } from "@/lib/constants/quick-icons"
export type CreatePatientInput = z.infer<typeof CreatePatientInputSchema>
export type UpdatePatientInput = z.infer<typeof UpdatePatientInputSchema>
