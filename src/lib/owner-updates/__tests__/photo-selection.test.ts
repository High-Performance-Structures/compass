import { describe, expect, it } from "vitest"

import { retainSelectedAndScopedRows } from "@/lib/owner-updates/photo-selection"

describe("owner update photo selection", () => {
  it("keeps the project photo order stable after photos are selected", () => {
    const rows = [
      { id: "photo-1", inPeriod: true },
      { id: "photo-2", inPeriod: false },
      { id: "photo-3", inPeriod: true },
    ]

    expect(
      retainSelectedAndScopedRows(
        rows,
        ["photo-2", "photo-3"],
        (row) => row.inPeriod,
      ).map((row) => row.id),
    ).toEqual(["photo-1", "photo-2", "photo-3"])
  })

  it("does not truncate large photo selections", () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      id: `photo-${index + 1}`,
      inPeriod: true,
    }))

    expect(
      retainSelectedAndScopedRows(rows, [], (row) => row.inPeriod),
    ).toHaveLength(150)
  })
})
