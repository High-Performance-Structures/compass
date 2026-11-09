import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveHelpGuideAccess: vi.fn(),
  getProjectAudienceRequestScope: vi.fn(),
  resolveProjectAudienceViewer: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/help/server-access", () => ({
  getEffectiveHelpGuideAccess: mocks.getEffectiveHelpGuideAccess,
}))
vi.mock("@/lib/project-audience-viewer", () => ({
  getProjectAudienceRequestScope: mocks.getProjectAudienceRequestScope,
  resolveProjectAudienceViewer: mocks.resolveProjectAudienceViewer,
}))

import { GET } from "../route"
import { getHelpGuides } from "@/lib/help"

const [FIRST, SECOND] = getHelpGuides()
const staff = { id: "staff-1", role: "admin" }
const owner = { id: "owner-1", role: "client" }

async function guideIds(): Promise<readonly string[]> {
  const response = await GET()
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  const body: { guides: ReadonlyArray<{ id: string; content: string }> } = await response.json()
  for (const guide of body.guides) expect(guide.content.length).toBeGreaterThan(0)
  return body.guides.map((guide) => guide.id)
}

afterEach(() => vi.clearAllMocks())

describe("help guides route", () => {
  it("returns full text only for the guides the viewer may read", async () => {
    mocks.getProjectAudienceRequestScope.mockResolvedValue(null)
    mocks.getCurrentUser.mockResolvedValue(staff)
    mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
      canViewHelp: true,
      allowedGuideIds: [SECOND.id],
    })

    expect(await guideIds()).toEqual([SECOND.id])
    expect(mocks.getEffectiveHelpGuideAccess).toHaveBeenCalledWith(staff)
  })

  it("returns nothing when Help is off for the viewer", async () => {
    mocks.getProjectAudienceRequestScope.mockResolvedValue(null)
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
      canViewHelp: false,
      allowedGuideIds: [],
    })

    expect(await guideIds()).toEqual([])
  })

  it("filters for the previewed person inside an owner preview", async () => {
    mocks.getProjectAudienceRequestScope.mockResolvedValue({
      projectId: "project-1",
      audience: "owner",
      targetUserId: owner.id,
    })
    mocks.resolveProjectAudienceViewer.mockResolvedValue({ viewer: owner, isPreview: true })
    mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
      canViewHelp: true,
      allowedGuideIds: [FIRST.id],
    })

    expect(await guideIds()).toEqual([FIRST.id])
    expect(mocks.getEffectiveHelpGuideAccess).toHaveBeenCalledWith(owner)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it("shows no guides when a preview has no person selected", async () => {
    mocks.getProjectAudienceRequestScope.mockResolvedValue({
      projectId: "project-1",
      audience: "owner",
      targetUserId: null,
    })
    mocks.resolveProjectAudienceViewer.mockResolvedValue({ viewer: null, isPreview: true })
    mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
      canViewHelp: false,
      allowedGuideIds: [],
    })

    expect(await guideIds()).toEqual([])
    expect(mocks.getEffectiveHelpGuideAccess).toHaveBeenCalledWith(null)
  })

  it("treats an invalid preview scope as no viewer", async () => {
    mocks.getProjectAudienceRequestScope.mockRejectedValue(new Error("Project not found."))
    mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
      canViewHelp: false,
      allowedGuideIds: [],
    })

    expect(await guideIds()).toEqual([])
    expect(mocks.getEffectiveHelpGuideAccess).toHaveBeenCalledWith(null)
  })
})
