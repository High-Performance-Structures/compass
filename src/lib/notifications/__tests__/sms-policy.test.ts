import { describe, expect, it } from "vitest"

import {
  isDuringSmsQuietHours,
  isValidSmsQuietHoursTime,
  shouldSendSmsNotification,
  shouldUseProjectActivitySmsRoute,
  type SmsPolicyPreferences,
} from "@/lib/notifications/sms-policy"
import { SMS_OPT_IN_DISCLOSURE_VERSION } from "@/lib/notifications/sms-consent"

const ENABLED_PREFERENCES: SmsPolicyPreferences = {
  smsEnabled: true,
  smsPhoneNumber: "+17195550123",
  smsConsentAccepted: true,
  smsConsentDisclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
  smsConsentPhoneNumber: "+17195550123",
  mentionSmsEnabled: true,
  announcementSmsEnabled: true,
  projectActivitySmsEnabled: true,
  smsQuietHoursEnabled: false,
  smsQuietHoursStart: "21:00",
  smsQuietHoursEnd: "07:00",
  timeZone: "America/Denver",
}

describe("SMS notification policy", () => {
  it("allows opted-in live project messages", () => {
    expect(
      shouldSendSmsNotification(ENABLED_PREFERENCES, {
        eventType: "message.channel",
        createdBy: "sender",
        occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      })
    ).toBe(true)
  })

  it("blocks imported or replayed project messages without a live actor", () => {
    expect(
      shouldSendSmsNotification(ENABLED_PREFERENCES, {
        eventType: "message.channel",
        createdBy: null,
        occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      })
    ).toBe(false)
  })

  it("routes live warranty updates through project activity consent", () => {
    expect(
      shouldSendSmsNotification(ENABLED_PREFERENCES, {
        eventType: "warranty.updated",
        createdBy: "project-manager",
        occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      })
    ).toBe(true)
    expect(
      shouldSendSmsNotification(ENABLED_PREFERENCES, {
        eventType: "warranty.created",
        createdBy: null,
        occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      })
    ).toBe(false)
  })

  it("requires current consent and the matching category preference", () => {
    expect(
      shouldSendSmsNotification(
        {
          ...ENABLED_PREFERENCES,
          smsConsentPhoneNumber: "+17195550999",
        },
        {
          eventType: "message.channel",
          createdBy: "sender",
          occurredAt: new Date("2026-07-30T18:00:00.000Z"),
        }
      )
    ).toBe(false)
    expect(
      shouldSendSmsNotification(
        {
          ...ENABLED_PREFERENCES,
          projectActivitySmsEnabled: false,
        },
        {
          eventType: "message.thread_reply",
          createdBy: "sender",
          occurredAt: new Date("2026-07-30T18:00:00.000Z"),
        }
      )
    ).toBe(false)
  })

  it("honors overnight quiet hours in the user's timezone", () => {
    const quietPreferences = {
      ...ENABLED_PREFERENCES,
      smsQuietHoursEnabled: true,
    }
    expect(
      isDuringSmsQuietHours(
        quietPreferences,
        new Date("2026-07-31T04:30:00.000Z")
      )
    ).toBe(true)
    expect(
      isDuringSmsQuietHours(
        quietPreferences,
        new Date("2026-07-30T18:00:00.000Z")
      )
    ).toBe(false)
  })

  it("validates quiet-hour values and fails closed on invalid data", () => {
    expect(isValidSmsQuietHoursTime("07:30")).toBe(true)
    expect(isValidSmsQuietHoursTime("25:00")).toBe(false)
    expect(
      isDuringSmsQuietHours(
        {
          ...ENABLED_PREFERENCES,
          smsQuietHoursEnabled: true,
          smsQuietHoursStart: "invalid",
        },
        new Date("2026-07-30T18:00:00.000Z")
      )
    ).toBe(true)
  })

  it("routes mentions and announcements only through their specific SMS preferences", () => {
    expect(
      shouldUseProjectActivitySmsRoute({
        channelType: "announcement",
        recipientUserId: "recipient",
        mentions: [],
      })
    ).toBe(false)
    expect(
      shouldUseProjectActivitySmsRoute({
        channelType: "text",
        recipientUserId: "recipient",
        mentions: [
          {
            mentionType: "user",
            targetId: "recipient",
          },
        ],
      })
    ).toBe(false)
    expect(
      shouldUseProjectActivitySmsRoute({
        channelType: "text",
        recipientUserId: "recipient",
        mentions: [
          {
            mentionType: "user",
            targetId: "someone-else",
          },
        ],
      })
    ).toBe(true)
  })
})
