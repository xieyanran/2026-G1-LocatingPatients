import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { signInAs, createServiceClient } from "./setup/clients"

// Issue #12: two sessions (e.g. two nurses on different devices) dragging
// different patients onto the *same* free bed at the same time. Before
// supabase/migrations/20260925120200_enforce_bed_uniqueness.sql, nothing
// stopped both writes from succeeding — a silent double-booking. This
// exercises the real race against the local Postgres instance: whichever
// request's UPDATE commits first wins the bed; the constraint on
// (location_room, location_bed) makes the second one fail immediately with
// a recognisable conflict instead of silently overwriting.

const TARGET_ROOM = "TEST-CONCURRENCY"
const TARGET_BED = 1

describe("bed-move concurrency", () => {
  let patientAId: string
  let patientBId: string

  beforeEach(async () => {
    const service = createServiceClient()
    const { data, error } = await service
      .from("patients")
      .insert([
        { name: "Concurrency test patient A" },
        { name: "Concurrency test patient B" },
      ])
      .select("id")
    if (error) throw error
    ;[patientAId, patientBId] = data.map((row) => row.id)
  })

  afterEach(async () => {
    const service = createServiceClient()
    await service.from("patients").delete().in("id", [patientAId, patientBId])
  })

  it("lets exactly one of two simultaneous moves onto the same bed win, and rejects the other with a clear conflict", async () => {
    // Two independent sessions — same role, separate logins, mirroring two
    // different nurses' devices — racing for the same bed.
    const sessionA = await signInAs("nurse")
    const sessionB = await signInAs("nurse")

    const moveA = sessionA
      .from("patients")
      .update({ location_room: TARGET_ROOM, location_bed: TARGET_BED })
      .eq("id", patientAId)
    const moveB = sessionB
      .from("patients")
      .update({ location_room: TARGET_ROOM, location_bed: TARGET_BED })
      .eq("id", patientBId)

    // Both requests are in flight before either is awaited.
    const [resultA, resultB] = await Promise.all([moveA, moveB])

    const errors = [resultA.error, resultB.error]
    const succeeded = errors.filter((e) => e === null).length
    const failed = errors.filter((e) => e !== null).length

    expect(succeeded).toBe(1)
    expect(failed).toBe(1)

    // The failure must be *this* conflict, recognisably — not a generic
    // crash — so a caller (and eventually the UI) can tell "pick another
    // bed" apart from any other kind of failure.
    const conflictError = errors.find((e) => e !== null)!
    expect(conflictError.code).toBe("23505")
    expect(conflictError.message).toContain("patients_location_occupied_key")

    // And the DB itself never had both patients in the bed at once, even
    // transiently — confirmed by reading back the committed end state.
    const service = createServiceClient()
    const { data: rows } = await service
      .from("patients")
      .select("id, location_room, location_bed")
      .in("id", [patientAId, patientBId])

    const inTargetBed = rows!.filter(
      (r) => r.location_room === TARGET_ROOM && r.location_bed === TARGET_BED,
    )
    expect(inTargetBed).toHaveLength(1)

    const loser = rows!.find((r) => r.id !== inTargetBed[0].id)
    expect(loser?.location_room).toBeNull()
    expect(loser?.location_bed).toBeNull()
  })

  it("swaps two already-occupied beds atomically, without tripping the same-bed conflict", async () => {
    const service = createServiceClient()
    await service
      .from("patients")
      .update({ location_room: TARGET_ROOM, location_bed: 1 })
      .eq("id", patientAId)
    await service
      .from("patients")
      .update({ location_room: TARGET_ROOM, location_bed: 2 })
      .eq("id", patientBId)

    const nurse = await signInAs("nurse")
    const { error } = await nurse.rpc("swap_patient_locations", {
      patient_a_id: patientAId,
      patient_b_id: patientBId,
    })
    expect(error).toBeNull()

    const { data: rows } = await service
      .from("patients")
      .select("id, location_bed")
      .in("id", [patientAId, patientBId])
    expect(rows!.find((r) => r.id === patientAId)?.location_bed).toBe(2)
    expect(rows!.find((r) => r.id === patientBId)?.location_bed).toBe(1)
  })
})
