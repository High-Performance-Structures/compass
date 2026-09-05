import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
}))

vi.mock("@/lib/correspondence/attachment-storage", () => ({
  CorrespondenceAttachmentError: class CorrespondenceAttachmentError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  stageCorrespondenceAttachment: mocks.stage,
}))

import { POST } from "../route"

describe("POST /api/correspondence/attachments", () => {
  beforeEach(() => {
    mocks.stage.mockReset()
  })

  it("stages one project-scoped file and never exposes its Drive ID", async () => {
    mocks.stage.mockResolvedValue({
      id: "attachment-1",
      name: "plans.pdf",
      size: 12,
      contentType: "application/pdf",
    })
    const form = new FormData()
    form.set("projectId", "project-1")
    form.set("file", new File(["plans"], "plans.pdf", { type: "application/pdf" }))

    const response = await POST(
      new Request("https://compass.example/api/correspondence/attachments", {
        method: "POST",
        body: form,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        id: "attachment-1",
        name: "plans.pdf",
        size: 12,
        contentType: "application/pdf",
      },
    })
    expect(mocks.stage).toHaveBeenCalledWith({
      projectId: "project-1",
      file: expect.any(File),
    })
  })

  it("rejects requests without a project or file before staging", async () => {
    const response = await POST(
      new Request("https://compass.example/api/correspondence/attachments", {
        method: "POST",
        body: new FormData(),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.stage).not.toHaveBeenCalled()
  })
})
