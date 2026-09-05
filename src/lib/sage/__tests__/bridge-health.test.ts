import { describe, expect, it } from "vitest"

import {
  isSageBridgeHeartbeatOnline,
  recoveredSageBridgeRecipientIds,
  SAGE_BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS,
} from "@/lib/sage/bridge-health"

describe("Sage bridge heartbeat health", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z")

  it("accepts a recent authenticated heartbeat", () => {
    const lastSeenAt = new Date(
      now - SAGE_BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS
    ).toISOString()
    expect(isSageBridgeHeartbeatOnline(lastSeenAt, now)).toBe(true)
  })

  it("marks missing, stale, invalid, and future heartbeats offline", () => {
    expect(isSageBridgeHeartbeatOnline(null, now)).toBe(false)
    expect(isSageBridgeHeartbeatOnline("not-a-date", now)).toBe(false)
    expect(
      isSageBridgeHeartbeatOnline(
        new Date(
          now - SAGE_BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS - 1
        ).toISOString(),
        now
      )
    ).toBe(false)
    expect(
      isSageBridgeHeartbeatOnline(new Date(now + 1).toISOString(), now)
    ).toBe(false)
  })

  it("selects only active incident recipients for recovered bridge IDs", () => {
    expect(
      recoveredSageBridgeRecipientIds(
        [
          {
            recipientId: "client-recipient",
            sourceId: "client-project-writer:2026-09-05T12:30:49.652Z",
          },
          {
            recipientId: "pay-recipient",
            sourceId: "pay-application-poller:2026-09-05T12:30:49.029Z",
          },
          { recipientId: "unrelated", sourceId: "another-service:outage" },
          { recipientId: "missing-source", sourceId: null },
        ],
        [
          {
            id: "client-project-writer",
            lastSeenAt: "2026-09-05T14:07:21.635Z",
          },
        ]
      )
    ).toEqual(["client-recipient"])
  })

  it("does not resolve an incident without a strictly newer heartbeat", () => {
    const sourceId = "client-project-writer:2026-09-05T14:07:21.635Z"
    expect(
      recoveredSageBridgeRecipientIds(
        [{ recipientId: "same-heartbeat", sourceId }],
        [
          {
            id: "client-project-writer",
            lastSeenAt: "2026-09-05T14:07:21.635Z",
          },
        ]
      )
    ).toEqual([])
  })
})
