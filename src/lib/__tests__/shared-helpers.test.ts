import { afterEach, describe, expect, it } from "vitest"

import { formatCents, formatDate, formatDateTime, formatDollars, parseDateOnly, toCents } from "@/lib/format"
import { envFlag, envString } from "@/lib/shared/env"
import { cleanText, field, finiteNumber, isRecord } from "@/lib/shared/guards"

describe("money formatting", () => {
  it("formats integer cents and dollars the same way", () => {
    expect(formatCents(123456)).toBe("$1,234.56")
    expect(formatDollars(1234.56)).toBe("$1,234.56")
    expect(formatCents(-5000)).toBe("-$50.00")
    expect(formatCents(123456, { decimals: 0 })).toBe("$1,235")
  })

  it("shows one named fallback for missing amounts", () => {
    expect(formatCents(null)).toBe("—")
    expect(formatDollars(undefined)).toBe("—")
    expect(formatCents(Number.NaN, { fallback: "Not priced" })).toBe("Not priced")
  })

  it("converts entered dollars to cents without float drift", () => {
    expect(toCents("$1,234.50")).toBe(123450)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents("abc")).toBeNull()
    expect(toCents(null)).toBeNull()
  })
})

describe("date formatting", () => {
  it("keeps date-only values on their calendar day", () => {
    const date = parseDateOnly("2026-11-01")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(10)
    expect(date?.getDate()).toBe(1)
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026")
    expect(formatDate("2026-11-01", "short")).toBe("Nov 1")
    expect(formatDate("2026-11-01", "long")).toBe("November 1, 2026")
  })

  it("rejects impossible or malformed date-only values", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull()
    expect(parseDateOnly("11/01/2026")).toBeNull()
    expect(formatDate("not a date")).toBe("—")
    expect(formatDate(null, "medium", "No date")).toBe("No date")
  })

  it("formats timestamps with a time", () => {
    expect(formatDateTime(new Date(2026, 9, 30, 21, 5))).toBe("Oct 30, 2026, 9:05 PM")
  })
})

describe("guards", () => {
  it("narrows unknown values without casts", () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([1])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(field({ a: 1 }, "a")).toBe(1)
    expect(field("x", "a")).toBeUndefined()
    expect(cleanText("  hi ")).toBe("hi")
    expect(cleanText("   ")).toBeNull()
    expect(finiteNumber("12.5")).toBe(12.5)
    expect(finiteNumber("")).toBeNull()
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe("environment values", () => {
  afterEach(() => {
    delete process.env.COMPASS_TEST_VALUE
  })

  it("prefers the Worker binding, then process.env", () => {
    process.env.COMPASS_TEST_VALUE = "from-process"
    expect(envString({ COMPASS_TEST_VALUE: " from-worker " }, "COMPASS_TEST_VALUE")).toBe("from-worker")
    expect(envString({ COMPASS_TEST_VALUE: "" }, "COMPASS_TEST_VALUE")).toBe("from-process")
    expect(envString(undefined, "COMPASS_TEST_VALUE")).toBe("from-process")
    expect(envString({}, "COMPASS_MISSING_VALUE")).toBeNull()
  })

  it("reads flags", () => {
    expect(envFlag({ FLAG: "TRUE" }, "FLAG")).toBe(true)
    expect(envFlag({ FLAG: "0" }, "FLAG")).toBe(false)
    expect(envFlag({}, "FLAG")).toBe(false)
  })
})
