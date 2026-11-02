import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { channelThreadConversationId } from "@/lib/correspondence/channel-thread-id"
import type { CorrespondenceInbox, SendCorrespondenceInput } from "@/lib/correspondence/types"

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(), sendCorrespondence: vi.fn(), updateCorrespondenceInbox: vi.fn() }))
vi.mock("@/app/actions/chat-messages", () => ({ sendMessage: mocks.sendMessage }))
vi.mock("@/app/actions/project-correspondence", () => ({ sendCorrespondence: mocks.sendCorrespondence }))
vi.mock("@/app/actions/correspondence-inbox", () => ({ updateCorrespondenceInbox: mocks.updateCorrespondenceInbox }))

import { sendFromProjectMessages } from "../channel-thread-send"
import { CorrespondenceInboxPanel } from "../correspondence-inbox-panel"

const CHANNEL_ID = "bt-thread-e99aa89504764ceaac80024f68ed965f"

function input(conversationId: string | null, attachmentIds: readonly string[] = []): SendCorrespondenceInput {
  return { projectId: "proj-1", conversationId, subject: "Kitchen tile", recipientUserIds: ["user-owner"], body: "Tile lands Tuesday.", idempotencyKey: "key-1", participantVersion: 0, attachmentIds }
}

describe("replying from the project messages pane", () => {
  afterEach(() => vi.clearAllMocks())

  it("sends a reply in an imported conversation through the conversation's own send action", async () => {
    mocks.sendMessage.mockResolvedValue({ success: true, data: { id: "msg-new" } })
    const id = channelThreadConversationId(CHANNEL_ID)
    expect(await sendFromProjectMessages(input(id))).toEqual({ success: true, data: { conversationId: id, messageId: "msg-new" } })
    expect(mocks.sendMessage).toHaveBeenCalledWith({ channelId: CHANNEL_ID, content: "Tile lands Tuesday." })
    expect(mocks.sendCorrespondence).not.toHaveBeenCalled()
  })

  it("passes the conversation's refusal through and never offers a blind resend", async () => {
    mocks.sendMessage.mockResolvedValue({ success: false, error: "Not a member of this channel" })
    expect(await sendFromProjectMessages(input(channelThreadConversationId(CHANNEL_ID)))).toEqual({ success: false, error: "Not a member of this channel", retry: "edit" })
    mocks.sendMessage.mockRejectedValue(new Error("network"))
    const unknown = await sendFromProjectMessages(input(channelThreadConversationId(CHANNEL_ID)))
    expect(unknown).toMatchObject({ success: false, retry: "edit" })
  })

  it("refuses attachments it cannot carry, and leaves correspondence on its own path", async () => {
    expect(await sendFromProjectMessages(input(channelThreadConversationId(CHANNEL_ID), ["att-1"]))).toMatchObject({ success: false, retry: "edit" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    mocks.sendCorrespondence.mockResolvedValue({ success: true, data: { conversationId: "c-1", messageId: "m-1" } })
    await sendFromProjectMessages(input("c-1"))
    expect(mocks.sendCorrespondence).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("shows the [BT] tag beside an imported conversation's subject in the list", () => {
    const inbox: CorrespondenceInbox = {
      compositionDraft: null, viewerId: "user-staff", projectName: "Stockbridge", workspace: "staff", contacts: [],
      conversations: [{
        id: channelThreadConversationId(CHANNEL_ID), projectId: "proj-1", subject: "Kitchen tile", excerpt: "Yes, warm gray.",
        lastActivityAt: "2025-10-04T15:00:00.000Z", lastActivityDisplay: "Oct 4, 2025 9:00 AM", lastActivitySourceLocal: true,
        people: [], unread: false, saved: false, followUp: false, archived: false, closed: false, shareReadReceipts: false,
        origin: { kind: "channel", source: "buildertrend" },
      }],
    }
    const html = renderToStaticMarkup(createElement(CorrespondenceInboxPanel, {
      drafts: [], onOpenDraft: async () => undefined, projectId: "proj-1", inbox, activeId: null, hiddenOnMobile: false,
      filter: "inbox", query: "", hits: [], hasMore: false, busy: false, onQuery: () => undefined, onFilter: () => undefined,
      onNewMessage: async () => undefined, onNewEmail: async () => undefined, onOpen: async () => undefined, onRefresh: async () => null,
    }))
    expect(html).toContain("Kitchen tile")
    expect(html).toContain("[BT]")
    expect(html).toContain("Source time: Oct 4, 2025 9:00 AM")
  })
})
