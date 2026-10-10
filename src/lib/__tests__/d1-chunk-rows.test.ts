import { describe, expect, it } from "vitest"
import { chunkD1Rows } from "@/lib/d1-query"

describe("chunkD1Rows", () => {
  it("keeps every multi-row INSERT under 100 bound parameters", () => {
    // A Nu-Tech catalog product row: 17 columns, plus 2 values in its ON CONFLICT clause.
    const row = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`c${index}`, index]))
    const rows = Array.from({ length: 83 }, () => row)
    const chunks = chunkD1Rows(rows, 2)
    expect(chunks.flat()).toHaveLength(83)
    for (const chunk of chunks) expect(chunk.length * 17 + 2).toBeLessThanOrEqual(100)
  })

  it("handles empty input and very wide rows", () => {
    expect(chunkD1Rows([])).toEqual([])
    const wide = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`c${index}`, index]))
    expect(chunkD1Rows([wide, wide]).map((chunk) => chunk.length)).toEqual([1, 1])
  })
})
