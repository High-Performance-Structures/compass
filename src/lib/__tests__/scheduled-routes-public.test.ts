import { describe, expect, it } from "vitest"
import { SCHEDULED_JOBS } from "@/lib/operations/schedule"
import { isPublicPath } from "@/lib/public-paths"

// Scheduled jobs call these routes without a session; they authenticate with
// a signature instead, so the sign-in middleware must let them through.
describe("scheduled maintenance routes", () => {
  const targets = SCHEDULED_JOBS.map((job) => job.path)

  it("finds the scheduled targets", () => {
    expect(targets).toContain("/api/operations/staff-message-desk/stale-reminders")
  })

  it("are all reachable without a sign-in redirect", () => {
    for (const target of targets) expect(isPublicPath(target), target).toBe(true)
  })
})
