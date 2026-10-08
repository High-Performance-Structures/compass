import { describe, expect, it } from "vitest"

import { sageClientLinkReviewIds } from "@/lib/sage/client-link-review"

describe("Sage client link review", () => {
  it("holds both a number-only import and a same-name Compass row", () => {
    const reviewIds = sageClientLinkReviewIds([
      { id: "compass", name: " Shared Client ", sageClientId: null, sageClientNumber: null },
      { id: "sage", name: "shared client", sageClientId: null, sageClientNumber: "100" },
    ])
    expect([...reviewIds].sort()).toEqual(["compass", "sage"])
  })

  it("allows an exact two-key Sage link and an unrelated local client", () => {
    const reviewIds = sageClientLinkReviewIds([
      { id: "verified", name: "Shared Client", sageClientId: "guid-100", sageClientNumber: "100" },
      { id: "other", name: "Other Client", sageClientId: null, sageClientNumber: null },
    ])
    expect([...reviewIds]).toEqual([])
  })

  it("holds an unlinked same-name row even beside a verified Sage row", () => {
    const reviewIds = sageClientLinkReviewIds([
      { id: "verified", name: "Shared Client", sageClientId: "guid-100", sageClientNumber: "100" },
      { id: "unlinked", name: "Shared Client", sageClientId: null, sageClientNumber: null },
    ])
    expect([...reviewIds]).toEqual(["unlinked"])
  })
})
