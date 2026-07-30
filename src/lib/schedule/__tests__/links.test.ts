import { describe, expect, it } from "vitest"

import {
  isScheduleLinkType,
  safeScheduleLinkHref,
} from "@/lib/schedule/links"

describe("schedule operational links", () => {
  it("accepts supported record types", () => {
    expect(isScheduleLinkType("file")).toBe(true)
    expect(isScheduleLinkType("rfi")).toBe(true)
    expect(isScheduleLinkType("invoice")).toBe(false)
  })

  it("accepts Compass dashboard and secure external links", () => {
    expect(
      safeScheduleLinkHref("/dashboard/projects/project-1/rfis")
    ).toBe("/dashboard/projects/project-1/rfis")
    expect(safeScheduleLinkHref("https://drive.google.com/file/1")).toBe(
      "https://drive.google.com/file/1"
    )
  })

  it("rejects unsafe and unrelated relative links", () => {
    expect(safeScheduleLinkHref("javascript:alert(1)")).toBeNull()
    expect(safeScheduleLinkHref("http://example.com/file")).toBeNull()
    expect(safeScheduleLinkHref("/preview/projects/project-1")).toBeNull()
  })
})
