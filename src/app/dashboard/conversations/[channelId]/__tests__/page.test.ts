import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getChannel: vi.fn(),
  getMessages: vi.fn(),
  getProjects: vi.fn(),
  getProjectContactsSummary: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/app/actions/conversations", () => ({ getChannel: mocks.getChannel }))
vi.mock("@/app/actions/chat-messages", () => ({
  getMessages: mocks.getMessages,
}))
vi.mock("@/app/actions/projects", () => ({ getProjects: mocks.getProjects }))
vi.mock("@/app/actions/project-contacts", () => ({
  getProjectContactsSummary: mocks.getProjectContactsSummary,
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
}))
vi.mock("@/components/conversations/channel-header", () => ({
  ChannelHeader: () => null,
}))
vi.mock("@/components/conversations/message-list", () => ({
  MessageList: () => null,
}))
vi.mock("@/components/conversations/message-composer", () => ({
  MessageComposer: () => null,
}))
vi.mock("@/components/conversations/thread-panel", () => ({
  ThreadPanel: () => null,
}))

import ChannelPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue({ id: "internal-user", role: "admin" })
  mocks.getChannel.mockResolvedValue({
    success: true,
    data: {
      id: "vendor-channel",
      projectId: "project-a",
      organizationId: "org-a",
      audience: "sub_vendors",
      name: "Vendor conversation",
      memberCount: 2,
    },
  })
  mocks.getMessages.mockResolvedValue({ success: true, data: [] })
  mocks.getProjects.mockResolvedValue([])
  mocks.getProjectContactsSummary.mockResolvedValue(null)
})
const params = (): Promise<{ channelId: string }> =>
  Promise.resolve({ channelId: "vendor-channel" })

describe("shared conversation notification entry", () => {
  it("renders the authorized vendor conversation in the internal workspace for staff", async () => {
    expect(await ChannelPage({ params: params() })).toBeTruthy()
    expect(mocks.getMessages).toHaveBeenCalledWith("vendor-channel")
  })

  it.each(["subcontractor", "supplier"])(
    "redirects authenticated %s recipients into their workspace",
    async (role) => {
      mocks.getCurrentUser.mockResolvedValue({ id: "vendor-user", role })
      await expect(ChannelPage({ params: params() })).rejects.toThrow(
        "REDIRECT:/preview/projects/project-a/sub-vendor/conversations/vendor-channel",
      )
      expect(mocks.getMessages).not.toHaveBeenCalled()
    },
  )

  it("redirects the separate owner identity to its owner conversation", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "owner-user", role: "client" })
    mocks.getChannel.mockResolvedValue({
      success: true,
      data: {
        id: "owner-channel",
        projectId: "project-a",
        audience: "clients",
      },
    })
    await expect(ChannelPage({ params: params() })).rejects.toThrow(
      "REDIRECT:/preview/projects/project-a/owner/conversations/owner-channel",
    )
  })

  it("does not resolve destinations or load messages when channel access is denied", async () => {
    mocks.getChannel.mockResolvedValue({
      success: false,
      error: "Access denied",
    })
    await expect(ChannelPage({ params: params() })).rejects.toThrow("NOT_FOUND")
    expect(mocks.getMessages).not.toHaveBeenCalled()
  })

  it("does not open conversations without an authenticated recipient", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    await expect(ChannelPage({ params: params() })).rejects.toThrow("NOT_FOUND")
    expect(mocks.getMessages).not.toHaveBeenCalled()
  })
})
