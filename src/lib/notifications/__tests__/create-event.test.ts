import { describe, expect, it } from "vitest"

import {
  channelMessageNotificationDelivery,
  resolveNotificationDelivery,
} from "@/lib/notifications/delivery"

describe("notification delivery", () => {
  it("uses native push for direct messages without changing project-channel delivery", () => {
    expect(
      channelMessageNotificationDelivery(
        {
          id: "direct-0123456789abcdef0123456789abcdef",
          audience: "direct",
          isPrivate: true,
          projectId: null,
          description: "Private direct message",
        }
      )
    ).toEqual({ inApp: true, email: false, push: true })
    expect(
      channelMessageNotificationDelivery({
        id: "project-channel-1",
        audience: "staff",
        isPrivate: false,
        projectId: "project-1",
        description: null,
      })
    ).toEqual({
      inApp: true,
      email: false,
      push: false,
    })
  })

  it("uses native push for legacy mobile direct conversations", () => {
    expect(
      channelMessageNotificationDelivery({
        id: "legacy-channel-uuid",
        audience: "staff",
        isPrivate: true,
        projectId: null,
        description: "Direct conversation",
      })
    ).toEqual({ inApp: true, email: false, push: true })
  })

  it("keeps ordinary channel messages in the notification bell", () => {
    expect(
      resolveNotificationDelivery(
        {
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: true,
        },
        {
          inApp: true,
          email: false,
          push: false,
        }
      )
    ).toEqual({
      inApp: true,
      email: false,
      push: false,
    })
  })

  it("honors a recipient's disabled delivery preferences", () => {
    expect(
      resolveNotificationDelivery(
        {
          inAppEnabled: true,
          emailEnabled: false,
          pushEnabled: false,
        },
        {
          inApp: true,
          email: true,
          push: true,
        }
      )
    ).toEqual({
      inApp: true,
      email: false,
      push: false,
    })
  })
})
