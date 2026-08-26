import { describe, expect, it } from "vitest"

import {
  isSageBridgeHeartbeatOnline,
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
})
