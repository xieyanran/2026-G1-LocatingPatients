import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PersonalNumberSchema, CreatePatientInputSchema } from "./types"

describe("PersonalNumberSchema", () => {
  beforeEach(() => {
    // Century rollover is relative to "now" — pin it so YY=26 is the
    // boundary (currentYY) for every test below, regardless of when the
    // suite actually runs.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes a canonical YYYYMMDD-XXXX value through unchanged", () => {
    expect(PersonalNumberSchema.parse("20000101-1234")).toBe("20000101-1234")
  })

  it("inserts the dash for a 12-digit value with no dash", () => {
    expect(PersonalNumberSchema.parse("200001011234")).toBe("20000101-1234")
  })

  it("prepends 20 when the 2-digit year is below currentYY", () => {
    expect(PersonalNumberSchema.parse("000101-1234")).toBe("20000101-1234")
  })

  it("prepends 20 when the 2-digit year equals currentYY (boundary)", () => {
    expect(PersonalNumberSchema.parse("260101-1234")).toBe("20260101-1234")
  })

  it("prepends 19 when the 2-digit year is just above currentYY (boundary)", () => {
    expect(PersonalNumberSchema.parse("270101-1234")).toBe("19270101-1234")
  })

  it("prepends 19 when the 2-digit year is well above currentYY", () => {
    expect(PersonalNumberSchema.parse("991231-5678")).toBe("19991231-5678")
  })

  it("handles a 2-digit-year value with no dash", () => {
    expect(PersonalNumberSchema.parse("2601011234")).toBe("20260101-1234")
  })

  it("trims surrounding whitespace before normalising", () => {
    expect(PersonalNumberSchema.parse("  260101-1234  ")).toBe("20260101-1234")
  })

  it.each([null, undefined, ""])("treats %p as absent", (val) => {
    expect(PersonalNumberSchema.parse(val)).toBeNull()
  })

  it("rejects a value of the wrong length", () => {
    expect(() => PersonalNumberSchema.parse("12345")).toThrow()
  })

  it("rejects non-numeric content", () => {
    expect(() => PersonalNumberSchema.parse("abcd0101-1234")).toThrow()
  })
})

describe("CreatePatientInputSchema", () => {
  it("only requires name and defaults everything else", () => {
    const parsed = CreatePatientInputSchema.parse({ name: "Alice" })
    expect(parsed).toMatchObject({ name: "Alice" })
  })

  it("rejects an empty name", () => {
    expect(() => CreatePatientInputSchema.parse({ name: "" })).toThrow()
  })

  it("normalises a 2-digit-year personal number the same way as the standalone schema", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1))
    const parsed = CreatePatientInputSchema.parse({
      name: "Alice",
      personalNumber: "260101-1234",
    })
    expect(parsed.personalNumber).toBe("20260101-1234")
    vi.useRealTimers()
  })
})
