import { describe, expect, it } from "vitest"

import { parseGotoInboundNotification } from "@/lib/goto/notification-parser"

describe("parseGotoInboundNotification", () => {
  it("parses inbound SMS and MMS metadata", () => {
    const result = parseGotoInboundNotification({
      id: "event-1",
      type: "INBOUND_MESSAGE",
      timestamp: "2026-08-06T20:00:00.000Z",
      content: {
        accountKey: "account-1",
        payload: {
          messageId: "message-1",
          conversationId: "conversation-1",
          channel: "SMS",
          ownerTouchpoint: "+17199008850",
          authorTouchpoint: "+17195550123",
          body: "[Daily Log] O-210-33 Framing complete",
          attachments: {
            count: 1,
            items: [
              {
                attachmentId: "attachment-1",
                name: "framing.jpg",
                contentType: "image/jpeg",
                size: 1024,
              },
            ],
          },
        },
      },
    })

    expect(result).toEqual({
      kind: "inbound",
      message: {
        eventId: "event-1",
        accountKey: "account-1",
        messageId: "message-1",
        conversationId: "conversation-1",
        ownerTouchpoint: "+17199008850",
        senderPhone: "+17195550123",
        body: "[Daily Log] O-210-33 Framing complete",
        receivedAt: "2026-08-06T20:00:00.000Z",
        attachments: [
          {
            attachmentId: "attachment-1",
            name: "framing.jpg",
            contentType: "image/jpeg",
            size: 1024,
          },
        ],
      },
    })
  })

  it("ignores non-SMS and future event types", () => {
    expect(parseGotoInboundNotification({ type: "DELIVERY_STATUS" })).toEqual({
      kind: "ignored",
    })
    expect(
      parseGotoInboundNotification({
        type: "INBOUND_MESSAGE",
        content: { accountKey: "account", payload: { channel: "EMAIL" } },
      })
    ).toEqual({ kind: "ignored" })
  })
})
