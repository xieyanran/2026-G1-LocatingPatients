import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createAnonClient, signInAs, createServiceClient } from "./setup/clients"
import type { Role } from "@/lib/auth/roles"

const ALL_ROLES: Role[] = ["nurse", "doctor", "coordinator", "admin"]

// A note on how these assertions read Postgres/PostgREST's RLS behaviour:
//
// - INSERT denied by a `with check` policy is a genuine Postgres error
//   ("new row violates row-level security policy") — assert `error` is set.
// - The nurse column-restriction trigger (enforce_nurse_column_restrictions)
//   actively `raise exception`s — also a genuine error.
// - UPDATE/DELETE denied by a `using` policy is *not* an error: the row is
//   simply not matched (same as filtering on a non-existent id), so
//   PostgREST returns 200 with zero rows affected. Those tests chain
//   `.select()` and assert an empty array, then re-read via the
//   service-role client (which bypasses RLS) to confirm nothing changed.

describe("RLS: patients", () => {
  let fixturePatientId: string

  beforeAll(async () => {
    const service = createServiceClient()
    const { data, error } = await service
      .from("patients")
      .insert({ name: "RLS smoke test patient" })
      .select("id")
      .single()
    if (error) throw error
    fixturePatientId = data.id
  })

  afterAll(async () => {
    const service = createServiceClient()
    await service.from("patients").delete().eq("id", fixturePatientId)
  })

  it("anon reads zero patient rows", async () => {
    const anon = createAnonClient()
    const { data, error } = await anon.from("patients").select("id")
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("anon cannot insert a patient", async () => {
    const anon = createAnonClient()
    const { error } = await anon.from("patients").insert({ name: "anon patient" })
    expect(error).not.toBeNull()
  })

  it("anon's update/delete match zero rows and change nothing", async () => {
    const anon = createAnonClient()
    const { data: updateData, error: updateError } = await anon
      .from("patients")
      .update({ note: "hacked by anon" })
      .eq("id", fixturePatientId)
      .select()
    expect(updateError).toBeNull()
    expect(updateData).toEqual([])

    const { data: deleteData, error: deleteError } = await anon
      .from("patients")
      .delete()
      .eq("id", fixturePatientId)
      .select()
    expect(deleteError).toBeNull()
    expect(deleteData).toEqual([])

    const service = createServiceClient()
    const { data: row } = await service
      .from("patients")
      .select("note")
      .eq("id", fixturePatientId)
      .single()
    expect(row?.note).not.toBe("hacked by anon")
  })

  for (const role of ALL_ROLES) {
    it(`${role} can read the patient list`, async () => {
      const client = await signInAs(role)
      const { data, error } = await client.from("patients").select("id").limit(1)
      expect(error).toBeNull()
      expect(data!.length).toBeGreaterThan(0)
    })
  }

  it("doctor is read-only: insert errors, update/delete match zero rows", async () => {
    const doctor = await signInAs("doctor")

    const { error: insertError } = await doctor.from("patients").insert({ name: "doctor patient" })
    expect(insertError).not.toBeNull()

    const { data: updateData, error: updateError } = await doctor
      .from("patients")
      .update({ location_room: "TEST-RLS", location_bed: 1 })
      .eq("id", fixturePatientId)
      .select()
    expect(updateError).toBeNull()
    expect(updateData).toEqual([])

    const { data: deleteData, error: deleteError } = await doctor
      .from("patients")
      .delete()
      .eq("id", fixturePatientId)
      .select()
    expect(deleteError).toBeNull()
    expect(deleteData).toEqual([])
  })

  it("nurse can change a patient's location but not their name", async () => {
    const nurse = await signInAs("nurse")

    const { error: locationError } = await nurse
      .from("patients")
      .update({ location_room: "TEST-RLS", location_bed: 1 })
      .eq("id", fixturePatientId)
    expect(locationError).toBeNull()

    const { error: nameError } = await nurse
      .from("patients")
      .update({ name: "Renamed by nurse" })
      .eq("id", fixturePatientId)
    expect(nameError).not.toBeNull()
    expect(nameError?.message).toContain(
      "Forbidden: nurse can only edit location, care level and flags",
    )

    const service = createServiceClient()
    const { data: row } = await service
      .from("patients")
      .select("name, location_room")
      .eq("id", fixturePatientId)
      .single()
    expect(row?.location_room).toBe("TEST-RLS")
    expect(row?.name).toBe("RLS smoke test patient")
  })

  it("nurse's insert/delete match zero rows or error, never taking effect", async () => {
    const nurse = await signInAs("nurse")

    const { error: insertError } = await nurse.from("patients").insert({ name: "nurse patient" })
    expect(insertError).not.toBeNull()

    const { data: deleteData, error: deleteError } = await nurse
      .from("patients")
      .delete()
      .eq("id", fixturePatientId)
      .select()
    expect(deleteError).toBeNull()
    expect(deleteData).toEqual([])
  })

  it("coordinator can insert, update and delete patients", async () => {
    const coordinator = await signInAs("coordinator")

    const { data: inserted, error: insertError } = await coordinator
      .from("patients")
      .insert({ name: "Coordinator-created patient" })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    const { error: updateError } = await coordinator
      .from("patients")
      .update({ name: "Renamed by coordinator" })
      .eq("id", inserted!.id)
    expect(updateError).toBeNull()

    const { data: deleteData, error: deleteError } = await coordinator
      .from("patients")
      .delete()
      .eq("id", inserted!.id)
      .select()
    expect(deleteError).toBeNull()
    expect(deleteData).toHaveLength(1)
  })
})

describe("RLS: audit_logs", () => {
  it("the audit trigger logs a patient insert; only coordinator/admin can read it", async () => {
    const coordinator = await signInAs("coordinator")
    const { data: inserted, error: insertError } = await coordinator
      .from("patients")
      .insert({ name: "Audit trail test patient" })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    const patientId = inserted!.id

    try {
      const { data: logs, error: logsError } = await coordinator
        .from("audit_logs")
        .select("action, patient_id")
        .eq("patient_id", patientId)
      expect(logsError).toBeNull()
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "INSERT", patient_id: patientId }),
        ]),
      )

      const nurse = await signInAs("nurse")
      const { data: nurseLogs, error: nurseLogsError } = await nurse
        .from("audit_logs")
        .select("id")
        .eq("patient_id", patientId)
      expect(nurseLogsError).toBeNull()
      expect(nurseLogs).toEqual([])
    } finally {
      const service = createServiceClient()
      await service.from("patients").delete().eq("id", patientId)
    }
  })

  it("nobody can write to audit_logs directly — not even admin", async () => {
    const admin = await signInAs("admin")
    const { error } = await admin.from("audit_logs").insert({
      action: "INSERT",
      entity_type: "patients",
      entity_id: "fake",
    })
    expect(error).not.toBeNull()
  })
})
