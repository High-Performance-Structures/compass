import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  resolveProjectRouteId: vi.fn(),
  assertProjectAccess: vi.fn(),
  getProjectDocumentDriveContext: vi.fn(),
  isDriveItemWithinProjectFolder: vi.fn(),
  isGoogleNativeFile: vi.fn(),
  getExportMimeType: vi.fn(),
  getExportExtension: vi.fn(),
  downloadFoxitExecutedEnvelope: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  exportFile: vi.fn(),
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
vi.mock("@/lib/google/project-document-drive", () => ({
  getProjectDocumentDriveContext: mocks.getProjectDocumentDriveContext,
}))
vi.mock("@/lib/google/project-folder-boundary", () => ({
  isDriveItemWithinProjectFolder: mocks.isDriveItemWithinProjectFolder,
}))
vi.mock("@/lib/google/mapper", () => ({
  isGoogleNativeFile: mocks.isGoogleNativeFile,
  getExportMimeType: mocks.getExportMimeType,
  getExportExtension: mocks.getExportExtension,
}))
vi.mock("@/lib/foxit/esign", () => ({
  downloadFoxitExecutedEnvelope: mocks.downloadFoxitExecutedEnvelope,
}))

import { GET } from "../route"

const owner = {
  id: "owner-1",
  email: "owner@example.com",
  role: "client",
} as const

const executedDrivePacket = {
  packetNumber: "O-197-5565-00",
  versionNumber: 1,
  foxitEnvelopeId: "envelope-1",
  signaturePackageUrl: "https://drive.google.com/file/d/drive-contract-1/view",
}

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

function configureDb(results: readonly unknown[]): void {
  let selectIndex = 0
  mocks.getDb.mockReturnValue({
    select() {
      const result = results[selectIndex] ?? null
      selectIndex += 1
      return query(result)
    },
  })
}

async function requestDocument(): Promise<Response> {
  return GET(new Request("https://compass.example/contract"), {
    params: Promise.resolve({ id: "project-1", packetId: "packet-1" }),
  })
}

describe("GET executed contract document", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue(owner)
    mocks.resolveProjectRouteId.mockResolvedValue("project-1")
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: "db",
        FOXIT_ESIGN_CLIENT_ID: "client-id",
        FOXIT_ESIGN_CLIENT_SECRET: "client-secret",
      },
    })
    mocks.assertProjectAccess.mockResolvedValue({ id: "project-1" })
    mocks.getProjectDocumentDriveContext.mockResolvedValue({
      client: {
        getFile: mocks.getFile,
        downloadFile: mocks.downloadFile,
        exportFile: mocks.exportFile,
      },
      googleEmail: "drive@example.com",
      sharedDriveId: null,
    })
    mocks.isDriveItemWithinProjectFolder.mockResolvedValue(true)
    mocks.getFile.mockResolvedValue({
      id: "drive-contract-1",
      name: "Dirk Litten executed contract.pdf",
      mimeType: "application/pdf",
      trashed: false,
    })
    mocks.isGoogleNativeFile.mockReturnValue(false)
    mocks.downloadFile.mockResolvedValue(
      new Response("contract-bytes", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    )
  })

  it.each(["client", "owner"])(
    "serves a project Drive contract to an authorized %s",
    async (membershipRole) => {
      configureDb([
        { role: membershipRole },
        executedDrivePacket,
        { folderId: "project-folder-1" },
      ])

      const response = await requestDocument()

      expect(response.status).toBe(200)
      expect(await response.text()).toBe("contract-bytes")
      expect(mocks.isDriveItemWithinProjectFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "drive-contract-1",
          projectFolderId: "project-folder-1",
        })
      )
    }
  )

  it.each(["subcontractor", "supplier", "member"])(
    "denies a %s before loading the contract",
    async (membershipRole) => {
      configureDb([{ role: membershipRole }])

      const response = await requestDocument()

      expect(response.status).toBe(404)
      expect(mocks.getProjectDocumentDriveContext).not.toHaveBeenCalled()
    }
  )

  it("denies a Drive document outside the canonical project folder", async () => {
    configureDb([
      { role: "client" },
      executedDrivePacket,
      { folderId: "project-folder-1" },
    ])
    mocks.isDriveItemWithinProjectFolder.mockResolvedValue(false)

    expect((await requestDocument()).status).toBe(404)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("serves the matching Foxit envelope to internal staff", async () => {
    mocks.requireAuth.mockResolvedValue({ ...owner, role: "admin" })
    configureDb([
      {
        ...executedDrivePacket,
        signaturePackageUrl:
          "/api/integrations/foxit/envelopes/envelope-1/document",
      },
    ])
    mocks.downloadFoxitExecutedEnvelope.mockResolvedValue(
      new Response("foxit-contract", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    )

    const response = await requestDocument()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("foxit-contract")
  })

  it("redirects an authorized owner to another secure saved location", async () => {
    configureDb([
      { role: "client" },
      {
        ...executedDrivePacket,
        signaturePackageUrl: "https://documents.example.com/executed.pdf",
      },
    ])

    const response = await requestDocument()

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://documents.example.com/executed.pdf"
    )
  })
})
