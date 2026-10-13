import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/lib/sage/square-alert-recipients.ts", "utf8")

describe("Square alert recipients", () => {
  it("only alerts active members of the same organization", () => {
    expect(source).toContain("eq(organizationMembers.organizationId, organizationId)")
    expect(source).toContain("eq(users.isActive, true)")
  })

  it("never falls back to all staff for connection alerts", () => {
    expect(source).toContain('if (kind === "connection")')
    expect(source).toContain('"SQUARE_AUTH_NOTIFICATION_USER_ID"')
    expect(source).toContain(": []")
  })
})
