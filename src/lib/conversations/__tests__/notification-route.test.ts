import { describe, expect, it } from "vitest"
import {
  conversationChannelIdFromNotificationHref,
  conversationFullViewHref,
  conversationRecipientHref,
  recipientNotificationHref,
  conversationPanelOpenedAnnouncement,
  notificationPanelChannelId,
} from "../notification-route"

describe("conversationChannelIdFromNotificationHref", () => {
  it("recognizes a Compass conversation route and decodes its channel id", () => {
    expect(
      conversationChannelIdFromNotificationHref(
        "/dashboard/conversations/direct%3Amartine-wes?source=notification",
      ),
    ).toBe("direct:martine-wes")
  })

  it("builds the existing full-page route when the user explicitly opens a conversation in the center", () => {
    expect(conversationFullViewHref("direct:martine/wes")).toBe(
      "/dashboard/conversations/direct%3Amartine%2Fwes",
    )
  })

  it("announces a drawer-opened conversation without changing workspace focus", () => {
    expect(conversationPanelOpenedAnnouncement()).toBe(
      "Conversation opened in side panel.",
    )
  })

  it("uses the drawer only on desktop when the dashboard conversation panel is available", () => {
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: false,
        hasConversationPanel: true,
      }),
    ).toBe("channel-42")
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: true,
        hasConversationPanel: true,
      }),
    ).toBeNull()
    expect(
      notificationPanelChannelId({
        href: "/dashboard/conversations/channel-42",
        isMobile: false,
        hasConversationPanel: false,
      }),
    ).toBeNull()
  })

  it("does not treat unrelated, nested, or external destinations as panel conversations", () => {
    expect(
      conversationChannelIdFromNotificationHref(
        "/dashboard/projects/project-42",
      ),
    ).toBeNull()
    expect(
      conversationChannelIdFromNotificationHref(
        "/dashboard/conversations/channel-42/meeting",
      ),
    ).toBeNull()
    expect(
      conversationChannelIdFromNotificationHref(
        "https://example.com/dashboard/conversations/channel-42",
      ),
    ).toBeNull()
    expect(
      conversationChannelIdFromNotificationHref(
        "//example.com/dashboard/conversations/channel-42",
      ),
    ).toBeNull()
  })
})

describe("recipient workspace routing", () => {
  const vendorChannel = {
    id: "channel/one",
    projectId: "project/one",
    audience: "sub_vendors",
  }

  it.each(["admin", "project_manager", "office"])(
    "keeps %s recipients internal for vendor and owner conversations",
    (role) => {
      expect(conversationRecipientHref(vendorChannel, role)).toBe(
        "/dashboard/conversations/channel%2Fone",
      )
      expect(
        conversationRecipientHref(
          { ...vendorChannel, audience: "clients" },
          role,
        ),
      ).toBe("/dashboard/conversations/channel%2Fone")
    },
  )

  it.each(["subcontractor", "supplier"])(
    "keeps %s recipients in the vendor workspace",
    (role) => {
      expect(conversationRecipientHref(vendorChannel, role)).toBe(
        "/preview/projects/project%2Fone/sub-vendor/conversations/channel%2Fone",
      )
    },
  )

  it("keeps owners in their project workspace and ordinary conversations internal", () => {
    expect(
      conversationRecipientHref(
        { ...vendorChannel, audience: "clients" },
        "client",
      ),
    ).toBe("/preview/projects/project%2Fone/owner/conversations/channel%2Fone")
    expect(
      conversationRecipientHref({ ...vendorChannel, projectId: null }, "admin"),
    ).toBe("/dashboard/conversations/channel%2Fone")
  })

  it.each(["owner", "sub-vendor"])(
    "repairs old %s bell links for internal recipients and preserves the conversation target",
    (workspace) => {
      const href = `/preview/projects/project-one/${workspace}/conversations/channel%3Aone?thread=reply#message-one`
      const internal = recipientNotificationHref(href, "admin")
      expect(internal).toBe(
        "/dashboard/conversations/channel%3Aone?thread=reply#message-one",
      )
      expect(
        notificationPanelChannelId({
          href: internal,
          isMobile: false,
          hasConversationPanel: true,
        }),
      ).toBe("channel:one")
      expect(recipientNotificationHref(href, "client")).toBe(href)
      expect(recipientNotificationHref(href, "subcontractor")).toBe(href)
    },
  )

  it.each([
    "/preview/projects/one/sub-vendor/conversations",
    "/preview/projects/one/owner/conversations/channel/meeting",
    "/preview/projects/one/owner/conversations/%ZZ",
    "/preview/projects/one/owner/warranty",
    "https://example.com/preview/projects/one/owner/conversations/channel",
    "//example.com/preview/projects/one/owner/conversations/channel",
  ])("leaves unrelated or invalid notification links unchanged: %s", (href) => {
    expect(recipientNotificationHref(href, "admin")).toBe(href)
  })
})
