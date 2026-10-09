import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getActiveOrganization: vi.fn(),
  can: vi.fn(),
  getGoogleConfig: vi.fn(),
  decrypt: vi.fn(),
  parseServiceAccountKey: vi.fn(),
  downloadFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: vi.fn(),
  getActiveOrganization: mocks.getActiveOrganization,
}))
vi.mock("@/lib/permissions", () => ({ can: mocks.can }))
vi.mock("@/lib/google/config", () => ({
  getGoogleConfig: mocks.getGoogleConfig,
  getGoogleCryptoSalt: () => "salt",
  parseServiceAccountKey: mocks.parseServiceAccountKey,
}))
vi.mock("@/lib/crypto", () => ({ decrypt: mocks.decrypt }))
vi.mock("@/lib/google/client/drive-client", () => ({
  DriveClient: class {
    downloadFile = mocks.downloadFile
  },
}))
vi.mock("@/lib/google/mapper", () => ({
  isGoogleNativeFile: () => false,
  getExportMimeType: vi.fn(),
  getExportExtension: vi.fn(),
}))

import { GET } from "../route"

const user = {
  id: "staff-1",
  email: "staff@example.com",
  googleEmail: null,
  isActive: true,
  organizationId: "org-a",
  organizationType: "internal",
  role: "admin",
} as const

const request = new NextRequest(
  "https://compass.example/api/google/download/drive-file-1"
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue(user)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
  mocks.getDb.mockReturnValue({})
  mocks.getActiveOrganization.mockResolvedValue({ id: "org-a", type: "client" })
  mocks.can.mockReturnValue(true)
  mocks.getGoogleConfig.mockReturnValue({ encryptionKey: "key" })
})

describe("GET /api/google/download/:fileId", () => {
  it("denies a stale internal DTO when the authoritative organization is external", async () => {
    const response = await GET(request, {
      params: Promise.resolve({ fileId: "drive-file-1" }),
    })

    expect(response.status).toBe(404)
    expect(mocks.getActiveOrganization).toHaveBeenCalledWith(
      expect.anything(),
      user
    )
    expect(mocks.getGoogleConfig).not.toHaveBeenCalled()
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })
})
