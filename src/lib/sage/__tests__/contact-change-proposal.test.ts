import { describe, expect, it } from "vitest"

import {
  isPrivateEmployeeContactField,
  isSageContactProposalCurrent,
  planSageContactChange,
  sageContactProposalFields,
  type SageContactSnapshot,
} from "@/lib/sage/contact-change-proposal"

const vendorPerson: SageContactSnapshot = {
  organizationId: "org-1",
  kind: "vendor_person",
  sageRecordId: "contact-17",
  parentSageRecordId: "vendor-4",
  revision: "sage-revision-1",
  fields: { name: "Alex Doe", email: "old@example.com", phone: null },
}

describe("reviewed Sage contact change planning", () => {
  it("produces a deterministic field-level diff without writing anything", () => {
    const result = planSageContactChange({
      snapshot: vendorPerson,
      proposed: { phone: " 555-0100 ", email: "new@example.com" },
    })
    expect(result).toEqual({
      success: true,
      plan: {
        organizationId: "org-1",
        kind: "vendor_person",
        sageRecordId: "contact-17",
        parentSageRecordId: "vendor-4",
        baseRevision: "sage-revision-1",
        changes: [
          { field: "email", before: "old@example.com", after: "new@example.com" },
          { field: "phone", before: null, after: "555-0100" },
        ],
      },
    })
  })

  it("requires an exact Sage person and parent identity", () => {
    expect(planSageContactChange({
      snapshot: { ...vendorPerson, parentSageRecordId: null },
      proposed: { phone: "555-0100" },
    })).toMatchObject({ success: false, error: expect.stringContaining("parent") })
    expect(planSageContactChange({
      snapshot: { ...vendorPerson, sageRecordId: "" },
      proposed: { phone: "555-0100" },
    })).toMatchObject({ success: false, error: expect.stringContaining("identity") })
  })

  it("fails closed on unverified or unobserved fields", () => {
    expect(sageContactProposalFields("vendor_company")).not.toContain("email")
    expect(planSageContactChange({
      snapshot: { ...vendorPerson, kind: "vendor_company" },
      proposed: { email: "new@example.com" },
    })).toMatchObject({ success: false, error: expect.stringContaining("not approved") })
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { addressLine1: "123 Main St" },
    })).toMatchObject({ success: false })
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { cellPhone: "555-0101" },
    })).toMatchObject({ success: false, error: expect.stringContaining("No Sage read value") })
  })

  it("does not make a proposal for a no-op or invalid name", () => {
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { email: " old@example.com " },
    })).toMatchObject({ success: false, error: expect.stringContaining("no changed fields") })
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { name: " " },
    })).toMatchObject({ success: false, error: expect.stringContaining("cannot be cleared") })
  })

  it("enforces installed Sage API field lengths before review", () => {
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { name: "x".repeat(51) },
    })).toMatchObject({ success: false, error: expect.stringContaining("Sage field limit") })
    expect(planSageContactChange({
      snapshot: vendorPerson,
      proposed: { email: "a".repeat(76) },
    })).toMatchObject({ success: false, error: expect.stringContaining("Sage field limit") })
  })

  it("rejects a stale or differently scoped Sage read before review", () => {
    const result = planSageContactChange({
      snapshot: vendorPerson,
      proposed: { phone: "555-0100" },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(isSageContactProposalCurrent(result.plan, vendorPerson)).toBe(true)
    expect(isSageContactProposalCurrent(result.plan, {
      ...vendorPerson, revision: "sage-revision-2",
    })).toBe(false)
    expect(isSageContactProposalCurrent(result.plan, {
      ...vendorPerson, organizationId: "other-org",
    })).toBe(false)
    expect(isSageContactProposalCurrent(result.plan, {
      ...vendorPerson, parentSageRecordId: "other-vendor",
    })).toBe(false)
  })

  it("classifies employee home-address fields as confidential", () => {
    for (const field of ["addressLine1", "addressLine2", "city", "state", "postalCode"] as const) {
      expect(isPrivateEmployeeContactField(field)).toBe(true)
    }
    expect(isPrivateEmployeeContactField("email")).toBe(false)
  })
})
