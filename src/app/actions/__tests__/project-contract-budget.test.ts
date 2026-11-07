import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  projectContext: vi.fn(),
  rebuildProjectContractBudget: vi.fn(),
  moveDraftPayApplicationsToRevision: vi.fn(),
}))
vi.mock("@/lib/server/action-context", () => ({ projectContext: mocks.projectContext }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/financials/contract-budget-store", () => ({
  rebuildProjectContractBudget: mocks.rebuildProjectContractBudget,
}))
vi.mock("@/lib/financials/owner-pay-application-refresh", () => ({
  moveDraftPayApplicationsToRevision: mocks.moveDraftPayApplicationsToRevision,
}))

import { refreshProjectContractBudget } from "@/app/actions/project-contract-budget"

const db = { name: "db" }

function signedIn(role: string): void {
  mocks.projectContext.mockResolvedValue({ success: true, data: { db, user: { id: "u1", role } } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("refreshProjectContractBudget", () => {
  it("requires the budget feature's update action and refuses the demo account", async () => {
    const denied = { success: false, error: "Permission denied: field cannot update budget" }
    mocks.projectContext.mockResolvedValue(denied)
    expect(await refreshProjectContractBudget("p1")).toEqual(denied)
    expect(mocks.projectContext).toHaveBeenCalledWith("p1", {
      scope: "organization", feature: "budget", action: "update", mutation: true,
    })
    expect(mocks.rebuildProjectContractBudget).not.toHaveBeenCalled()
  })

  it("is office staff only", async () => {
    signedIn("client")
    const result = await refreshProjectContractBudget("p1")
    expect(result.success).toBe(false)
    expect(mocks.rebuildProjectContractBudget).not.toHaveBeenCalled()
  })

  it("rebuilds from the estimate and change orders; a new revision moves drafts itself", async () => {
    signedIn("admin")
    mocks.rebuildProjectContractBudget.mockResolvedValue({ success: true, revisionId: "rev-4", revisionNumber: 4, changed: true })
    expect(await refreshProjectContractBudget("p1")).toEqual({ success: true, revisionNumber: 4, changed: true })
    expect(mocks.rebuildProjectContractBudget).toHaveBeenCalledWith({ db, projectId: "p1", actorUserId: "u1" })
    expect(mocks.moveDraftPayApplicationsToRevision).not.toHaveBeenCalled()
  })

  it("still brings drafts onto an unchanged current revision", async () => {
    signedIn("admin")
    mocks.rebuildProjectContractBudget.mockResolvedValue({ success: true, revisionId: "rev-3", revisionNumber: 3, changed: false })
    expect(await refreshProjectContractBudget("p1")).toEqual({ success: true, revisionNumber: 3, changed: false })
    expect(mocks.moveDraftPayApplicationsToRevision).toHaveBeenCalledWith(db, "p1", "rev-3", expect.any(String))
  })

  it("passes a rebuild failure through", async () => {
    signedIn("admin")
    mocks.rebuildProjectContractBudget.mockResolvedValue({ success: false, error: "Choose a signed estimate before building the contract budget." })
    expect(await refreshProjectContractBudget("p1")).toEqual({
      success: false,
      error: "Choose a signed estimate before building the contract budget.",
    })
  })
})
