import { describe, expect, it } from "vitest"

import {
  hasOnlySageContactFields,
  readbackConfirmsChanges,
  readbackConfirmsCreateFields,
  sageContactCreateResultSchema,
  sageContactCreationEnabled,
  sageContactIdentityError,
  sageContactReadResultSchema,
} from "@/lib/sage/contact-bridge"
import type { SageContactFieldChange } from "@/lib/sage/contact-change-proposal"

describe("Sage contact bridge contract", () => {
  it("keeps child creation off until both independent server switches are enabled", () => {
    expect(sageContactCreationEnabled({})).toBe(false)
    expect(sageContactCreationEnabled({ SAGE_CONTACT_WRITES_ENABLED: "true" })).toBe(false)
    expect(sageContactCreationEnabled({ SAGE_CONTACT_CREATES_ENABLED: "true" })).toBe(false)
    expect(sageContactCreationEnabled({ SAGE_CONTACT_WRITES_ENABLED: "true", SAGE_CONTACT_CREATES_ENABLED: "true" })).toBe(true)
  })

  it("never promotes a number-only candidate from an unreviewed readback", () => {
    expect(sageContactIdentityError({
      sageRecordId: null, sageRecordNumber: "2890",
      parentSageRecordId: null, linkedUserId: null,
    }, {
      sageRecordId: "sage-guid-1", sageRecordNumber: "2890", parentSageRecordId: null,
    })).toBe("Review and link the stable Sage record ID before synchronizing this contact.")
  })

  it("checks both stable ID and number for a reviewed link", () => {
    const identity = {
      sageRecordId: "sage-guid-1", sageRecordNumber: "2890",
      parentSageRecordId: null, linkedUserId: null,
    }
    expect(sageContactIdentityError(identity, {
      sageRecordId: "sage-guid-1", sageRecordNumber: "2890", parentSageRecordId: null,
    })).toBeNull()
    expect(sageContactIdentityError(identity, {
      sageRecordId: "sage-guid-1", sageRecordNumber: "2891", parentSageRecordId: null,
    })).toBe("Sage record number does not match the directory link.")
  })

  it("allows verified vendor primary email but rejects unverified client primary email", () => {
    expect(hasOnlySageContactFields("vendor_company", { primaryEmail: "a@example.com" })).toBe(true)
    expect(hasOnlySageContactFields("client_company", { primaryEmail: "a@example.com" })).toBe(false)
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

  it("requires all approved Add fields in the exact Sage read-back", () => {
    const fields = { name: "Alex Doe", title: null, phone: "5550100",
      phoneExtension: null, email: "alex@example.com", cellPhone: null }
    expect(readbackConfirmsCreateFields(fields, fields)).toBe(true)
    expect(readbackConfirmsCreateFields(fields, { ...fields, email: "different@example.com" })).toBe(false)
    expect(sageContactCreateResultSchema.safeParse({
      outcome: "failed", id: crypto.randomUUID(), claimToken: crypto.randomUUID(),
      error: "No Add attempted", attempted: false,
    }).success).toBe(true)
    expect(sageContactCreateResultSchema.safeParse({
      outcome: "failed", id: crypto.randomUUID(), claimToken: crypto.randomUUID(),
      error: "Uncertain result",
    }).success).toBe(false)
  })
})
