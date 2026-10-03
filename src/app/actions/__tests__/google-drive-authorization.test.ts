import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getActiveOrganization: vi.fn(),
  requirePermission: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getCurrentUser: mocks.requireAuth,
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  getActiveOrganization: mocks.getActiveOrganization,
}))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))

import {
  createDriveFolder,
  getDriveStorageQuota,
  getUploadSessionUrl,
  listDriveFiles,
  searchDriveFiles,
} from "@/app/actions/google-drive"

const externalUser = {
  id: "external-1",
  email: "external@example.com",
  isActive: true,
  organizationId: "org-client",
  organizationType: "client",
  role: "client",
} as const

describe("generic Google Drive Server Action authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue(externalUser)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
    mocks.getDb.mockReturnValue({})
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-client",
      type: "client",
    })
  })

  it.each([
    ["list", () => listDriveFiles()],
    ["search", () => searchDriveFiles("confidential")],
    ["create folder", () => createDriveFolder("private")],
    ["quota", () => getDriveStorageQuota()],
    ["upload session", () => getUploadSessionUrl("private.txt", "text/plain")],
  ])("denies an external caller before permission or provider work for %s", async (_label, action) => {
    const result = await action()

    expect(result).toMatchObject({ success: false })
    expect(mocks.requireAuth).toHaveBeenCalledTimes(1)
    expect(mocks.getCloudflareContext).toHaveBeenCalledTimes(1)
    expect(mocks.getDb).toHaveBeenCalledWith("db")
    expect(mocks.getActiveOrganization).toHaveBeenCalled()
    expect(mocks.requirePermission).not.toHaveBeenCalled()
  })

  it("denies an inactive internal caller before permission or provider work", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...externalUser,
      isActive: false,
      organizationId: "org-internal",
      organizationType: "internal",
      role: "admin",
    })
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
    })

    const result = await listDriveFiles()

    expect(result).toMatchObject({ success: false })
    expect(mocks.requirePermission).not.toHaveBeenCalled()
  })
})