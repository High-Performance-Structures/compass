import { afterEach, describe, expect, it, vi } from "vitest"

import {
  installRealtimeKitBrowserApiProxy,
  noteRealtimeKitDiagnostic,
} from "@/lib/realtimekit/browser-api-proxy"
import {
  LOG_FORWARD_INTERVAL_MS,
  URGENT_LOG_FORWARDS_PER_USER_PER_HOUR,
  URGENT_LOG_HEADER,
  URGENT_LOG_HEADER_VALUE,
  URGENT_LOG_UPLOADS_PER_FAILURE,
  URGENT_LOG_WINDOW_MS,
  isOfficeTalkFailureDiagnostic,
  isRealtimeKitLogUpload,
  isUrgentLogUpload,
  nextRoutineLogForwardAt,
  routineLogForwardDue,
  routineLogForwardStaleBefore,
  takeUrgentLogForward,
  takeUrgentLogTag,
  urgentLogStateAfterFailure,
} from "@/lib/realtimekit/log-upload-throttle"

const NOW = Date.parse("2026-11-09T18:00:00.000Z")
const HOUR = 60 * 60 * 1000

describe("RealtimeKit log upload throttle", () => {
  it("forwards logs about twice a day", () => {
    expect(LOG_FORWARD_INTERVAL_MS).toBe(12 * HOUR)
  })

  it("recognizes only the SDK's POST /logs upload", () => {
    expect(isRealtimeKitLogUpload("POST", ["logs"])).toBe(true)
    expect(isRealtimeKitLogUpload("post", ["logs"])).toBe(true)
    expect(isRealtimeKitLogUpload("GET", ["logs"])).toBe(false)
    expect(isRealtimeKitLogUpload("POST", ["v2", "logs"])).toBe(false)
    expect(isRealtimeKitLogUpload("POST", ["v2", "meetings", "m1", "active-transcript"])).toBe(false)
  })

  it("reads the urgent header", () => {
    expect(isUrgentLogUpload(new Headers({ [URGENT_LOG_HEADER]: URGENT_LOG_HEADER_VALUE }))).toBe(true)
    expect(isUrgentLogUpload(new Headers({ [URGENT_LOG_HEADER]: "yes" }))).toBe(false)
    expect(isUrgentLogUpload(new Headers())).toBe(false)
  })

  it("lets a routine upload through once per window", () => {
    expect(routineLogForwardDue(null, NOW)).toBe(true)
    expect(routineLogForwardDue("not a date", NOW)).toBe(true)
    const justNow = new Date(NOW - HOUR).toISOString()
    expect(routineLogForwardDue(justNow, NOW)).toBe(false)
    const longAgo = new Date(NOW - LOG_FORWARD_INTERVAL_MS).toISOString()
    expect(routineLogForwardDue(longAgo, NOW)).toBe(true)
  })

  it("reports when the window reopens", () => {
    expect(nextRoutineLogForwardAt(null, NOW)).toBe(NOW)
    expect(nextRoutineLogForwardAt(new Date(NOW - HOUR).toISOString(), NOW)).toBe(
      NOW - HOUR + LOG_FORWARD_INTERVAL_MS
    )
  })

  it("treats markers older than the window as stale (ISO order)", () => {
    const staleBefore = routineLogForwardStaleBefore(NOW)
    expect(new Date(NOW - 13 * HOUR).toISOString() < staleBefore).toBe(true)
    expect(new Date(NOW - 11 * HOUR).toISOString() < staleBefore).toBe(false)
  })

  it("caps urgent forwards per person per rolling hour", () => {
    const ledger = new Map<string, readonly number[]>()
    for (let i = 0; i < URGENT_LOG_FORWARDS_PER_USER_PER_HOUR; i += 1) {
      expect(takeUrgentLogForward(ledger, "u1", NOW + i)).toBe(true)
    }
    expect(takeUrgentLogForward(ledger, "u1", NOW + 10)).toBe(false)
    expect(takeUrgentLogForward(ledger, "u2", NOW + 10)).toBe(true)
    expect(takeUrgentLogForward(ledger, "u1", NOW + HOUR + 10)).toBe(true)
  })

  it("treats a failed open or connection as Office Talk not working", () => {
    expect(isOfficeTalkFailureDiagnostic("open-failed", {})).toBe(true)
    expect(isOfficeTalkFailureDiagnostic("socket-connection", { state: "failed" })).toBe(true)
    expect(isOfficeTalkFailureDiagnostic("media-connection", { transport: "send", state: "failed" })).toBe(true)
    expect(isOfficeTalkFailureDiagnostic("socket-connection", { state: "reconnecting" })).toBe(false)
    expect(isOfficeTalkFailureDiagnostic("client-error", { state: "failed" })).toBe(false)
  })

  it("tags a few uploads after a failure, inside the window only", () => {
    let state = urgentLogStateAfterFailure(NOW)
    let tagged = 0
    for (let i = 0; i < URGENT_LOG_UPLOADS_PER_FAILURE + 2; i += 1) {
      const tag = takeUrgentLogTag(state, NOW + 1000)
      if (tag.urgent) tagged += 1
      state = tag.next ?? { until: 0, remaining: 0 }
    }
    expect(tagged).toBe(URGENT_LOG_UPLOADS_PER_FAILURE)
    expect(takeUrgentLogTag(urgentLogStateAfterFailure(NOW), NOW + URGENT_LOG_WINDOW_MS).urgent).toBe(false)
    expect(takeUrgentLogTag(null, NOW).urgent).toBe(false)
  })
})

describe("browser proxy urgent log header", () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("adds the header to log uploads only after Office Talk fails", async () => {
    const seen: { readonly url: string; readonly urgent: string | null }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        urgent: new Headers(init?.headers).get(URGENT_LOG_HEADER),
      })
      return new Response(null, { status: 204 })
    })
    const uninstall = installRealtimeKitBrowserApiProxy()
    try {
      const init = { method: "POST", headers: { Authorization: "Bearer t" }, body: "{}" }
      await fetch("https://api.realtime.cloudflare.com/logs", init)
      noteRealtimeKitDiagnostic("open-failed", {})
      await fetch("https://api.realtime.cloudflare.com/v2/meetings", init)
      await fetch("https://api.realtime.cloudflare.com/logs", init)
    } finally {
      uninstall()
    }
    expect(seen).toEqual([
      { url: "/api/realtimekit/logs", urgent: null },
      { url: "/api/realtimekit/v2/meetings", urgent: null },
      { url: "/api/realtimekit/logs", urgent: URGENT_LOG_HEADER_VALUE },
    ])
  })
})
