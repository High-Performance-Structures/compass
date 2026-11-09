import { describe, expect, it } from "vitest"

import {
  formatCountdown,
  MIN_LATE_NOTICE_MS,
  OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS,
  parseServerVersionInfo,
  remainingMs,
  shouldKeepOldVersion,
  UPDATE_COUNTDOWN_MS,
  updateDeadline,
  versionOverrideHeaderValue,
} from "@/lib/deployment/update-window"

const LIVE_AT = "2026-11-09T18:00:00.000Z"
const liveAtMs = Date.parse(LIVE_AT)

describe("updateDeadline", () => {
  it("counts down two minutes from when the new version went live", () => {
    const serverNow = new Date(liveAtMs + 20_000).toISOString()
    const receivedAt = 5_000_000
    expect(updateDeadline({ liveAt: LIVE_AT, serverNow }, receivedAt)).toBe(
      receivedAt + UPDATE_COUNTDOWN_MS - 20_000
    )
  })

  it("gives two tabs with different clocks the same remaining time", () => {
    const serverNow = new Date(liveAtMs + 45_000).toISOString()
    const tabA = updateDeadline({ liveAt: LIVE_AT, serverNow }, 1_000)
    const tabB = updateDeadline({ liveAt: LIVE_AT, serverNow }, 9_999_000)
    expect(remainingMs(tabA, 1_000)).toBe(remainingMs(tabB, 9_999_000))
  })

  it("gives a tab that notices late at least the minimum notice", () => {
    const serverNow = new Date(liveAtMs + UPDATE_COUNTDOWN_MS + 60_000).toISOString()
    expect(updateDeadline({ liveAt: LIVE_AT, serverNow }, 100)).toBe(
      100 + MIN_LATE_NOTICE_MS
    )
  })

  it("never shows more than the full countdown, even with a skewed liveAt", () => {
    const serverNow = new Date(liveAtMs - 10 * 60_000).toISOString()
    expect(updateDeadline({ liveAt: LIVE_AT, serverNow }, 0)).toBe(UPDATE_COUNTDOWN_MS)
  })

  it("falls back to the full countdown when the server sends no live time", () => {
    expect(updateDeadline({ liveAt: null, serverNow: LIVE_AT }, 0)).toBe(
      UPDATE_COUNTDOWN_MS
    )
  })
})

describe("countdown display", () => {
  it("formats minutes and seconds, rounding up", () => {
    expect(formatCountdown(UPDATE_COUNTDOWN_MS)).toBe("2:00")
    expect(formatCountdown(65_001)).toBe("1:06")
    expect(formatCountdown(500)).toBe("0:01")
    expect(formatCountdown(-5)).toBe("0:00")
  })
})

describe("old version routing", () => {
  it("keeps the old version through the countdown plus the grace period", () => {
    expect(shouldKeepOldVersion(null, 0)).toBe(true)
    expect(shouldKeepOldVersion(1_000, 1_000)).toBe(true)
    expect(
      shouldKeepOldVersion(1_000, 1_000 + OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS)
    ).toBe(false)
  })

  it("builds Cloudflare's override header and rejects odd values", () => {
    expect(versionOverrideHeaderValue("compass", "436b6184-7069-46e9-ba7c-e18fda11a9b1")).toBe(
      'compass="436b6184-7069-46e9-ba7c-e18fda11a9b1"'
    )
    expect(versionOverrideHeaderValue("compass", 'x", other="y')).toBeNull()
    expect(versionOverrideHeaderValue("Compass Worker", "436b6184")).toBeNull()
  })
})

describe("parseServerVersionInfo", () => {
  it("reads the version check answer", () => {
    expect(
      parseServerVersionInfo({
        deploymentId: "dep-2",
        versionId: "abc12345",
        workerName: "compass",
        liveAt: LIVE_AT,
        serverNow: LIVE_AT,
      })
    ).toEqual({
      deploymentId: "dep-2",
      versionId: "abc12345",
      workerName: "compass",
      liveAt: LIVE_AT,
      serverNow: LIVE_AT,
    })
  })

  it("accepts the older answer shape and rejects junk", () => {
    expect(parseServerVersionInfo({ deploymentId: "dep-1" })?.versionId).toBeNull()
    expect(parseServerVersionInfo({})).toBeNull()
    expect(parseServerVersionInfo("dep")).toBeNull()
  })
})
