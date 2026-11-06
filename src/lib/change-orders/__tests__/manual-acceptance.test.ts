import { describe, expect, it } from "vitest"

import {
  acceptanceDateError,
  changeOrderAcceptanceSummary,
  isPricedChangeOrder,
  manualAcceptanceAvailability,
  validateManualAcceptance,
  type ManualAcceptanceInput,
} from "@/lib/change-orders/manual-acceptance"
import { DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS } from "@/lib/feature-settings/contract-settings"

const base = {
  status: "approved_for_owner",
  kind: "description",
  budgetTreatment: "additive",
  amountCents: 0,
  internal: true,
  canApprove: true,
  isAdmin: false,
  settings: DEFAULT_CHANGE_ORDER_ACCEPTANCE_SETTINGS,
} as const

describe("isPricedChangeOrder", () => {
  it("treats description-only and $0 change orders as unpriced", () => {
    expect(isPricedChangeOrder({ kind: "description", amountCents: 5_000 })).toBe(false)
    expect(isPricedChangeOrder({ kind: null, amountCents: 0 })).toBe(false)
    expect(isPricedChangeOrder({ kind: null, amountCents: 12_500 })).toBe(true)
    // An amount not yet set counts as priced, so it can't slip past the evidence rule.
    expect(isPricedChangeOrder({ kind: null, amountCents: null })).toBe(true)
  })
})

describe("manualAcceptanceAvailability", () => {
  it("offers both routes on a $0 change order by default", () => {
    expect(manualAcceptanceAvailability(base)).toEqual({ writtenApproval: true, staffSignOff: true, staffSignOffBlocker: null })
  })

  it("requires written approval for a priced change order by default", () => {
    const result = manualAcceptanceAvailability({ ...base, kind: null, amountCents: 125_000 })
    expect(result?.writtenApproval).toBe(true)
    expect(result?.staffSignOff).toBe(false)
    expect(result?.staffSignOffBlocker).toMatch(/written approval/)
  })

  it("follows the company setting for priced change orders and who may sign off", () => {
    const priced = { ...base, kind: null, amountCents: 125_000 }
    expect(
      manualAcceptanceAvailability({ ...priced, settings: { staffSignOff: "approvers", pricedRequiresEvidence: false } })?.staffSignOff
    ).toBe(true)
    expect(manualAcceptanceAvailability({ ...base, settings: { staffSignOff: "nobody", pricedRequiresEvidence: true } })).toMatchObject({
      writtenApproval: true,
      staffSignOff: false,
    })
    const adminsOnly = { staffSignOff: "admins", pricedRequiresEvidence: true } as const
    expect(manualAcceptanceAvailability({ ...base, settings: adminsOnly })?.staffSignOff).toBe(false)
    expect(manualAcceptanceAvailability({ ...base, isAdmin: true, settings: adminsOnly })?.staffSignOff).toBe(true)
  })

  it("is only for staff approvers on a change order that isn't executed, declined or void", () => {
    expect(manualAcceptanceAvailability({ ...base, canApprove: false })).toBeNull()
    expect(manualAcceptanceAvailability({ ...base, internal: false })).toBeNull()
    for (const status of ["executed", "sage_pending", "synced", "closed", "declined", "void"] as const) {
      expect(manualAcceptanceAvailability({ ...base, status })).toBeNull()
    }
    for (const status of ["draft", "submitted", "triage", "needs_information", "pricing", "internal_review", "signature_pending"] as const) {
      expect(manualAcceptanceAvailability({ ...base, status })).not.toBeNull()
    }
  })

  it("leaves estimate-priced change orders and baseline replacements to their own acceptance", () => {
    expect(manualAcceptanceAvailability({ ...base, kind: "estimate", amountCents: null })).toBeNull()
    expect(manualAcceptanceAvailability({ ...base, kind: "replacement" })).toBeNull()
    expect(manualAcceptanceAvailability({ ...base, kind: null, budgetTreatment: "baseline_replacement" })).toBeNull()
  })
})

describe("acceptanceDateError", () => {
  it("accepts today and past dates and rejects future or invalid dates", () => {
    expect(acceptanceDateError("2026-03-10", "2026-03-10")).toBeNull()
    expect(acceptanceDateError("2026-03-01", "2026-03-10")).toBeNull()
    expect(acceptanceDateError("2026-03-11", "2026-03-10")).toMatch(/future/)
    expect(acceptanceDateError("2026-02-30", "2026-03-10")).toMatch(/date/)
    expect(acceptanceDateError("", "2026-03-10")).toMatch(/date/)
  })
})

describe("validateManualAcceptance", () => {
  const signOff: ManualAcceptanceInput = {
    method: "staff_signoff",
    acceptedByContactId: null,
    acceptedByName: "Pat Example",
    acceptedOn: "2026-03-09",
    note: "Approved on site during the walkthrough.",
    confirmed: true,
    evidence: null,
  }

  it("requires the confirmation tick and a note for a staff sign-off", () => {
    expect(validateManualAcceptance(signOff, "2026-03-10")).toMatchObject({ success: true, value: { method: "staff_signoff" } })
    expect(validateManualAcceptance({ ...signOff, confirmed: false }, "2026-03-10")).toMatchObject({ success: false })
    expect(validateManualAcceptance({ ...signOff, note: "  " }, "2026-03-10")).toEqual({
      success: false,
      error: "Add a note saying how the owner approved.",
    })
  })

  it("requires the evidence for written approval and an approver for either route", () => {
    const written = { ...signOff, method: "written_approval", note: null, confirmed: false }
    expect(validateManualAcceptance(written, "2026-03-10")).toMatchObject({ success: false })
    expect(
      validateManualAcceptance({ ...written, evidence: { url: "https://drive.google.com/open?id=abc123", label: "Approval.pdf" } }, "2026-03-10")
    ).toMatchObject({ success: true, value: { method: "written_approval", evidence: { label: "Approval.pdf" } } })
    expect(validateManualAcceptance({ ...signOff, acceptedByName: null }, "2026-03-10")).toEqual({
      success: false,
      error: "Choose who approved the change order.",
    })
    expect(validateManualAcceptance({ ...signOff, method: "owner_workspace" }, "2026-03-10")).toMatchObject({ success: false })
    expect(validateManualAcceptance({ ...signOff, acceptedOn: "2026-03-11" }, "2026-03-10")).toMatchObject({ success: false })
  })
})

describe("changeOrderAcceptanceSummary", () => {
  it("names the approver, the date and how it was recorded", () => {
    expect(
      changeOrderAcceptanceSummary({ method: "staff_signoff", acceptedByName: "Pat Example", acceptedOn: "2026-03-09", recordedByName: "Sam Staff" })
    ).toBe("Accepted by Pat Example on Mar 9, 2026 (staff sign-off by Sam Staff)")
    expect(
      changeOrderAcceptanceSummary({ method: "written_approval", acceptedByName: "Pat Example", acceptedOn: "2026-03-09", recordedByName: "Sam Staff" })
    ).toBe("Accepted by Pat Example on Mar 9, 2026 (written approval)")
  })
})
