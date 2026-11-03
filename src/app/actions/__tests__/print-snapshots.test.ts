import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-1", organizationId: null })) }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
// Any query fails the test: validation must turn these away before the database is used.
vi.mock("@/db", () => ({
  getDb: () =>
    new Proxy({}, { get: () => { throw new Error("no database in this test") } }),
}))

import { createPrintSnapshot } from "../print-snapshots"

const input = { projectId: null, kind: "schedule", title: "Schedule", documentNumber: null, html: "<p>x</p>" }

describe("createPrintSnapshot", () => {
  it("only saves the document kinds Print Preview knows how to render", async () => {
    expect(await createPrintSnapshot({ ...input, kind: "script" })).toEqual({
      success: false,
      error: "That document can't be previewed.",
    })
  })

  it("turns away empty and oversized documents before touching the database", async () => {
    expect(await createPrintSnapshot({ ...input, html: "" })).toMatchObject({ success: false })
    const huge = await createPrintSnapshot({ ...input, html: "x".repeat(1_500_001) })
    expect(huge).toMatchObject({ success: false, error: expect.stringContaining("too large") })
  })
})
