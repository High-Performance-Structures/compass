import { describe, expect, it } from "vitest"

import {
  companyEmailDomain,
  findDirectoryDuplicates,
  namesAreSimilar,
  normalizeDirectoryName,
  phoneDigits,
  type DirectoryCandidate,
} from "@/lib/sage/directory-add-duplicates"

const company = (overrides: Partial<DirectoryCandidate>): DirectoryCandidate => ({
  id: "c1", source: "compass", kind: "vendor_company", name: "Somebody", email: null, phone: null,
  parentId: null, parentName: null, sageNumber: null, ...overrides,
})

describe("directory names", () => {
  it("sets aside legal suffixes, punctuation, case and & / and", () => {
    expect(normalizeDirectoryName("Tri-City Drywall, Inc.")).toBe("tri city drywall")
    expect(normalizeDirectoryName("Smith & Sons LLC")).toBe(normalizeDirectoryName("smith and sons"))
    expect(normalizeDirectoryName("The Company")).toBe("the company")
  })

  it("treats one name inside another or a small spelling slip as similar", () => {
    expect(namesAreSimilar("Photon Brothers", "Photon Brothers Solar")).toBe(true)
    expect(namesAreSimilar("Tim Kulin Cabinetry", "Tim Kulin Cabinetery")).toBe(true)
    expect(namesAreSimilar("Zola Windows", "Zircon Container")).toBe(false)
  })

  it("ignores shared mail providers and compares the last ten phone digits", () => {
    expect(companyEmailDomain("amy@flatironsteel.com")).toBe("flatironsteel.com")
    expect(companyEmailDomain("someone@gmail.com")).toBeNull()
    expect(phoneDigits("+1 (719) 900-8850")).toBe(phoneDigits("719.900.8850"))
    expect(phoneDigits("12")).toBeNull()
  })
})

describe("findDirectoryDuplicates", () => {
  const subject = { kind: "vendor_company" as const, id: "new", name: "Photon Brothers LLC", email: "kaitlyn@photonbrothers.com", phone: "(303) 555-0100", parentId: null }

  it("blocks the same vendor name in Compass or Sage, and shows a client of that name to the approver", () => {
    const check = findDirectoryDuplicates(subject, [
      company({ id: "v1", name: "Photon Brothers" }),
      company({ id: "sage-9", source: "sage", name: "PHOTON BROTHERS, INC.", sageNumber: "9" }),
      company({ id: "sage-1", source: "sage", kind: "client_company", name: "photon brothers, inc.", sageNumber: "77" }),
    ])
    expect(check.exact.map((match) => match.id)).toEqual(["v1", "sage-9"])
    expect(check.close.map((match) => [match.id, match.reasons])).toEqual([["sage-1", ["same_name_other_list"]]])
  })

  it("passes close look-alikes on for the approver", () => {
    const check = findDirectoryDuplicates(subject, [
      company({ id: "solar", name: "Solar 4 Planet A", email: "kaitlyn@photonbrothers.com" }),
      company({ id: "other", name: "Other Co", email: "info@photonbrothers.com" }),
      company({ id: "phone", name: "Phone Match", phone: "303-555-0100" }),
      company({ id: "nothing", name: "Unrelated Supply" }),
    ])
    expect(check.exact).toEqual([])
    expect(Object.fromEntries(check.close.map((match) => [match.id, match.reasons]))).toEqual({
      solar: ["same_email"],
      other: ["same_domain"],
      phone: ["same_phone"],
    })
  })

  it("never matches the record with itself or a Sage row already linked in Compass", () => {
    const check = findDirectoryDuplicates({ ...subject, id: "v1" }, [
      company({ id: "v1", name: "Photon Brothers" }),
      company({ id: "v2", name: "Photon Brothers Solar", sageNumber: "12" }),
      company({ id: "sage-12", source: "sage", name: "Photon Brothers Solar", sageNumber: "12" }),
    ])
    expect(check.exact).toEqual([])
    expect(check.close.map((match) => match.id)).toEqual(["v2"])
  })

  it("blocks a person's name only at the same company", () => {
    const person = (overrides: Partial<DirectoryCandidate>): DirectoryCandidate =>
      company({ kind: "vendor_person", parentId: "vendor-a", parentName: "A", ...overrides })
    const check = findDirectoryDuplicates(
      { kind: "vendor_person", id: "p-new", name: "Jordan Zipfel", email: null, phone: null, parentId: "vendor-a" },
      [person({ id: "same-co", name: "Jordan Zipfel" }), person({ id: "other-co", name: "jordan zipfel", parentId: "vendor-b" }), company({ id: "co", name: "Jordan Zipfel" })]
    )
    expect(check.exact.map((match) => match.id)).toEqual(["same-co"])
    expect(check.close.map((match) => match.id)).toEqual(["other-co"])
  })
})
