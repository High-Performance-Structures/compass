import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getSageContactEntityIdentity: vi.fn(),
  getSageContactBridgeSecret: vi.fn(),
  requireAuth: vi.fn(),
  requireFeaturePermission: vi.fn(),
  requireOrg: vi.fn(),
  revalidatePath: vi.fn(),
  isDemoUser: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/sage/contact-entity", () => ({ getSageContactEntityIdentity: mocks.getSageContactEntityIdentity }))
vi.mock("@/lib/sage/bridge-auth", () => ({ getSageContactBridgeSecret: mocks.getSageContactBridgeSecret }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: mocks.requireFeaturePermission }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: mocks.requireOrg }))
vi.mock("@/lib/demo", () => ({ isDemoUser: mocks.isDemoUser }))

import { requestSageContactLinkCandidate } from "@/app/actions/sage-contact-links"

const snapshot = JSON.stringify({
  kind: "employee", entityId: "contact-1", sageRecordId: "sage-guid-17",
  sageRecordNumber: "17", parentSageRecordId: null, identityName: "Avery Felts",
  revision: "revision-1", fields: {},
})

function active(status: string, completedAt: string | null, candidateSnapshotJson: string | null = snapshot) {
  return {
    id: "read-1", kind: "employee", entityId: "contact-1", status,
    sageRecordNumber: "17", parentSageRecordId: null, completedAt,
    candidateSnapshotJson,
  }
}

describe("Sage link lookup idempotency", () => {
  const select = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
  const db = { select: vi.fn(), batch: vi.fn() }
  const prepared = { bind: vi.fn() }
  const rawDb = { prepare: vi.fn(), batch: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    select.get.mockReset()
    db.batch.mockReset()
    rawDb.batch.mockReset()
    rawDb.prepare.mockReset()
    select.from.mockReturnValue(select)
    select.where.mockReturnValue(select)
    db.select.mockReturnValue(select)
    mocks.getDb.mockReturnValue(db)
    mocks.requireAuth.mockResolvedValue({ id: "user-1", organizationId: "org-1", isActive: true })
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.isDemoUser.mockReturnValue(false)
    mocks.getSageContactBridgeSecret.mockReturnValue("test-secret")
    mocks.getCloudflareContext.mockResolvedValue({ env: {
      DB: rawDb, SAGE_CONTACT_ORGANIZATION_ID: "org-1",
    } })
    mocks.getSageContactEntityIdentity.mockResolvedValue({
      sageRecordId: null, sageRecordNumber: "17", parentSageRecordId: null, linkedUserId: null,
    })
    prepared.bind.mockReturnValue(prepared)
    rawDb.prepare.mockReturnValue(prepared)
    rawDb.batch.mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }])
  })

  it("returns an existing queued request instead of violating the unique index", async () => {
    select.get.mockResolvedValue(active("queued", null, null))

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toEqual({ success: true, id: "read-1", status: "queued", disposition: "existing" })
    expect(db.batch).not.toHaveBeenCalled()
    expect(rawDb.batch).not.toHaveBeenCalled()
  })

  it("keeps a fresh read-back available for review without another Sage poll", async () => {
    select.get.mockResolvedValue(active("awaiting_review", new Date().toISOString()))

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toEqual({ success: true, id: "read-1", status: "awaiting_review", disposition: "existing" })
    expect(rawDb.batch).not.toHaveBeenCalled()
  })

  it("requeues a stale read-back with an audit event and keeps the same request", async () => {
    select.get.mockResolvedValue(active("awaiting_review", "2026-01-01T00:00:00.000Z"))

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toEqual({ success: true, id: "read-1", status: "queued", disposition: "refreshed" })
    expect(rawDb.batch).toHaveBeenCalledTimes(1)
    expect(rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("candidate_snapshot_json = NULL"))
    expect(rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("'refreshed'"))
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("requeues an employee read-back with a missing Sage name", async () => {
    const missingName = snapshot.replace('"Avery Felts"', "null")
    select.get.mockResolvedValue(active("awaiting_review", new Date().toISOString(), missingName))

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toMatchObject({ success: true, status: "queued", disposition: "refreshed" })
  })

  it("requires resolving an active lookup before switching Sage numbers", async () => {
    select.get.mockResolvedValue({ ...active("awaiting_review", new Date().toISOString()), sageRecordNumber: "18" })

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toMatchObject({ success: false, error: expect.stringContaining("Another Sage number") })
    expect(rawDb.batch).not.toHaveBeenCalled()
  })

  it("recovers when a concurrent insert wins the unique index", async () => {
    select.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce(active("queued", null, null))
    db.batch.mockRejectedValue(new Error("UNIQUE constraint failed"))

    expect(await requestSageContactLinkCandidate("employee", "contact-1", "17"))
      .toEqual({ success: true, id: "read-1", status: "queued", disposition: "existing" })
  })
})
