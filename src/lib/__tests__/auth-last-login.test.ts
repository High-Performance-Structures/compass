import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn() }))
vi.mock("@workos-inc/authkit-nextjs", () => ({ signOut: vi.fn(), withAuth: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: vi.fn() }))

import { lastLoginIsStale } from "@/lib/auth"

describe("lastLoginIsStale", () => {
  const now = "2026-10-07T17:00:00.000Z"

  it("records a first login", () => {
    expect(lastLoginIsStale(null, now)).toBe(true)
  })

  it("skips the write within 15 minutes of the last one", () => {
    expect(lastLoginIsStale("2026-10-07T16:50:00.000Z", now)).toBe(false)
  })

  it("writes again after 15 minutes or for unreadable timestamps", () => {
    expect(lastLoginIsStale("2026-10-07T16:45:00.000Z", now)).toBe(true)
    expect(lastLoginIsStale("not a date", now)).toBe(true)
  })
})
