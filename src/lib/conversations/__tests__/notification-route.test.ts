import { describe, expect, it } from "vitest"
import {
  conversationChannelIdFromNotificationHref,
  conversationFullViewHref,
  conversationPanelOpenedAnnouncement,
  notificationPanelChannelId,
} from "../notification-route"

describe("conversationChannelIdFromNotificationHref", () => {
  it("recognizes a Compass conversation route and decodes its channel id", () => {
    expect(
      conversationChannelIdFromNotificationHref(
        "/dashboard/conversations/direct%3Amartine-wes?source=notification"
      )
    ).toBe("direct:martine-wes")
  })

  it("builds the existing full-page route when the user explicitly opens a conversation in the center", () => {
    expect(conversationFullViewHref("direct:martine/wes")).toBe(
      "/dashboard/conversations/direct%3Amartine%2Fwes"
    )
  })

  it("announces a drawer-opened conversation without changing workspace focus", () => {
    expect(conversationPanelOpenedAnnouncement()).toBe(
      "Conversation opened in side panel."
    )
  })

  it("uses the drawer only on desktop when the dashboard conversation panel is available", () => {
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: false,
        hasConversationPanel: true,
      })
    ).toBe("channel-42")
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: true,
        hasConversationPanel: true,
      })
    ).toBeNull()
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: false,
        hasConversationPanel: false,
      })
    ).toBeNull()
  })

  it("does not treat unrelated, nested, or external destinations as panel conversations", () => {
    expect(conversationChannelIdFromNotificationHref("/dashboard/projects/project-42")).toBeNull()
    expect(
      conversationChannelIdFromNotificationHref(
        "/dashboard/conversations/channel-42/meeting"
      )
    ).toBeNull()
    expect(
      conversationChannelIdFromNotificationHref(
        "https://example.com/dashboard/conversations/channel-42"
      )
    ).toBeNull()
    expect(conversationChannelIdFromNotificationHref("//example.com/dashboard/conversations/channel-42")).toBeNull()
  })
})
