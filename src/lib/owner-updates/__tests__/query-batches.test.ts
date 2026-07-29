import { describe, expect, it } from "vitest"

import { ownerUpdateIdBatches } from "@/lib/owner-updates/query-batches"

describe("ownerUpdateIdBatches", () => {
  it("keeps large owner-update selections within safe D1 query sizes", () => {
    const ids = Array.from({ length: 121 }, (_, index) => `photo-${index}`)

    const batches = ownerUpdateIdBatches(ids)

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 21])
    expect(batches.flat()).toEqual(ids)
  })

  it("returns no batches for an empty selection", () => {
    expect(ownerUpdateIdBatches([])).toEqual([])
  })
})
