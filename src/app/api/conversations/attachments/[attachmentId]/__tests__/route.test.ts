import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getConversationChannelAccess: vi.fn(),
  assertProjectAccess: vi.fn(),
  decrypt: vi.fn(),
  getGoogleConfig: vi.fn(),
  parseServiceAccountKey: vi.fn(),
  getExportMimeType: vi.fn(),
  getExportExtension: vi.fn(),
  isGoogleNativeFile: vi.fn(),
  isDriveItemWithinProjectFolder: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  exportFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/conversations/channel-access", () => ({
  getConversationChannelAccess: mocks.getConversationChannelAccess,
}))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/crypto", () => ({ decrypt: mocks.decrypt }))
vi.mock("@/lib/google/config", () => ({
  getGoogleConfig: mocks.getGoogleConfig,
  getGoogleCryptoSalt: () => "salt",
  parseServiceAccountKey: mocks.parseServiceAccountKey,
}))
vi.mock("@/lib/google/mapper", () => ({
  getExportMimeType: mocks.getExportMimeType,
  getExportExtension: mocks.getExportExtension,
  isGoogleNativeFile: mocks.isGoogleNativeFile,
}))
vi.mock("@/lib/google/project-folder-boundary", () => ({
  isDriveItemWithinProjectFolder: mocks.isDriveItemWithinProjectFolder,
}))
vi.mock("@/lib/google/client/drive-client", () => ({
  DriveClient: class {
    getFile = mocks.getFile
    downloadFile = mocks.downloadFile
    exportFile = mocks.exportFile
  },
}))

import { GET } from "../route"

const activeUser = {
  id: "user-1",
  email: "member@example.com",
  role: "member",
  isActive: true,
  organizationId: "org-1",
  organizationType: "internal",
  googleEmail: null,
} as const

const projectAttachment = {
  id: "attachment-1",
  fileName: "plans.pdf",
  mimeType: "application/pdf",
  r2Path: "/api/google/download/drive-file-1",
  messageDeletedAt: null,
  channelId: "channel-1",
  channelOrganizationId: "org-1",
  projectId: "project-1",
  projectOrganizationId: "org-1",
  projectFolderId: "folder-1",
}

function query(result: unknown, whereCalls: (readonly unknown[])[]) {
  return {
    from() { return this },
    innerJoin() { return this },
    leftJoin() { return this },
    where(...args: readonly unknown[]) {
      whereCalls.push(args)
      return this
    },
    limit() { return this },
    then(resolve: (value: readonly unknown[]) => unknown) {
      return Promise.resolve(resolve(result === null ? [] : [result]))
    },
    get() { return Promise.resolve(result) },
  }
}

function setupDb(attachment: unknown, auth = {
  serviceAccountKeyEncrypted: "encrypted",
  sharedDriveId: "shared-drive-1",
  connectedByEmail: "connected@example.com",
  connectedByGoogleEmail: "drive@example.com",
}, folderLink: unknown = null) {
  let selectCount = 0
  const whereCalls: (readonly unknown[])[] = []
  const attachmentProjectId =
    attachment && typeof attachment === "object" && "projectId" in attachment
      ? attachment.projectId
      : null
  const attachmentFolderId =
    attachment && typeof attachment === "object" && "projectFolderId" in attachment
      ? attachment.projectFolderId
      : null
  const needsFolderFallback = Boolean(attachmentProjectId && !attachmentFolderId)
  mocks.getDb.mockReturnValue({
    select() {
      selectCount += 1
      if (selectCount === 1) return query(attachment, whereCalls)
      if (needsFolderFallback && selectCount === 2) return query(folderLink, whereCalls)
      return query(auth, whereCalls)
    },
  })
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
  mocks.getConversationChannelAccess.mockResolvedValue({
    id: "channel-1",
    organizationId: "org-1",
    projectId: attachment && typeof attachment === "object" && "projectId" in attachment
      ? attachment.projectId
      : null,
  })
  mocks.assertProjectAccess.mockResolvedValue({
    id: "project-1",
    organizationId: "org-1",
    projectNumber: "P-1",
  })
  mocks.decrypt.mockResolvedValue('{"type":"service_account"}')
  mocks.getGoogleConfig.mockReturnValue({ encryptionKey: "key" })
  mocks.parseServiceAccountKey.mockReturnValue({ type: "service_account" })
  mocks.isGoogleNativeFile.mockReturnValue(false)
  mocks.getFile.mockResolvedValue({
    id: "drive-file-1",
    name: "plans.pdf",
    mimeType: "application/pdf",
    trashed: false,
  })
  mocks.downloadFile.mockResolvedValue(new Response("file-bytes", { status: 200 }))
  mocks.isDriveItemWithinProjectFolder.mockResolvedValue(true)
  return { whereCalls }
}

function queryContainsValue(queryValue: unknown, expected: string): boolean {
  const seen = new WeakSet<object>()
  const serialized = JSON.stringify(queryValue, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[cycle]"
      seen.add(value)
    }
    return value
  })
  return serialized.includes(`"${expected}"`)
}

async function getAttachment(): Promise<Response> {
  return GET(
    new NextRequest("https://compass.example/api/conversations/attachments/attachment-1"),
    { params: Promise.resolve({ attachmentId: "attachment-1" }) }
  )
}

describe("GET /api/conversations/attachments/:attachmentId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue(activeUser)
    setupDb(projectAttachment)
  })

  it.each([
    ["owner", "owner"],
    ["vendor", "sub_vendor"],
    ["member", "member"],
  ])("serves a project attachment to an authorized %s", async (_label, role) => {
    mocks.getCurrentUser.mockResolvedValue({ ...activeUser, role })

    const response = await getAttachment()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("file-bytes")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getFile).toHaveBeenCalledWith("drive@example.com", "drive-file-1")
    expect(mocks.isDriveItemWithinProjectFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "drive-file-1",
        projectFolderId: "folder-1",
      })
    )
  })

  it("denies unauthenticated and inactive users before storage access", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)
    expect((await getAttachment()).status).toBe(401)

    mocks.getCurrentUser.mockResolvedValueOnce({ ...activeUser, isActive: false })
    expect((await getAttachment()).status).toBe(403)
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  it.each([
    ["missing attachment", null],
    ["deleted message", { ...projectAttachment, messageDeletedAt: "2026-09-05T00:00:00Z" }],
    ["cross-organization channel", { ...projectAttachment, channelOrganizationId: "org-2" }],
    ["cross-organization project", { ...projectAttachment, projectOrganizationId: "org-2" }],
  ])("denies %s without touching Drive", async (_label, attachment) => {
    setupDb(attachment)

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  it("denies a project member mismatch", async () => {
    mocks.assertProjectAccess.mockRejectedValue(new Error("Project not found"))

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  it("denies channel-inaccessible attachments before any Drive call", async () => {
    mocks.getConversationChannelAccess.mockResolvedValue(null)

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.assertProjectAccess).not.toHaveBeenCalled()
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("denies a project-access result from another organization before Drive", async () => {
    mocks.assertProjectAccess.mockResolvedValue({
      id: "project-1",
      organizationId: "org-2",
      projectNumber: "P-1",
    })

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("denies a project attachment when no canonical folder exists", async () => {
    const { whereCalls } = setupDb({ ...projectAttachment, projectFolderId: null })

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(whereCalls.some(([condition]) => queryContainsValue(condition, "project-1"))).toBe(true)
  })

  it("resolves the project-folder fallback with the exact project ID", async () => {
    const { whereCalls } = setupDb(
      { ...projectAttachment, projectFolderId: null },
      undefined,
      { externalId: "linked-folder-1", externalUrl: null }
    )

    expect((await getAttachment()).status).toBe(200)
    expect(whereCalls.some(([condition]) => queryContainsValue(condition, "project-1"))).toBe(true)
    expect(mocks.isDriveItemWithinProjectFolder).toHaveBeenCalledWith(
      expect.objectContaining({ projectFolderId: "linked-folder-1" })
    )
  })

  it("denies a Drive file outside the canonical project folder", async () => {
    mocks.isDriveItemWithinProjectFolder.mockResolvedValue(false)

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).toHaveBeenCalledWith("drive@example.com", "drive-file-1")
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("denies trashed Drive files before downloading", async () => {
    mocks.getFile.mockResolvedValue({
      id: "drive-file-1",
      name: "plans.pdf",
      mimeType: "application/pdf",
      trashed: true,
    })

    expect((await getAttachment()).status).toBe(404)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.isDriveItemWithinProjectFolder).not.toHaveBeenCalled()
  })

  it("exports supported Google-native files with safe download headers", async () => {
    mocks.isGoogleNativeFile.mockReturnValue(true)
    mocks.getExportMimeType.mockReturnValue("application/pdf")
    mocks.getExportExtension.mockReturnValue(".pdf")
    mocks.getFile.mockResolvedValue({
      id: "drive-file-1",
      name: "plans",
      mimeType: "application/vnd.google-apps.document",
      trashed: false,
    })
    mocks.exportFile.mockResolvedValue(new Response("pdf-bytes", { status: 200 }))

    const response = await getAttachment()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain("plans.pdf")
    expect(await response.text()).toBe("pdf-bytes")
    expect(mocks.exportFile).toHaveBeenCalledWith(
      "drive@example.com",
      "drive-file-1",
      "application/pdf"
    )
  })

  it("rejects Google-native files without a supported export format", async () => {
    mocks.isGoogleNativeFile.mockReturnValue(true)
    mocks.getExportMimeType.mockReturnValue(null)

    expect((await getAttachment()).status).toBe(415)
    expect(mocks.exportFile).not.toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("rejects arbitrary URLs and supports historical raw Drive IDs", async () => {
    setupDb({ ...projectAttachment, projectId: null, projectOrganizationId: null, projectFolderId: null, r2Path: "https://evil.example/file" })
    expect((await getAttachment()).status).toBe(404)
    expect(mocks.getFile).not.toHaveBeenCalled()

    setupDb({ ...projectAttachment, projectId: null, projectOrganizationId: null, projectFolderId: null, r2Path: "drive-file-1" })

    const response = await getAttachment()

    expect(response.status).toBe(200)
    expect(mocks.getFile).toHaveBeenCalledWith("drive@example.com", "drive-file-1")
  })

  it.each(["drive:drive-file-1", "google-drive:drive-file-1"])(
    "supports the anchored %s storage prefix",
    async (r2Path) => {
      setupDb({
        ...projectAttachment,
        projectId: null,
        projectOrganizationId: null,
        projectFolderId: null,
        r2Path,
      })

      expect((await getAttachment()).status).toBe(200)
      expect(mocks.getFile).toHaveBeenCalledWith("drive@example.com", "drive-file-1")
    }
  )

  it.each(["drive:bad/id", "google-drive:", "drive:https://evil.example/file"])(
    "rejects malformed or unsafe storage ID %s before Drive",
    async (r2Path) => {
      setupDb({
        ...projectAttachment,
        projectId: null,
        projectOrganizationId: null,
        projectFolderId: null,
        r2Path,
      })

      expect((await getAttachment()).status).toBe(404)
      expect(mocks.getFile).not.toHaveBeenCalled()
    }
  )
})
