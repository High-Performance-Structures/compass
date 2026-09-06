import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  persistOwnerUpdateDraft: vi.fn(),
  publishOwnerProjectUpdate: vi.fn(),
  updateOwnerProjectUpdateDraft: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/app/actions/project-field", () => ({
  publishOwnerProjectUpdate: mocks.publishOwnerProjectUpdate,
  updateOwnerProjectUpdateDraft: mocks.updateOwnerProjectUpdateDraft,
}))
vi.mock("@/lib/owner-updates/draft-publish", () => ({
  persistOwnerUpdateDraft: mocks.persistOwnerUpdateDraft,
}))

import { PUT } from "../route"

describe("PUT /api/projects/[id]/owner-updates/[updateId]/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("authenticates before reading the request body", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("Not signed in"))
    const request = new Request(
      "https://compass.example/api/projects/project-1/owner-updates/update-1/draft",
      { method: "PUT", body: "not-json" }
    )
    const json = vi.spyOn(request, "json")

    const response = await PUT(request, {
      params: Promise.resolve({ id: "project-1", updateId: "update-1" }),
    })

    expect(response.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(mocks.persistOwnerUpdateDraft).not.toHaveBeenCalled()
  })
})