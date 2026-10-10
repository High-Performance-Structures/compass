import { describe, expect, it } from "vitest"
import { compareSortValues, nextSort, sortRows } from "@/components/ui/sortable-header"

const rows = [
  { id: "a", name: "Wes Jones", amount: 1200 },
  { id: "b", name: "ann lee", amount: null },
  { id: "c", name: "Bob Ellis", amount: 90 },
  { id: "d", name: "", amount: 300 },
]
const accessors = { name: (row: (typeof rows)[number]) => row.name, amount: (row: (typeof rows)[number]) => row.amount }

describe("sortable header helpers", () => {
  it("cycles ascending, descending, then off", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", direction: "asc" })
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" })
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toBeNull()
    expect(nextSort({ key: "name", direction: "desc" }, "amount")).toEqual({ key: "amount", direction: "asc" })
  })

  it("sorts text case-insensitively and numbers numerically, blanks last both ways", () => {
    expect(sortRows(rows, { key: "name", direction: "asc" }, accessors).map((row) => row.id)).toEqual(["b", "c", "a", "d"])
    expect(sortRows(rows, { key: "amount", direction: "asc" }, accessors).map((row) => row.id)).toEqual(["c", "d", "a", "b"])
    expect(sortRows(rows, { key: "amount", direction: "desc" }, accessors).map((row) => row.id)).toEqual(["a", "d", "c", "b"])
  })

  it("keeps the original order when unsorted and compares numbers inside text naturally", () => {
    expect(sortRows(rows, null, accessors)).toBe(rows)
    expect(compareSortValues("H-430-900", "H-430-1900")).toBeLessThan(0)
  })
})
