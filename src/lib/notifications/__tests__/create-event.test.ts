import { describe, expect, it } from "vitest"

import {
  channelMessageNotificationDelivery,
  resolveNotificationDelivery,
} from "@/lib/notifications/delivery"

describe("notification delivery", () => {
  it("uses native push for direct messages without changing project-channel delivery", () => {
    expect(
      channelMessageNotificationDelivery(
        "direct-0123456789abcdef0123456789abcdef"
      )
    ).toEqual({ inApp: true, email: false, push: true })
    expect(channelMessageNotificationDelivery("project-channel-1")).toEqual({
      inApp: true,
      email: false,
      push: false,
    })
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
