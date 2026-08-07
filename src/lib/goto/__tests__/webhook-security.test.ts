import { describe, expect, it } from "vitest"

import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import {
  constantTimeSecretMatch,
  gotoMessageMatchesConfig,
  gotoWebhookConfig,
} from "@/lib/goto/webhook-security"

const message: GotoInboundMessage = {
  eventId: "event-1",
  accountKey: "account-1",
  messageId: "message-1",
  conversationId: "conversation-1",
  ownerTouchpoint: "+1 (719) 900-8850",
  senderPhone: "+17195550123",
  body: "[Daily Log] O-210-33 Framing complete",
  receivedAt: "2026-08-06T20:00:00.000Z",
  attachments: [],
}

describe("GoTo webhook security", () => {
  it("requires all durable webhook configuration", () => {
    expect(gotoWebhookConfig({})).toBeNull()
    expect(
      gotoWebhookConfig({
        GOTO_WEBHOOK_SECRET: "secret",
        JARVIS_BRIDGE_ORGANIZATION_ID: "org-1",
      })
    ).toMatchObject({
      secret: "secret",
      organizationId: "org-1",
    })
  })

  it("compares the callback secret without an early content mismatch", () => {
    expect(constantTimeSecretMatch("correct-secret", "correct-secret")).toBe(true)
    expect(constantTimeSecretMatch("correct-secret", "wrong--secret")).toBe(false)
    expect(constantTimeSecretMatch("correct-secret", null)).toBe(false)
  })

  it("accepts only the configured account and Compass receiving numbers", () => {
    const config = gotoWebhookConfig({
      GOTO_WEBHOOK_SECRET: "secret",
      JARVIS_BRIDGE_ORGANIZATION_ID: "org-1",
      GOTO_SMS_HPS_FROM_NUMBER: "+17199008850",
    })
    expect(config).not.toBeNull()
    if (!config) return

    expect(gotoMessageMatchesConfig(message, config, "account-1")).toBe(true)
    expect(
      gotoMessageMatchesConfig(
        { ...message, accountKey: "other-account" },
        config,
        "account-1"
      )
    ).toBe(false)
    expect(
      gotoMessageMatchesConfig(
        { ...message, ownerTouchpoint: "+17195550000" },
        config,
        "account-1"
      )
    ).toBe(false)
  })
})
