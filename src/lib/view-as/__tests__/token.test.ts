import { describe, expect, it } from "vitest"

import { signViewAsToken, verifyViewAsToken, type ViewAsTokenPayload } from "@/lib/view-as/token"

const SECRET = "a-test-secret-that-is-long-enough"
const NOW = 1_800_000_000

const payload: ViewAsTokenPayload = {
  v: 1,
  sid: "session-1",
  adminId: "admin-1",
  targetId: "owner-1",
  orgId: "org-1",
  iat: NOW,
  exp: NOW + 3600,
}

describe("View as token", () => {
  it("round-trips a signed session", async () => {
    const token = await signViewAsToken(payload, SECRET)
    expect(await verifyViewAsToken(token, SECRET, NOW + 10)).toEqual(payload)
  })

  it("refuses a changed payload (a swapped user id)", async () => {
    const token = await signViewAsToken(payload, SECRET)
    const [, signature] = token.split(".")
    const forged = btoa(JSON.stringify({ ...payload, targetId: "someone-else" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    expect(await verifyViewAsToken(`${forged}.${signature}`, SECRET, NOW + 10)).toBeNull()
  })

  it("refuses another secret, a plain user id and garbage", async () => {
    const token = await signViewAsToken(payload, SECRET)
    expect(await verifyViewAsToken(token, "another-secret-entirely-here", NOW + 10)).toBeNull()
    expect(await verifyViewAsToken("owner-1", SECRET, NOW + 10)).toBeNull()
    expect(await verifyViewAsToken("a.b.c", SECRET, NOW + 10)).toBeNull()
  })

  it("refuses an expired session unless exit asks to record its end", async () => {
    const token = await signViewAsToken(payload, SECRET)
    expect(await verifyViewAsToken(token, SECRET, NOW + 3600)).toBeNull()
    expect(await verifyViewAsToken(token, SECRET, NOW + 3600, { allowExpired: true })).toEqual(payload)
  })
})
