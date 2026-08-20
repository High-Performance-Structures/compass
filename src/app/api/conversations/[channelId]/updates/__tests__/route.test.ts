import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getChannelUpdates: vi.fn(),
}))

vi.mock("@/app/actions/conversations-realtime", () => ({
  getChannelUpdates: mocks.getChannelUpdates,
}))

import { GET } from "../route"

describe("GET /api/conversations/:channelId/updates", () => {
  beforeEach(() => {
    mocks.getChannelUpdates.mockReset()
  })

  it("uses a stable no-store endpoint for live conversation updates", async () => {
    mocks.getChannelUpdates.mockResolvedValue({
      success: true,
      data: { messages: [], typingUsers: [] },
    })

    const response = await GET(
      new Request(
        "https://compass.example/api/conversations/channel-1/updates?lastMessageId=message-1"
      ),
      { params: Promise.resolve({ channelId: "channel-1" }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mocks.getChannelUpdates).toHaveBeenCalledWith(
      "channel-1",
      "message-1"
    )
  })

  it("loads the first message when a conversation has no cursor", async () => {
    mocks.getChannelUpdates.mockResolvedValue({
      success: true,
      data: { messages: [], typingUsers: [] },
    })

    await GET(
      new Request("https://compass.example/api/conversations/channel-1/updates"),
      { params: Promise.resolve({ channelId: "channel-1" }) }
    )

    expect(mocks.getChannelUpdates).toHaveBeenCalledWith(
      "channel-1",
      undefined
    )
  })
})
