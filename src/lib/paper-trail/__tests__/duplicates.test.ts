import { describe, expect, it } from "vitest"
import { findExistingCopy, nameMatchesKeys, recordNumberKeys } from "@/lib/paper-trail/duplicates"

describe("spotting hand-saved copies", () => {
  it("matches record numbers whole, with any separators", () => {
    expect(nameMatchesKeys("PO O-170-0006 lumber.pdf", ["O-170-0006"])).toBe(true)
    expect(nameMatchesKeys("O 170 0006.pdf", ["O-170-0006"])).toBe(true)
    expect(nameMatchesKeys("PO O-170-00061.pdf", ["O-170-0006"])).toBe(false)
    expect(nameMatchesKeys("CO-20 signed.pdf", ["CO-20"])).toBe(true)
    expect(nameMatchesKeys("CO-200.pdf", ["CO-20"])).toBe(false)
    expect(nameMatchesKeys("RFI O-138-869-0017 answer.pdf", ["O-138-869 - 0017"])).toBe(true)
    expect(nameMatchesKeys("Shop Ticket GSL-176.pdf", ["GSL-176"])).toBe(true)
  })

  it("only matches bare numbers together with the record's label", () => {
    expect(recordNumberKeys("#3", ["CO", "Change Order"])).toEqual(["CO 3", "Change Order 3"])
    expect(nameMatchesKeys("Change Order #3 - deck.pdf", recordNumberKeys("#3", ["CO", "Change Order"]))).toBe(true)
    expect(nameMatchesKeys("Invoice 3.pdf", recordNumberKeys("3", ["CO", "Change Order"]))).toBe(false)
    expect(recordNumberKeys("", ["PO"])).toEqual([])
  })

  it("ignores files Compass wrote itself", () => {
    const files = [
      { id: "ours", name: "PO O-170-0006 - Lumber.pdf" },
      { id: "staff", name: "O-170-0006 signed.pdf" },
    ]
    expect(findExistingCopy(files, ["O-170-0006"], new Set(["ours"]))?.id).toBe("staff")
    expect(findExistingCopy(files, ["O-170-0006"], new Set(["ours", "staff"]))).toBeNull()
  })
})
