import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  resolveProjectRouteId: vi.fn(),
  assertProjectAccess: vi.fn(),
  decrypt: vi.fn(),
  parseServiceAccountKey: vi.fn(),
  downloadFile: vi.fn(),
  exportFile: vi.fn(),
  isGoogleNativeFile: vi.fn(),
  getExportMimeType: vi.fn(),
  getExportExtension: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-route-id", () => ({
  resolveProjectRouteId: mocks.resolveProjectRouteId,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/crypto", () => ({ decrypt: mocks.decrypt }))
vi.mock("@/lib/google/config", () => ({
  getGoogleCryptoSalt: () => "salt",
  parseServiceAccountKey: mocks.parseServiceAccountKey,
}))
vi.mock("@/lib/google/mapper", () => ({
  getExportExtension: mocks.getExportExtension,
  getExportMimeType: mocks.getExportMimeType,
  isGoogleNativeFile: mocks.isGoogleNativeFile,
}))
vi.mock("@/lib/google/client/drive-client", () => ({
  DriveClient: class {
    downloadFile = mocks.downloadFile
    exportFile = mocks.exportFile
  },
}))

import { GET } from "../route"

const baseUser = {
  id: "viewer-1",
  email: "viewer@example.com",
  role: "client",
} as const

const project = {
  id: "project-1",
  organizationId: "org-1",
} as const

const photo = {
  driveFileId: "drive-photo-1",
  fileName: "IMG_7288.jpeg",
  mimeType: "image/jpeg",
} as const

function query(result: unknown) {
  const chain = {
    from() {
      return chain
    },
    where() {
      return chain
    },
    limit() {
      return chain
    },
    then(resolve: (value: readonly unknown[]) => unknown) {
      return Promise.resolve(result === null ? [] : [result]).then(resolve)
    },
  }
  return chain
}

function configureDb({
  viewerRole,
  membershipRole,
  visiblePhoto,
  projectAccessError,
}: {
  readonly viewerRole: string
  readonly membershipRole: string | null
  readonly visiblePhoto: typeof photo | null
  readonly projectAccessError?: Error
}): void {
  mocks.requireAuth.mockResolvedValue({ ...baseUser, role: viewerRole })
  mocks.resolveProjectRouteId.mockResolvedValue(project.id)
  if (projectAccessError) {
    mocks.assertProjectAccess.mockRejectedValue(projectAccessError)
  } else {
    mocks.assertProjectAccess.mockResolvedValue(project)
  }
  mocks.getCloudflareContext.mockResolvedValue({
    env: {
      DB: "db",
      COMPASS_GOOGLE_DOWNLOAD_USER: "drive@example.com",
      GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY: "encryption-key",
    },
  })
  mocks.decrypt.mockResolvedValue("{}")
  mocks.parseServiceAccountKey.mockReturnValue({ type: "service_account" })
  mocks.isGoogleNativeFile.mockReturnValue(false)
  mocks.downloadFile.mockResolvedValue(new Response("jpeg-bytes", { status: 200 }))

  let selectCount = 0
  mocks.getDb.mockReturnValue({
    select() {
      selectCount += 1
      if (viewerRole !== "admin" && selectCount === 1) {
        return query(membershipRole === null ? null : { role: membershipRole })
      }
      if (viewerRole !== "admin" && selectCount === 2) {
        return query(visiblePhoto)
      }
      if (viewerRole === "admin" && selectCount === 1) {
        return query(visiblePhoto)
      }
      return query({ serviceAccountKeyEncrypted: "encrypted" })
    },
  })
}

async function getPhoto(audience?: string): Promise<Response> {
  const suffix = audience === undefined ? "" : `?audience=${audience}`
  return GET(
    new NextRequest(
      `https://compass.example/api/projects/project-1/photos/photo-1${suffix}`
    ),
    { params: Promise.resolve({ id: "project-1", photoId: "photo-1" }) }
  )
}

describe("GET /api/projects/:id/photos/:photoId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureDb({
      viewerRole: "admin",
      membershipRole: null,
      visiblePhoto: photo,
    })
  })

  it("serves an internal review photo without requiring an audience query", async () => {
    const response = await getPhoto()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("jpeg-bytes")
    expect(mocks.downloadFile).toHaveBeenCalledWith("drive@example.com", "drive-photo-1")
  })

  it("serves an approved owner-visible photo only to an owner member", async () => {
    configureDb({
      viewerRole: "client",
      membershipRole: "client",
      visiblePhoto: photo,
    })

    const response = await getPhoto("owner")

    expect(response.status).toBe(200)
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
  })

  it("serves an approved owner-visible photo to a member with the owner role", async () => {
    configureDb({
      viewerRole: "client",
      membershipRole: "owner",
      visiblePhoto: photo,
    })

    const response = await getPhoto("owner")

    expect(response.status).toBe(200)
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
  })

  it("serves an approved sub/vendor-visible photo only to a partner member", async () => {
    configureDb({
      viewerRole: "subcontractor",
      membershipRole: "subcontractor",
      visiblePhoto: photo,
    })

    const response = await getPhoto("sub_vendor")

    expect(response.status).toBe(200)
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
  })

  it("serves an approved sub/vendor-visible photo to a member with the supplier role", async () => {
    configureDb({
      viewerRole: "supplier",
      membershipRole: "supplier",
      visiblePhoto: photo,
    })

    const response = await getPhoto("sub_vendor")

    expect(response.status).toBe(200)
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["owner member using the sub/vendor audience", "client", "client", "sub_vendor"],
    ["subcontractor using the owner audience", "subcontractor", "subcontractor", "owner"],
    ["an external viewer omitting the audience", "client", "client", undefined],
    ["a member when the photo is not visible", "client", "client", "owner"],
  ] as const)("denies %s before Drive access", async (_label, viewerRole, membershipRole, audience) => {
    configureDb({
      viewerRole,
      membershipRole,
      visiblePhoto: _label === "a member when the photo is not visible" ? null : photo,
    })

    const response = await getPhoto(audience)

    expect(response.status).toBe(404)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it.each([
    ["a cross-project request", "project-2"],
    ["a cross-organization request", "project-from-org-2"],
  ] as const)("stops %s at the project-access boundary", async (_label, resolvedProjectId) => {
    configureDb({
      viewerRole: "client",
      membershipRole: "client",
      visiblePhoto: photo,
      projectAccessError: new Error("Project not found"),
    })
    mocks.resolveProjectRouteId.mockResolvedValue(resolvedProjectId)

    const response = await getPhoto("owner")

    // Access-helper rejection must have the same not-found semantics as the
    // route's other external denial paths, without touching photo or Drive.
    expect(response.status).toBe(404)
    expect(mocks.assertProjectAccess).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.any(Function) }),
      expect.objectContaining({ id: "viewer-1", role: "client" }),
      resolvedProjectId
    )
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })
})
