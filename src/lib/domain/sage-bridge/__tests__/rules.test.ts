import { describe, expect, it } from "vitest"

import { SAGE_BRIDGE_NONCE_RETENTION_MS, sageBridgeBatchLimit, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { formatCents } from "@/lib/format"

describe("Square receipt reminder amounts", () => {
  it("formatCents renders the same text as the reminder's former local formatter", () => {
    const previous = (cents: number): string =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
    for (const cents of [0, 1, 99, 100, 12345, 123456789, -2500, 1000005]) {
      expect(formatCents(cents)).toBe(previous(cents))
    }
  })
})

describe("sageBridgeBatchLimit", () => {
  it("uses the fallback when no limit was asked for", () => {
    expect(sageBridgeBatchLimit(null, 5, 10)).toBe(5)
    expect(sageBridgeBatchLimit(null, 10, 20)).toBe(10)
  })

  it("clamps the requested limit to 1..max", () => {
    expect(sageBridgeBatchLimit("0", 5, 10)).toBe(1)
    expect(sageBridgeBatchLimit("-4", 5, 10)).toBe(1)
    expect(sageBridgeBatchLimit("7", 5, 10)).toBe(7)
    expect(sageBridgeBatchLimit("99", 5, 10)).toBe(10)
  })

  it("falls back for a non-integer limit", () => {
    expect(sageBridgeBatchLimit("2.5", 5, 10)).toBe(5)
    expect(sageBridgeBatchLimit("abc", 10, 20)).toBe(10)
  })

  it("matches the routes' previous inline expression", () => {
    for (const requested of [null, "", " ", "1", "3", "10", "11", "1e1", "0x10", "-0", "NaN", "Infinity"]) {
      for (const [fallback, max] of [[5, 10], [10, 20]] as const) {
        // The inline expression every bridge route used before.
        const before = Number(requested ?? String(fallback))
        const inline = Number.isInteger(before) ? Math.min(max, Math.max(1, before)) : fallback
        expect(sageBridgeBatchLimit(requested, fallback, max)).toBe(inline)
      }
    }
  })
})

describe("sageBridgeCutoff", () => {
  it("returns the ISO time the given milliseconds before now", () => {
    const now = new Date("2026-10-31T08:00:00.000Z")
    expect(sageBridgeCutoff(now, SAGE_BRIDGE_NONCE_RETENTION_MS)).toBe("2026-10-31T07:45:00.000Z")
    expect(sageBridgeCutoff(now, 5 * 60 * 1000)).toBe("2026-10-31T07:55:00.000Z")
  })
})
