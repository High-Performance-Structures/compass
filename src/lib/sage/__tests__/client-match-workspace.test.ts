import { describe, expect, it } from "vitest"
import {
  canVerifyClientPair,
  compassClientRows,
  isImportedSageClient,
  searchClientMatchRows,
} from "@/lib/sage/client-match-workspace"

const rows = [
  { id: "compass-a", name: "Amaroo LLC", email: null, primaryEmail: null, sageClientId: null, sageClientNumber: null },
  { id: "sage-customer-org-2876", name: "Chris & Heather Squires", email: null, primaryEmail: null, sageClientId: null, sageClientNumber: "2876" },
  { id: "compass-b", name: "Other Client", email: "owner@example.com", primaryEmail: null, sageClientId: "sage-id", sageClientNumber: "42" },
] as const

describe("client matching lists", () => {
  it("keeps imported number candidates off the Compass side without hiding verified Compass clients", () => {
    expect(compassClientRows(rows).map((row) => row.id)).toEqual(["compass-a", "compass-b"])
    expect(isImportedSageClient(rows[1])).toBe(true)
    expect(isImportedSageClient(rows[2])).toBe(false)
  })

  it("searches either name, email or Sage number and limits rendered results", () => {
    expect(searchClientMatchRows(rows, "2876").matches.map((row) => row.id))
      .toEqual(["sage-customer-org-2876"])
    expect(searchClientMatchRows(compassClientRows(rows), "owner@example.com").total).toBe(1)
    expect(searchClientMatchRows(rows, "", 1)).toEqual({ matches: [rows[0]], total: 3 })
  })

  it("allows verification of the selected client's unverified number, never another client's claim", () => {
    const unverified = { ...rows[0], sageClientNumber: "2876" }
    const sage = { sageRecordId: "sage-guid", sageClientNumber: "2876", claimCount: 1,
      claimedBy: { id: unverified.id } }
    expect(canVerifyClientPair(unverified, sage)).toBe(true)
    expect(canVerifyClientPair(rows[1], sage)).toBe(false)
    expect(canVerifyClientPair(unverified, { ...sage, claimCount: 2, claimedBy: null })).toBe(false)
    expect(canVerifyClientPair(rows[2], { ...sage, sageClientNumber: "42", claimedBy: { id: rows[2].id } })).toBe(false)
  })
})
