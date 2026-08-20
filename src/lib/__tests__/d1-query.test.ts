import { describe, expect, it } from "vitest"

import { chunkD1Values } from "@/lib/d1-query"

describe("chunkD1Values", () => {
  it("keeps a 110-value query below D1's parameter limit", () => {
    const chunks = chunkD1Values(
      Array.from({ length: 110 }, (_value, index) => `event-${index}`),
    )

    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50, 10])
    expect(chunks.flat()).toHaveLength(110)
  })

  it("does not create a query chunk for an empty collection", () => {
    expect(chunkD1Values([])).toEqual([])
  })
})
