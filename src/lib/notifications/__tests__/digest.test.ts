import { describe, expect, it } from "vitest"

import { DEFAULT_NOTIFICATION_DIGEST_SETTINGS } from "@/lib/feature-settings/notification-digest-settings"
import {
  digestEmailText,
  digestSubject,
  holdsForDigest,
  instantKindOf,
  latestDigestCutoff,
} from "@/lib/notifications/digest"

describe("notification digest", () => {
  it("sorts notices into instant kinds or changes", () => {
    expect(instantKindOf("message.mention")).toBe("conversations")
    expect(instantKindOf("announcement.message")).toBe("conversations")
    expect(instantKindOf("esign.signed")).toBe("signatures")
    expect(instantKindOf("schedule.confirmation_reminder")).toBe("confirmations")
    expect(instantKindOf("schedule.declined")).toBe("confirmations")
    expect(instantKindOf("staff_message.assigned")).toBe("assignments")
    expect(instantKindOf("square_auth.failed")).toBe("system_alerts")
    expect(instantKindOf("schedule.end_date_extended")).toBeNull()
    expect(instantKindOf("schedule.assigned")).toBeNull()
    expect(instantKindOf("rfi.updated")).toBeNull()
  })

  it("holds changes, sends instant kinds right away, and respects opt-outs", () => {
    const settings = DEFAULT_NOTIFICATION_DIGEST_SETTINGS
    expect(holdsForDigest(settings, "schedule.end_date_extended", false)).toBe(true)
    expect(holdsForDigest(settings, "message.mention", false)).toBe(false)
    expect(holdsForDigest(settings, "schedule.end_date_extended", true)).toBe(false)
    expect(holdsForDigest({ ...settings, mode: "off" }, "rfi.updated", false)).toBe(false)
    expect(holdsForDigest({ ...settings, instantKinds: [] }, "message.mention", false)).toBe(true)
  })

  it("finds the latest digest time at or before now", () => {
    const times = ["17:00", "12:00"]
    expect(latestDigestCutoff(times, "2026-11-09", "11:59")).toBe("2026-11-08 17:00")
    expect(latestDigestCutoff(times, "2026-11-09", "12:00")).toBe("2026-11-09 12:00")
    expect(latestDigestCutoff(times, "2026-11-09", "16:45")).toBe("2026-11-09 12:00")
    expect(latestDigestCutoff(times, "2026-11-09", "23:15")).toBe("2026-11-09 17:00")
    // A notice at 12:00 itself waits for 5 pm; one at 11:59 is in the noon digest.
    expect("2026-11-09 11:59" < latestDigestCutoff(times, "2026-11-09", "12:00")).toBe(true)
    expect("2026-11-09 12:00" < latestDigestCutoff(times, "2026-11-09", "12:00")).toBe(false)
  })

  it("writes one summary grouped by project", () => {
    const text = digestEmailText(
      [
        { title: "Schedule end date extended", body: "Moved to Dec 10.", link: "https://c.test/a", projectLabel: "O-197 - Litten" },
        { title: "RFI updated", body: "Answer added.", link: "https://c.test/b", projectLabel: "O-58 - Forest Lakes" },
        { title: "Framing assigned", body: "Starts Monday.", link: "https://c.test/c", projectLabel: "O-197 - Litten" },
      ],
      "https://c.test/dashboard"
    )
    expect(text.startsWith("3 updates since the last summary.")).toBe(true)
    expect(text.indexOf("Framing assigned")).toBeLessThan(text.indexOf("O-58 - Forest Lakes"))
    expect(digestSubject(3, 2)).toBe("Compass summary: 3 updates on 2 projects")
    expect(digestSubject(1, 1)).toBe("Compass summary: 1 update")
  })
})
