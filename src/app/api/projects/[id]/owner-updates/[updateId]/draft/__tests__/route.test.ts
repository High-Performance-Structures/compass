import { beforeEach, describe, expect, it, vi } from "vitest"

type PersistInput = {
  readonly intent: "save" | "publish"
  readonly save: () => Promise<{
    readonly success: true
    readonly revision: number
    readonly updatedAt: string
  }>
  readonly publish: (version: {
    readonly revision: number
    readonly updatedAt: string
  }) => Promise<{
    readonly success: true
    readonly revision: number
    readonly updatedAt: string
  }>
}

const mocks = {
  requireAuth: vi.fn(),
  assertOwnerUpdateRouteAccess: vi.fn(),
  resolveProjectRouteId: vi.fn(),
  persistOwnerUpdateDraft: vi.fn(),
  publishOwnerProjectUpdate: vi.fn(),
  updateOwnerProjectUpdateDraft: vi.fn(),
}

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/owner-updates/access", () => ({
  assertOwnerUpdateRouteAccess: mocks.assertOwnerUpdateRouteAccess,
}))
vi.mock("@/lib/project-route-id", () => ({
  resolveProjectRouteId: mocks.resolveProjectRouteId,
}))
vi.mock("@/app/actions/project-field", () => ({
  publishOwnerProjectUpdate: mocks.publishOwnerProjectUpdate,
  updateOwnerProjectUpdateDraft: mocks.updateOwnerProjectUpdateDraft,
}))
vi.mock("@/lib/owner-updates/draft-publish", () => ({
  persistOwnerUpdateDraft: mocks.persistOwnerUpdateDraft,
}))

const { PUT } = await import("../route")

const legacyDraft = {
  title: "Weekly update",
  updateDate: "2026-07-28",
  summary: "Drywall is moving forward.",
  sourceDailyLogIds: ["log-1"],
  selectedPhotoIds: ["photo-1"],
}

const versionedLegacyDraft = {
  ...legacyDraft,
  expectedRevision: 0,
  expectedUpdatedAt: "2026-07-28T14:20:14.659Z",
}

describe("PUT /api/projects/[id]/owner-updates/[updateId]/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({ id: "user-1" })
    mocks.assertOwnerUpdateRouteAccess.mockResolvedValue(undefined)
    mocks.resolveProjectRouteId.mockResolvedValue("project-1")
    mocks.updateOwnerProjectUpdateDraft.mockResolvedValue({
      success: true,
      revision: 1,
      updatedAt: "2026-07-28T14:30:00.000Z",
    })
    mocks.publishOwnerProjectUpdate.mockResolvedValue({
      success: true,
      revision: 2,
      updatedAt: "2026-07-28T14:31:00.000Z",
    })
    mocks.persistOwnerUpdateDraft.mockImplementation(
      async (input: PersistInput) => {
        const saved = await input.save()
        if (!saved.success || input.intent === "save") return saved
        return input.publish({
          revision: saved.revision,
          updatedAt: saved.updatedAt,
        })
      }
    )
  })

  it("authenticates before reading a malformed request body", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("Not signed in"))
    const request = new Request(
      "https://compass.example/api/projects/project-1/owner-updates/update-1/draft",
      { method: "PUT", body: "not-json" }
    )
    const json = vi.spyOn(request, "json")

    const response = await PUT(request, {
      params: Promise.resolve({ id: "project-1", updateId: "update-1" }),
    })

    expect(response.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
  })

  it("denies an external caller before resolving a project alias", async () => {
    mocks.assertOwnerUpdateRouteAccess.mockRejectedValue(
      new Error("Permission denied: internal staff access is required")
    )

    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/legacy-project/owner-updates/update-1/draft",
        { method: "PUT", body: JSON.stringify(versionedLegacyDraft) }
      ),
      { params: Promise.resolve({ id: "legacy-project", updateId: "update-1" }) }
    )

    expect(response.status).toBe(403)
    expect(mocks.assertOwnerUpdateRouteAccess).toHaveBeenCalledWith({ id: "user-1" })
    expect(mocks.resolveProjectRouteId).not.toHaveBeenCalled()
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
  })

  it("denies an inactive internal organization before resolving a project alias", async () => {
    mocks.assertOwnerUpdateRouteAccess.mockRejectedValue(
      new Error("Permission denied: active internal organization is required")
    )

    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/legacy-project/owner-updates/update-1/draft",
        { method: "PUT", body: JSON.stringify(versionedLegacyDraft) }
      ),
      { params: Promise.resolve({ id: "legacy-project", updateId: "update-1" }) }
    )

    expect(response.status).toBe(403)
    expect(mocks.resolveProjectRouteId).not.toHaveBeenCalled()
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
  })

  it("accepts a legacy save and forwards safe defaults to the action", async () => {
    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/project-1/owner-updates/update-1/draft",
        { method: "PUT", body: JSON.stringify(versionedLegacyDraft) }
      ),
      { params: Promise.resolve({ id: "project-1", updateId: "update-1" }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.updateOwnerProjectUpdateDraft).toHaveBeenCalledWith(
      "project-1",
      "update-1",
      {
        ...legacyDraft,
        periodStart: "2026-07-28",
        periodEnd: "2026-07-28",
        selectedDocumentIds: [],
        completedScheduleItems: [],
        lookAheadScheduleItems: [],
        todos: [],
        expectedRevision: 0,
        expectedUpdatedAt: "2026-07-28T14:20:14.659Z",
      }
    )
  })

  it("saves before publishing when the publish intent is requested", async () => {
    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/project-1/owner-updates/update-1/draft?intent=publish",
        { method: "PUT", body: JSON.stringify(versionedLegacyDraft) }
      ),
      { params: Promise.resolve({ id: "project-1", updateId: "update-1" }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.publishOwnerProjectUpdate).toHaveBeenCalledWith(
      "project-1",
      "update-1",
      { revision: 1, updatedAt: "2026-07-28T14:30:00.000Z" }
    )
  })

  it("rejects a draft write without an expected server version", async () => {
    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/project-1/owner-updates/update-1/draft",
        { method: "PUT", body: JSON.stringify(legacyDraft) }
      ),
      { params: Promise.resolve({ id: "project-1", updateId: "update-1" }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
  })

  it("rejects invalid input after authentication without invoking mutations", async () => {
    const response = await PUT(
      new Request(
        "https://compass.example/api/projects/project-1/owner-updates/update-1/draft",
        { method: "PUT", body: JSON.stringify({ ...legacyDraft, sourceDailyLogIds: "log-1" }) }
      ),
      { params: Promise.resolve({ id: "project-1", updateId: "update-1" }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
    expect(mocks.updateOwnerProjectUpdateDraft).not.toHaveBeenCalled()
  })
})