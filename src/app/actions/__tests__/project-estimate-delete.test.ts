import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  recordActivityEvent: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  assertProjectAccess: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/lib/permissions", () => ({
  can: mocks.can,
  requirePermission: mocks.requirePermission,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))
vi.mock("@/lib/activity-log", () => ({
  activityActorName: vi.fn(() => "Estimator"),
  recordActivityEvent: mocks.recordActivityEvent,
}))

import { deleteProjectEstimateDraft } from "@/app/actions/project-estimates"
import { projects } from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"

const user = {
  id: "user-1",
  email: "estimator@example.com",
  displayName: "Estimator",
  firstName: "Estimate",
  lastName: "Owner",
  role: "admin",
  isActive: true,
  organizationId: "org-1",
  organizationType: "internal",
}

const project = {
  name: "Test Project",
  address: null,
  mailingAddress: null,
  clientName: null,
  organizationId: "org-1",
}

const draft = {
  id: "estimate-1",
  estimateNumber: "P-100-00",
  versionNumber: 2,
  status: "draft",
}

function configureDb(input?: {
  readonly estimateStatus?: string
  readonly linkedContractPacket?: boolean
  readonly deletedRows?: number
}): { readonly batch: ReturnType<typeof vi.fn> } {
  const select = vi.fn(() => {
    let rows: readonly unknown[] = []
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    }
    query.from.mockImplementation((table: unknown) => {
      if (table === projects) rows = [project]
      if (table === projectEstimates) {
        rows = [{ ...draft, status: input?.estimateStatus ?? draft.status }]
      }
      if (table === contractPackets) {
        rows = input?.linkedContractPacket ? [{ id: "packet-1" }] : []
      }
      return query
    })
    query.where.mockReturnValue(query)
    query.limit.mockImplementation(() => Promise.resolve(rows))
    return query
  })
  const deleteQuery = { where: vi.fn() }
  deleteQuery.where.mockReturnValue(deleteQuery)
  const batch = vi.fn().mockResolvedValue([
    { meta: { changes: 0 } },
    { meta: { changes: 0 } },
    { meta: { changes: input?.deletedRows ?? 1 } },
  ])
  mocks.getDb.mockReturnValue({
    select,
    delete: vi.fn(() => deleteQuery),
    batch,
  })
  return { batch }
}

describe("deleteProjectEstimateDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue(user)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "P-100" })
    mocks.recordActivityEvent.mockResolvedValue(undefined)
  })

  it("deletes the complete draft and records the destructive action", async () => {
    const db = configureDb()

    const result = await deleteProjectEstimateDraft("project-1", draft.id)

    expect(result).toEqual({ success: true, id: draft.id })
    expect(mocks.requirePermission).toHaveBeenCalledWith(user, "budget", "delete")
    expect(db.batch).toHaveBeenCalledOnce()
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "estimate_draft_deleted",
        entityId: draft.id,
        projectId: "project-1",
      })
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/dashboard/projects/project-1/rfqs"
    )
  })

  it("does not delete an estimate after it leaves draft status", async () => {
    const db = configureDb({ estimateStatus: "internal_review" })

    const result = await deleteProjectEstimateDraft("project-1", draft.id)

    expect(result).toEqual({
      success: false,
      error: "Only draft estimates can be deleted.",
    })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("requires a linked contract packet to be removed first", async () => {
    const db = configureDb({ linkedContractPacket: true })

    const result = await deleteProjectEstimateDraft("project-1", draft.id)

    expect(result).toEqual({
      success: false,
      error:
        "Delete the contract packet linked to this draft before deleting the estimate.",
    })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("reports when a concurrent status change prevents deletion", async () => {
    configureDb({ deletedRows: 0 })

    const result = await deleteProjectEstimateDraft("project-1", draft.id)

    expect(result).toEqual({
      success: false,
      error:
        "The estimate changed before it could be deleted. Refresh and try again.",
    })
    expect(mocks.recordActivityEvent).not.toHaveBeenCalled()
  })
})
