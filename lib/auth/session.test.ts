import { describe, it, expect, vi, beforeEach } from "vitest"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requireUser, requireRole } from "./session"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

type FakeUser = { id: string; email: string | null }
type FakeRoleRow = { role: string } | null

function mockSupabase(opts: { user: FakeUser | null; roleRow?: FakeRoleRow }) {
  const maybeSingle = vi.fn(async () => ({ data: opts.roleRow ?? null, error: null }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: opts.user } })) },
    from: vi.fn(() => ({ select })),
  }
}

beforeEach(() => {
  vi.mocked(createClient).mockReset()
})

describe("getCurrentUser", () => {
  it("returns null when no session is signed in", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ user: null }) as never)
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it("returns the user with their assigned role", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({
        user: { id: "u1", email: "nurse@example.com" },
        roleRow: { role: "nurse" },
      }) as never,
    )
    await expect(getCurrentUser()).resolves.toEqual({
      id: "u1",
      email: "nurse@example.com",
      role: "nurse",
    })
  })

  it("returns role: null when no role row exists", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ user: { id: "u2", email: null }, roleRow: null }) as never,
    )
    await expect(getCurrentUser()).resolves.toEqual({ id: "u2", email: null, role: null })
  })

  it("returns role: null when the stored role isn't a recognised Role", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({
        user: { id: "u3", email: null },
        roleRow: { role: "not-a-real-role" },
      }) as never,
    )
    await expect(getCurrentUser()).resolves.toEqual({ id: "u3", email: null, role: null })
  })
})

describe("requireUser", () => {
  it("throws Unauthorized when not signed in", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ user: null }) as never)
    await expect(requireUser()).rejects.toThrow("Unauthorized: not signed in")
  })

  it("returns the user when signed in", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ user: { id: "u1", email: null }, roleRow: { role: "doctor" } }) as never,
    )
    await expect(requireUser()).resolves.toEqual({ id: "u1", email: null, role: "doctor" })
  })
})

describe("requireRole", () => {
  it("rejects a signed-in user whose role isn't in the allowed list", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ user: { id: "u1", email: null }, roleRow: { role: "nurse" } }) as never,
    )
    await expect(requireRole("coordinator", "admin")).rejects.toThrow(
      "Forbidden: requires role coordinator or admin",
    )
  })

  it("rejects a signed-in user with no assigned role", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ user: { id: "u1", email: null }, roleRow: null }) as never,
    )
    await expect(requireRole("nurse")).rejects.toThrow("Forbidden: requires role nurse")
  })

  it("rejects when not signed in at all", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ user: null }) as never)
    await expect(requireRole("nurse")).rejects.toThrow("Unauthorized: not signed in")
  })

  it("resolves and returns the user when their role is allowed", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({ user: { id: "u1", email: null }, roleRow: { role: "admin" } }) as never,
    )
    await expect(requireRole("coordinator", "admin")).resolves.toEqual({
      id: "u1",
      email: null,
      role: "admin",
    })
  })
})
