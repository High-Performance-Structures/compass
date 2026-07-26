import { describe, expect, it } from "vitest"

import { resolveNotificationDelivery } from "@/lib/notifications/delivery"

describe("notification delivery", () => {
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
