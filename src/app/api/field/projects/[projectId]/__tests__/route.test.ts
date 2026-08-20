import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getFieldProjectPacket: vi.fn(),
}))

vi.mock("@/app/actions/field-mode", () => ({
  getFieldProjectPacket: mocks.getFieldProjectPacket,
}))

import { GET } from "../route"

describe("GET /api/field/projects/:projectId", () => {
  beforeEach(() => {
    mocks.getFieldProjectPacket.mockReset()
  })

  it("returns a fresh packet with native-cache prevention headers", async () => {
    mocks.getFieldProjectPacket.mockResolvedValue({
      project: {
        id: "project-1",
        name: "Project",
        projectNumber: null,
        address: null,
      },
      tasks: [],
      logs: [],
      documents: [],
      channel: null,
      messages: [],
      directConversations: [],
      contacts: [],
      notifications: [],
      syncedAt: "2026-08-20T18:00:00.000Z",
    })

    const response = await GET(
      new Request(
        "https://compass.example/api/field/projects/project-1?refresh=123"
      ),
      { params: Promise.resolve({ projectId: "project-1" }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("pragma")).toBe("no-cache")
    expect(mocks.getFieldProjectPacket).toHaveBeenCalledWith("project-1")
  })
})
