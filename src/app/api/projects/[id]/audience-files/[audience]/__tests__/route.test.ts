import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findOrCreateProjectAudienceFolder: vi.fn(),
  getCloudflareContext: vi.fn(),
  projectAudienceDriveClient: vi.fn(),
  recordActivityEvent: vi.fn(),
  requireProjectAudienceFileAccess: vi.fn(),
}))

vi.mock("@/lib/project-audience-file-access", () => ({
  requireProjectAudienceFileAccess: mocks.requireProjectAudienceFileAccess,
}))

vi.mock("@/lib/project-audience-file-drive", () => ({
  findOrCreateProjectAudienceFolder: mocks.findOrCreateProjectAudienceFolder,
  projectAudienceDriveClient: mocks.projectAudienceDriveClient,
}))

vi.mock("@/lib/activity-log", () => ({
  recordActivityEvent: mocks.recordActivityEvent,
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import {
  GET,
  POST,
} from "@/app/api/projects/[id]/audience-files/[audience]/route"

function forgedPdfRequest(): Request {
  const formData = new FormData()
  formData.append(
    "files",
    new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "malware.pdf", {
      type: "application/pdf",
    })
  )
  return new Request("https://compass.example/api/projects/project-1/audience-files/owner", {
    method: "POST",
    body: formData,
  })
}

function validPdfRequest(): Request {
  const formData = new FormData()
  formData.append(
    "files",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], "appliance.pdf", {
      type: "application/pdf",
    })
  )
  return new Request("https://compass.example/api/projects/project-1/audience-files/owner", {
    method: "POST",
    body: formData,
  })
}

function databaseForGrantedList() {
  const orderBy = vi.fn().mockResolvedValue([])
  const where = vi.fn(() => ({ orderBy }))
  const innerJoin = vi.fn(() => ({ where }))
  const from = vi.fn(() => ({ innerJoin }))
  return {
    select: vi.fn(() => ({ from })),
  }
}

function databaseForSuccessfulUpload() {
  const get = vi.fn().mockResolvedValue({
    googleDriveFolderId: "project-folder-1",
    total: 0,
  })
  const where = vi.fn(() => ({ get }))
  const from = vi.fn(() => ({ where }))
  const insertValues: unknown[] = []
  const insert = vi.fn(() => ({
    values: vi.fn((value: unknown) => {
      insertValues.push(value)
      return Promise.resolve(undefined)
    }),
  }))
  return {
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert,
    insertValues,
    select: vi.fn(() => ({ from })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  }
}

describe("external project audience file uploads", () => {
  beforeEach(() => {
    mocks.findOrCreateProjectAudienceFolder.mockReset()
    mocks.getCloudflareContext.mockReset()
    mocks.projectAudienceDriveClient.mockReset()
    mocks.recordActivityEvent.mockReset()
    mocks.requireProjectAudienceFileAccess.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: {} })
    mocks.recordActivityEvent.mockResolvedValue(undefined)
    mocks.requireProjectAudienceFileAccess.mockResolvedValue({
      viewerIsInternal: false,
    })
  })

  it("lists only resources granted to the external viewer", async () => {
    const db = databaseForGrantedList()
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

    const response = await GET(new Request("https://compass.example"), {
      params: Promise.resolve({ id: "project-1", audience: "owner" }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ files: [] })
  })

  it("rejects forged PDF multipart metadata before Drive initialization", async () => {
    const response = await POST(forgedPdfRequest(), {
      params: Promise.resolve({ id: "project-1", audience: "owner" }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Each upload must be a supported photo or PDF.",
    })
    expect(mocks.projectAudienceDriveClient).not.toHaveBeenCalled()
    expect(mocks.findOrCreateProjectAudienceFolder).not.toHaveBeenCalled()
  })

  it("uses the authorized organization when creating its Drive client", async () => {
    const db = databaseForSuccessfulUpload()
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
    mocks.projectAudienceDriveClient.mockResolvedValue({
      client: {
        uploadFile: vi.fn().mockResolvedValue({ id: "drive-file-1" }),
      },
      googleEmail: "compass@example.test",
      sharedDriveId: "shared-drive-a",
    })
    mocks.findOrCreateProjectAudienceFolder.mockResolvedValue("folder-a")

    const response = await POST(validPdfRequest(), {
      params: Promise.resolve({ id: "project-1", audience: "owner" }),
    })

    expect(response.status).toBe(200)
    expect(mocks.projectAudienceDriveClient).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a" })
    )
    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(db.insertValues[1]).toEqual(
      expect.objectContaining({
        organizationId: "org-a",
        projectId: "project-1",
        recipientUserId: "external-user-a",
        resourceType: "audience_file",
      })
    )
  })

  it("does not expose Drive provider failures to external uploaders", async () => {
    const db = databaseForSuccessfulUpload()
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
    mocks.projectAudienceDriveClient.mockResolvedValue({
      client: {
        uploadFile: vi
          .fn()
          .mockRejectedValue(new Error("Google API rejected shared-drive-a credential")),
      },
      googleEmail: "compass@example.test",
      sharedDriveId: "shared-drive-a",
    })
    mocks.findOrCreateProjectAudienceFolder.mockResolvedValue("folder-a")

    const response = await POST(validPdfRequest(), {
      params: Promise.resolve({ id: "project-1", audience: "owner" }),
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Some files could not be uploaded.",
      uploaded: [],
    })
  })

  it("returns a non-enumerating response when project audience access is denied", async () => {
    mocks.requireProjectAudienceFileAccess.mockRejectedValueOnce(
      new Error("Project not found")
    )

    const response = await POST(forgedPdfRequest(), {
      params: Promise.resolve({ id: "project-1", audience: "owner" }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Not found" })
    expect(mocks.projectAudienceDriveClient).not.toHaveBeenCalled()
  })
})
