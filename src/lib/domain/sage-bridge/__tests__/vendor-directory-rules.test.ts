import { describe, expect, it } from "vitest"

import { matchSageVendors, normalizeVendorName } from "@/lib/domain/sage-bridge/vendor-directory-rules"

const entry = (number: string, name: string, email: string | null = null) => ({ sageRecordId: `0000000${number}-0000-0000-0000-000000000000`, sageVendorNumber: number, name, email })
const vendor = (id: string, name: string, emails: (string | null)[] = [], sageRecordId: string | null = null) => ({ id, name, emails, sageRecordId })

describe("normalizeVendorName", () => {
  it("ignores case, punctuation and legal suffixes", () => {
    expect(normalizeVendorName("Acme Concrete, Inc.")).toBe("acme concrete")
    expect(normalizeVendorName("ACME CONCRETE LLC")).toBe("acme concrete")
    expect(normalizeVendorName("Smith & Sons Co")).toBe("smith and sons")
  })
})

describe("matchSageVendors", () => {
  it("links one-to-one name matches", () => {
    const matches = matchSageVendors([vendor("v1", "Acme Concrete Inc")], [entry("12", "ACME CONCRETE")])
    expect(matches).toEqual([expect.objectContaining({ vendorId: "v1", sageVendorNumber: "12", by: "name" })])
  })

  it("skips names that appear twice on either side", () => {
    expect(matchSageVendors([vendor("v1", "Acme"), vendor("v2", "Acme LLC")], [entry("12", "Acme")])).toEqual([])
    expect(matchSageVendors([vendor("v1", "Acme")], [entry("12", "Acme"), entry("13", "Acme Inc")])).toEqual([])
  })

  it("falls back to a unique shared email", () => {
    const matches = matchSageVendors([vendor("v1", "Peak Electric", ["Office@PeakElectric.com"])], [entry("40", "Peak Electrical Services", "office@peakelectric.com")])
    expect(matches).toEqual([expect.objectContaining({ vendorId: "v1", sageVendorNumber: "40", by: "email" })])
  })

  it("never offers vendors or Sage records that are already linked", () => {
    const linked = entry("12", "Acme")
    expect(matchSageVendors([vendor("v1", "Acme", [], linked.sageRecordId), vendor("v2", "Acme")], [linked])).toEqual([])
  })
})
