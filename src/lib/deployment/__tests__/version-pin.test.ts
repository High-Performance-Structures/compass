// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  pinTabToVersion,
  shouldTagRequest,
  unpinTabVersion,
} from "@/lib/deployment/version-pin"

const HEADER = "Cloudflare-Workers-Version-Overrides"

describe("version pin", () => {
  afterEach(() => unpinTabVersion())

  it("tags same-origin requests except the version check", () => {
    const origin = window.location.origin
    expect(shouldTagRequest(new URL("/dashboard", origin), origin)).toBe(true)
    expect(shouldTagRequest(new URL("/api/deployment-version", origin), origin)).toBe(false)
    expect(shouldTagRequest(new URL("https://example.com/x"), origin)).toBe(false)
    expect(shouldTagRequest(null, origin)).toBe(false)
  })

  it("adds the override header for the pinned version, and stops when unpinned", async () => {
    const seen: Array<string | null> = []
    const spy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get(HEADER))
      return new Response("ok")
    })
    window.fetch = spy
    pinTabToVersion("compass", "436b6184-7069-46e9-ba7c-e18fda11a9b1")

    await window.fetch("/dashboard", { headers: { "Next-Action": "abc" } })
    await window.fetch("/api/deployment-version")
    await window.fetch("https://example.com/other")
    unpinTabVersion()
    await window.fetch("/dashboard")

    expect(seen).toEqual([
      'compass="436b6184-7069-46e9-ba7c-e18fda11a9b1"',
      null,
      null,
      null,
    ])
    expect(spy).toHaveBeenCalledTimes(4)
  })
})
