import { describe, expect, it } from "vitest"
import { dailyLogDeleteBlocker } from "@/lib/daily-logs/delete-rules"

const log = { id: "log-1", logDate: "2026-10-08", authorId: "pat", reviewStatus: "needs_review", isClientVisible: false }
const base = { viewerId: "pat", canDeleteAny: false, canUpdate: true, ownerUpdates: [] }

describe("dailyLogDeleteBlocker", () => {
  it("lets the author delete their own unshared log", () => {
    expect(dailyLogDeleteBlocker(log, base)).toBeNull()
  })

  it("stops the author once the log is approved or owner visible", () => {
    expect(dailyLogDeleteBlocker({ ...log, reviewStatus: "approved" }, base)).toContain("Ask an admin")
    expect(dailyLogDeleteBlocker({ ...log, isClientVisible: true }, base)).toContain("Ask an admin")
  })

  it("stops other staff unless they can delete any log", () => {
    expect(dailyLogDeleteBlocker(log, { ...base, viewerId: "sam" })).toContain("Only an admin")
    expect(dailyLogDeleteBlocker({ ...log, reviewStatus: "approved" }, { ...base, viewerId: "sam", canDeleteAny: true })).toBeNull()
  })

  it("blocks any log an owner update uses, even for admins", () => {
    const ownerUpdates = [{ title: "Week 41 update", sourceDailyLogIds: JSON.stringify(["log-1"]) }]
    expect(dailyLogDeleteBlocker(log, { ...base, canDeleteAny: true, ownerUpdates })).toContain("Week 41 update")
  })
})
