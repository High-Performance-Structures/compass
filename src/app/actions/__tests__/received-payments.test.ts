import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  projectContext: vi.fn(),
  canFeature: vi.fn(),
  applyReceivedPayment: vi.fn(),
  voidReceivedPayment: vi.fn(),
  recordActivityEvent: vi.fn(),
}))
vi.mock("@/lib/server/action-context", () => ({ projectContext: mocks.projectContext }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/domain/financials/store", () => ({
  applyReceivedPayment: mocks.applyReceivedPayment,
  voidReceivedPayment: mocks.voidReceivedPayment,
}))

import {
  getProjectReceivablePayments,
  recordReceivedPayment,
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
