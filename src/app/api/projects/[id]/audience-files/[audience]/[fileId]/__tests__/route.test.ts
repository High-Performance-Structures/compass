import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  hasActiveExternalProjectResourceGrant: vi.fn(),
  projectAudienceDriveClient: vi.fn(),
  requireProjectAudienceFileAccess: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock("@/lib/project-audience-file-access", () => ({
  requireProjectAudienceFileAccess: mocks.requireProjectAudienceFileAccess,
}))

vi.mock("@/lib/project-external-resource-access", () => ({
  hasActiveExternalProjectResourceGrant:
    mocks.hasActiveExternalProjectResourceGrant,
}))

vi.mock("@/lib/project-audience-file-drive", () => ({
  projectAudienceDriveClient: mocks.projectAudienceDriveClient,
}))

import { GET } from "@/app/api/projects/[id]/audience-files/[audience]/[fileId]/route"

function databaseForUploadedFile() {
  const get = vi.fn().mockResolvedValue({
    driveFileId: "drive-file-1",
    fileName: "appliance.pdf",
  })
  const where = vi.fn(() => ({ get }))
  const from = vi.fn(() => ({ where }))
  return {
    select: vi.fn(() => ({ from })),
  }
}

describe("external project audience file downloads", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.hasActiveExternalProjectResourceGrant.mockReset()
    mocks.projectAudienceDriveClient.mockReset()
    mocks.requireProjectAudienceFileAccess.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: {} })
  })

  it("does not download a guessed file ID without an explicit grant", async () => {
    const db = databaseForUploadedFile()
    mocks.requireProjectAudienceFileAccess.mockResolvedValue({
      db,
      organizationId: "org-a",
      user: {
        email: "owner@example.test",
        googleEmail: null,
        id: "external-user-a",
      },
      viewerIsInternal: false,
    })
    mocks.hasActiveExternalProjectResourceGrant.mockResolvedValue(false)

    const response = await GET(new Request("https://compass.example"), {
      params: Promise.resolve({
        audience: "owner",
        fileId: "file-1",
        id: "project-1",
      }),
    })

    expect(response.status).toBe(404)
    expect(mocks.hasActiveExternalProjectResourceGrant).toHaveBeenCalledWith({
      db,
      organizationId: "org-a",
      projectId: "project-1",
      recipientUserId: "external-user-a",
      resourceId: "file-1",
      resourceType: "audience_file",
    })
    expect(mocks.projectAudienceDriveClient).not.toHaveBeenCalled()
  })

  it("uses the authorized organization when creating its Drive client", async () => {
    const db = databaseForUploadedFile()
    mocks.requireProjectAudienceFileAccess.mockResolvedValue({
      db,
      organizationId: "org-a",
      user: {
        email: "owner@example.test",
        googleEmail: null,
        id: "external-user-a",
      },
    })
    mocks.hasActiveExternalProjectResourceGrant.mockResolvedValue(true)
    mocks.projectAudienceDriveClient.mockResolvedValue({
      client: {
        downloadFile: vi.fn().mockResolvedValue(new Response("document")),
      },
      googleEmail: "compass@example.test",
      sharedDriveId: "shared-drive-a",
    })

    const response = await GET(new Request("https://compass.example"), {
      params: Promise.resolve({
        audience: "owner",
        fileId: "file-1",
        id: "project-1",
      }),
    })

    expect(response.status).toBe(200)
    expect(mocks.projectAudienceDriveClient).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a" })
    )
  })
})
