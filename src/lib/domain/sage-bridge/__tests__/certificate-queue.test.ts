import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { queueVendorCertificateSyncs } from "@/lib/domain/sage-bridge/store"

/** A D1 stand-in that counts each statement's bound parameters. */
function countingD1(): { readonly database: D1Database; readonly bindCounts: number[] } {
  const bindCounts: number[] = []
  const result = { success: true, results: [], meta: {} }
  const statement = (binds: readonly unknown[]) => {
    bindCounts.push(binds.length)
    return { run: async () => result, all: async () => result, raw: async () => [], first: async () => null }
  }
  const fake = { prepare: () => ({ bind: (...binds: unknown[]) => statement(binds), ...statement([]) }) }
  // @ts-expect-error The test double implements only what Drizzle's insert uses.
  const database: D1Database = fake
  return { database, bindCounts }
}

describe("queueVendorCertificateSyncs", () => {
  it("keeps every insert under D1's 100-parameter limit when a whole company is queued", async () => {
    const { database, bindCounts } = countingD1()
    const vendorIds = Array.from({ length: 513 }, (_, index) => `vendor-${index}`)
    await queueVendorCertificateSyncs(getDb(database), "org-1", vendorIds, "2026-11-02T00:00:00.000Z")
    const inserts = bindCounts.filter((count) => count > 0)
    expect(inserts.length).toBeGreaterThan(1)
    expect(Math.max(...inserts)).toBeLessThanOrEqual(100)
  })
})
