import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  projectContext: vi.fn(),
  canFeature: vi.fn(),
  applyReceivedPayment: vi.fn(),
  voidReceivedPayment: vi.fn(),
  markDrawPaidBeforeCompass: vi.fn(),
  undoDrawPaidBeforeCompass: vi.fn(),
  readProjectReceivables: vi.fn(),
  recordActivityEvent: vi.fn(),
}))
vi.mock("@/lib/server/action-context", () => ({ projectContext: mocks.projectContext }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/domain/financials/store", () => ({
  applyReceivedPayment: mocks.applyReceivedPayment,
  voidReceivedPayment: mocks.voidReceivedPayment,
  markDrawPaidBeforeCompass: mocks.markDrawPaidBeforeCompass,
  undoDrawPaidBeforeCompass: mocks.undoDrawPaidBeforeCompass,
}))
vi.mock("@/lib/domain/financials/receivables", async (original) => ({
  ...(await original<typeof import("@/lib/domain/financials/receivables")>()),
  readProjectReceivables: mocks.readProjectReceivables,
}))

import {
  getProjectReceivablePayments,
  markImportedDrawPaidBeforeCompass,
  recordReceivedPayment,
  undoImportedDrawPaidBeforeCompass,
  voidReceivedPaymentWithReason,
} from "@/app/actions/received-payments"

const denied = { success: false, error: "Permission denied: field cannot create financials" }

const input = {
  projectId: "p1",
  focus: { kind: "pay_application" as const, id: "app-1" },
  amount: "100.00",
  paymentDate: "2026-10-31",
  method: "check",
  reference: "1234",
  memo: "",
  allocations: [{ kind: "pay_application", id: "app-1", amount: "100.00" }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.projectContext.mockResolvedValue(denied)
})

describe("received payment permissions", () => {
  it("records with the financials feature's create action, refusing the demo account", async () => {
    expect(await recordReceivedPayment(input)).toEqual(denied)
    expect(mocks.projectContext).toHaveBeenCalledWith("p1", {
      scope: "organization", feature: "financials", action: "create", mutation: true,
    })
    expect(mocks.applyReceivedPayment).not.toHaveBeenCalled()
  })

  it("voids with the financials feature's update action", async () => {
    expect(await voidReceivedPaymentWithReason("p1", "pay-1", "Check returned")).toEqual(denied)
    expect(mocks.projectContext).toHaveBeenCalledWith("p1", {
      scope: "organization", feature: "financials", action: "update", mutation: true,
    })
    expect(mocks.voidReceivedPayment).not.toHaveBeenCalled()
  })

  it("reads with the financials feature's read action", async () => {
    expect(await getProjectReceivablePayments("p1")).toEqual(denied)
    expect(mocks.projectContext).toHaveBeenCalledWith("p1", {
      scope: "organization", feature: "financials", action: "read", mutation: false,
    })
  })

  it("checks the method and amount before writing anything", async () => {
    mocks.projectContext.mockResolvedValue({
      success: true,
      data: { db: {}, env: { DB: {} }, organizationId: "org-1", user: { id: "u1" }, project: { id: "p1" } },
    })
    expect(await recordReceivedPayment({ ...input, method: "barter" })).toEqual({ success: false, error: "Choose check, cash, ACH or card." })
    expect(await recordReceivedPayment({ ...input, amount: "0" })).toEqual({ success: false, error: "Enter a payment amount greater than zero." })
    expect(await recordReceivedPayment({ ...input, paymentDate: "10/31/2026" })).toEqual({
      success: false, error: "Enter the date the payment was received.",
    })
    expect(mocks.applyReceivedPayment).not.toHaveBeenCalled()
  })
})

describe("paid before Compass", () => {
  const allowed = {
    success: true,
    data: { db: {}, env: { DB: {} }, organizationId: "org-1", user: { id: "u1" }, project: { id: "p1" } },
  }
  const importedDraw = {
    kind: "pay_application", id: "imp-1", label: "Pay application 5", imported: true, paidCents: 0, prepaid: null,
  }

  it("marks and undoes with the financials feature's update action, like voiding", async () => {
    expect(await markImportedDrawPaidBeforeCompass("p1", "imp-1", "")).toEqual(denied)
    expect(await undoImportedDrawPaidBeforeCompass("p1", "imp-1", "Wrong draw")).toEqual(denied)
    for (const call of mocks.projectContext.mock.calls) {
      expect(call).toEqual(["p1", { scope: "organization", feature: "financials", action: "update", mutation: true }])
    }
    expect(mocks.markDrawPaidBeforeCompass).not.toHaveBeenCalled()
    expect(mocks.undoDrawPaidBeforeCompass).not.toHaveBeenCalled()
  })

  it("marks an imported draw with no payments, with an optional note", async () => {
    mocks.projectContext.mockResolvedValue(allowed)
    mocks.readProjectReceivables.mockResolvedValue([importedDraw])
    mocks.markDrawPaidBeforeCompass.mockResolvedValue("saved")
    expect(await markImportedDrawPaidBeforeCompass("p1", "imp-1", "  Paid by check  ")).toEqual({ success: true })
    expect(mocks.markDrawPaidBeforeCompass).toHaveBeenCalledWith({}, expect.objectContaining({
      organizationId: "org-1", projectId: "p1", applicationId: "imp-1", actorId: "u1", note: "Paid by check",
    }))
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_application_prepaid_marked" }))
  })

  it("refuses to mark a Compass draw or a draw with payments, before writing", async () => {
    mocks.projectContext.mockResolvedValue(allowed)
    mocks.readProjectReceivables.mockResolvedValue([
      { ...importedDraw, id: "app-1", imported: false },
      { ...importedDraw, id: "imp-2", paidCents: 100 },
    ])
    expect(await markImportedDrawPaidBeforeCompass("p1", "app-1", "")).toMatchObject({ success: false, error: expect.stringMatching(/Only an imported draw/) })
    expect(await markImportedDrawPaidBeforeCompass("p1", "imp-2", "")).toMatchObject({ success: false, error: expect.stringMatching(/Payments are already applied/) })
    expect(await markImportedDrawPaidBeforeCompass("p1", "missing", "")).toMatchObject({ success: false, error: expect.stringMatching(/not found/) })
    expect(mocks.markDrawPaidBeforeCompass).not.toHaveBeenCalled()
  })

  it("needs a reason to undo, and refuses while payments are applied", async () => {
    mocks.projectContext.mockResolvedValue(allowed)
    const marked = { ...importedDraw, prepaid: { markedAt: "x", markedByName: null, note: null } }
    mocks.readProjectReceivables.mockResolvedValue([marked, { ...marked, id: "imp-2", paidCents: 100 }])
    expect(await undoImportedDrawPaidBeforeCompass("p1", "imp-1", "  ")).toEqual({ success: false, error: "Say why the mark is being undone." })
    expect(await undoImportedDrawPaidBeforeCompass("p1", "imp-2", "Wrong draw")).toMatchObject({ success: false, error: expect.stringMatching(/Void them/) })
    expect(mocks.undoDrawPaidBeforeCompass).not.toHaveBeenCalled()
    mocks.undoDrawPaidBeforeCompass.mockResolvedValue("saved")
    expect(await undoImportedDrawPaidBeforeCompass("p1", "imp-1", "Wrong draw")).toEqual({ success: true })
    expect(mocks.undoDrawPaidBeforeCompass).toHaveBeenCalledWith({}, expect.objectContaining({ applicationId: "imp-1", reason: "Wrong draw" }))
  })
})
