import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  remove: vi.fn(),
}))

vi.mock("@/lib/correspondence/attachment-storage", () => ({
  CorrespondenceAttachmentError: class CorrespondenceAttachmentError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  downloadCorrespondenceAttachment: mocks.download,
  deleteStagedCorrespondenceAttachment: mocks.remove,
}))

import { DELETE, GET } from "../route"

const params = { params: Promise.resolve({ id: "attachment-1" }) }

describe("correspondence attachment download and staged deletion", () => {
  beforeEach(() => {
    mocks.download.mockReset()
    mocks.remove.mockReset()
  })

  it("streams an authorized attachment through a private no-store response", async () => {
    mocks.download.mockResolvedValue({
      body: new Response("file-bytes", { status: 200 }),
      name: "plans.pdf",
      contentType: "application/pdf",
    })

    const response = await GET(
      new Request("https://compass.example/api/correspondence/attachments/attachment-1?projectId=project-1"),
      params
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe("file-bytes")
    expect(mocks.download).toHaveBeenCalledWith({
      projectId: "project-1",
      attachmentId: "attachment-1",
    })
  })

  it.each(["application/pdf", "image/jpeg", "text/plain", "video/mp4", "audio/mpeg"])("previews authorized %s bytes inline without caching", async (contentType) => {
    mocks.download.mockResolvedValue({ body: new Response("preview-bytes"), name: "example", contentType })
    const response = await GET(new Request("https://compass.example/api/correspondence/attachments/attachment-1?projectId=project-1&preview=1"), params)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain("inline;")
    expect(response.headers.get("content-type")).toBe(contentType)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'")
  })

  it.each(["text/html", "image/svg+xml", "application/octet-stream"])("never renders active or unsupported %s inline", async (contentType) => {
    mocks.download.mockResolvedValue({ body: new Response("file"), name: "example", contentType })
    const response = await GET(new Request("https://compass.example/api/correspondence/attachments/attachment-1?projectId=project-1&preview=1"), params)
    expect(response.status).toBe(415)
  })

  it("requires the project scope for reads and staged deletes", async () => {
    const request = new Request("https://compass.example/api/correspondence/attachments/attachment-1")

    expect((await GET(request, params)).status).toBe(400)
    expect((await DELETE(request, params)).status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("only invokes the staged-only deletion service", async () => {
    mocks.remove.mockResolvedValue(undefined)

    const response = await DELETE(
      new Request("https://compass.example/api/correspondence/attachments/attachment-1?projectId=project-1", { method: "DELETE" }),
      params
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mocks.remove).toHaveBeenCalledWith({
      projectId: "project-1",
      attachmentId: "attachment-1",
    })
  })
})
