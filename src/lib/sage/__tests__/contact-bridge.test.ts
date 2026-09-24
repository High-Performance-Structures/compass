import { describe, expect, it } from "vitest"

import {
  hasOnlySageContactFields,
  readbackConfirmsChanges,
  sageContactReadResultSchema,
} from "@/lib/sage/contact-bridge"
import type { SageContactFieldChange } from "@/lib/sage/contact-change-proposal"

describe("Sage contact bridge contract", () => {
  it("rejects a primary-email field whose Sage API mapping is unverified", () => {
    expect(hasOnlySageContactFields("vendor_company", { primaryEmail: "a@example.com" })).toBe(false)
    expect(hasOnlySageContactFields("vendor_company", { ownerName: "Jane" })).toBe(true)
  })

  it("requires exact post-write read-back values", () => {
    const changes: readonly SageContactFieldChange[] = [{ field: "phone", before: "123", after: "456" }]
    expect(readbackConfirmsChanges(changes, { phone: "456" })).toBe(true)
    expect(readbackConfirmsChanges(changes, { phone: "789" })).toBe(false)
    expect(readbackConfirmsChanges(changes, {})).toBe(false)
  })

  it("validates signed bridge result shape before ingest", () => {
    expect(sageContactReadResultSchema.safeParse({
      outcome: "succeeded",
      id: crypto.randomUUID(),
      claimToken: crypto.randomUUID(),
      snapshot: {
        kind: "client_company", entityId: "c1", sageRecordId: "s1",
        sageRecordNumber: "12", parentSageRecordId: null,
        revision: "revision", fields: { city: "Denver" },
      },
    }).success).toBe(true)
  })
})
