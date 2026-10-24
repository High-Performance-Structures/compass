import { describe, expect, it } from "vitest"

import { selectCurrentOwnerVisibleDocuments } from "@/lib/owner-updates/external-projection"

describe("owner-update published document authorization", () => {
  it("keeps only currently approved owner-visible rows in snapshot order", () => {
    const documents = selectCurrentOwnerVisibleDocuments(
      ["revoked", "approved", "missing"],
      [
        { id: "approved", reviewStatus: "approved", ownerVisible: true },
        { id: "revoked", reviewStatus: "rejected", ownerVisible: true },
      ]
    )

    expect(documents.map((document) => document.id)).toEqual(["approved"])
  })
})
