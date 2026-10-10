import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { isPublicPath } from "@/lib/public-paths"

// Scheduled jobs call these routes without a session; they authenticate with
// a signature instead, so the sign-in middleware must let them through.
describe("scheduled maintenance routes", () => {
  const source = readFileSync(resolve(process.cwd(), "custom-worker.ts"), "utf8")
  const targets = [...source.matchAll(/"(\/api\/operations\/[^"]+)"/g)].map((match) => match[1] ?? "")

  it("finds the scheduled targets", () => {
    expect(targets).toContain("/api/operations/staff-message-desk/stale-reminders")
  })

  it("are all reachable without a sign-in redirect", () => {
    for (const target of targets) expect(isPublicPath(target), target).toBe(true)
  })
})
