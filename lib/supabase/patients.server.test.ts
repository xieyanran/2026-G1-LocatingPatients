import { describe, it, expect, vi, beforeEach } from "vitest"
import { requireRole } from "@/lib/auth/session"
import { createClient } from "./server"
import { addPatient, setPatientLocation, editPatient, deletePatient } from "./patients.server"

vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(),
}))

vi.mock("./server", () => ({
  createClient: vi.fn(),
}))

/** A chainable query-builder stub. The first table-scoped call (`select`,
 * `insert`, `update` or `delete`) decides which configured result the chain
 * eventually resolves to — matching how each DAL function shapes its call
 * (e.g. `insert().select().single()` vs a bare `update().eq(...)`). */
function mockSupabase(results: {
  select?: { data: unknown; error: unknown }
  insert?: { data: unknown; error: unknown }
  update?: { data: unknown; error: unknown }
  delete?: { data: unknown; error: unknown }
}) {
  let mode: keyof typeof results | null = null
  const resolved = () => Promise.resolve(results[mode!] ?? { data: null, error: null })

  const builder: PromiseLike<unknown> & Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(() => {
      if (mode === null) mode = "select"
      return builder
    }),
    insert: vi.fn(() => {
      mode = "insert"
      return builder
    }),
    update: vi.fn(() => {
      mode = "update"
      return builder
    }),
    delete: vi.fn(() => {
      mode = "delete"
      return builder
    }),
    eq: vi.fn(() => builder),
    single: vi.fn(() => resolved()),
    then: (onFulfilled: never, onRejected: never) => resolved().then(onFulfilled, onRejected),
  } as never

  return { from: vi.fn(() => builder) }
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset()
  vi.mocked(createClient).mockReset()
})

describe("role guards", () => {
  it("addPatient requires coordinator or admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new Error("Forbidden: requires role coordinator or admin"),
    )
    await expect(addPatient({ name: "Alice" })).rejects.toThrow(
      "Forbidden: requires role coordinator or admin",
    )
    expect(requireRole).toHaveBeenCalledWith("coordinator", "admin")
    // The rejection must short-circuit before any DB call is attempted.
    expect(createClient).not.toHaveBeenCalled()
  })

  it("setPatientLocation requires nurse, coordinator or admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Forbidden: requires role nurse or coordinator or admin"))
    await expect(setPatientLocation("p1", { room: "01", bed: 1 })).rejects.toThrow(/Forbidden/)
    expect(requireRole).toHaveBeenCalledWith("nurse", "coordinator", "admin")
  })

  it("editPatient requires nurse, coordinator or admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Forbidden"))
    await expect(editPatient("p1", { name: "Bob" })).rejects.toThrow("Forbidden")
    expect(requireRole).toHaveBeenCalledWith("nurse", "coordinator", "admin")
  })

  it("deletePatient requires coordinator or admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Forbidden"))
    await expect(deletePatient("p1")).rejects.toThrow("Forbidden")
    expect(requireRole).toHaveBeenCalledWith("coordinator", "admin")
    expect(createClient).not.toHaveBeenCalled()
  })

  it("addPatient succeeds once requireRole resolves", async () => {
    vi.mocked(requireRole).mockResolvedValue({ id: "u1", email: null, role: "admin" })
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ insert: { data: { id: "new-id" }, error: null } }) as never,
    )
    await expect(addPatient({ name: "Alice" })).resolves.toBe("new-id")
  })
})

describe("editPatient nurse field-restriction diff", () => {
  const currentRow = {
    id: "p1",
    name: "Original Name",
    note: "original note",
    planned_operation: null,
    planned_check_in: null,
    planned_check_out: null,
    personal_number: null,
    protected_identity: false,
    location_room: "01",
    location_bed: 1,
    care_level_medicine: "A",
    care_level_nursing: 1,
    quick_icons: [],
  }

  function setup() {
    vi.mocked(requireRole).mockResolvedValue({ id: "nurse-1", email: null, role: "nurse" })
    const supabase = mockSupabase({
      select: { data: currentRow, error: null },
      update: { data: null, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(supabase as never)
    return supabase
  }

  it("allows a nurse to change location, care level and quick icons", async () => {
    setup()
    await expect(
      editPatient("p1", {
        location: { room: "02", bed: 2 },
        careLevel: { medicine: "B", nursing: 2 },
        quickIcons: ["fallrisk"],
      }),
    ).resolves.toBeUndefined()
  })

  it("allows a nurse to resubmit the form with restricted fields unchanged", async () => {
    // The edit form always submits every field, so unchanged values (same as
    // the stored row) must not be treated as a forbidden change.
    setup()
    await expect(
      editPatient("p1", {
        name: currentRow.name,
        note: currentRow.note,
        location: { room: "02", bed: 2 },
      }),
    ).resolves.toBeUndefined()
  })

  it("rejects a nurse changing the name", async () => {
    setup()
    await expect(editPatient("p1", { name: "New Name" })).rejects.toThrow(
      "Forbidden: nurse can only edit location, care level and flags",
    )
  })

  it("rejects a nurse changing the note", async () => {
    setup()
    await expect(editPatient("p1", { note: "a different note" })).rejects.toThrow(
      "Forbidden: nurse can only edit location, care level and flags",
    )
  })

  it("rejects a nurse changing the protected-identity flag", async () => {
    setup()
    await expect(editPatient("p1", { protectedIdentity: true })).rejects.toThrow(
      "Forbidden: nurse can only edit location, care level and flags",
    )
  })

  it("rejects a nurse changing the personal number", async () => {
    setup()
    await expect(
      editPatient("p1", { personalNumber: "20000101-1234" }),
    ).rejects.toThrow("Forbidden: nurse can only edit location, care level and flags")
  })

  it("does not restrict coordinators from changing the name", async () => {
    vi.mocked(requireRole).mockResolvedValue({ id: "c1", email: null, role: "coordinator" })
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ update: { data: null, error: null } }) as never,
    )
    await expect(editPatient("p1", { name: "New Name" })).resolves.toBeUndefined()
  })
})
