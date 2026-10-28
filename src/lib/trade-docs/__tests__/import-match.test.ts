import { describe, expect, it } from "vitest"

import {
  certificateDates,
  detectDocTypes,
  findDates,
  matchVendor,
  proposeImports,
  vendorPartOfFileName,
  type DriveFileForImport,
} from "@/lib/trade-docs/import-match"
import { DEFAULT_TRADE_DOC_TYPES } from "@/lib/trade-docs/settings"

const vendors = [
  { id: "fox", name: "Fox Excavation LLC" },
  { id: "summit", name: "Summit Concrete" },
  { id: "dte", name: "Down to Earth Excavation" },
  { id: "kent", name: "Kent Glass" },
  { id: "glaser", name: "Glaser Steel" },
  { id: "best", name: "Best Drywall, LLC" },
  { id: "direct", name: "Direct Electric, LLC" },
  { id: "lamb", name: "Lamb Plumbing & Excavating Inc" },
  { id: "aslan-corp", name: "Aslan Corporation" },
  { id: "aslan-design", name: "Aslan Design Management Inc." },
]

function file(name: string, folderPath: readonly string[] = [], id = name): DriveFileForImport {
  return { id, name, mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", webUrl: null, folderPath }
}

describe("findDates and certificateDates", () => {
  it("reads the date styles used in file names", () => {
    expect(findDates("GL2-10-26").map((d) => d.date)).toEqual(["2026-02-10"])
    expect(findDates("Groninger Concrete 10.1.24").map((d) => d.date)).toEqual(["2024-10-01"])
    expect(findDates("Advantage Tile Work LLC GL24Mar2027").map((d) => d.date)).toEqual(["2027-03-24"])
  })

  it("splits general liability and workers' comp dates", () => {
    expect(certificateDates("Fox Excavation LLC GL5-01-2026WC10-01-2026.pdf")).toMatchObject({ gl: "2026-05-01", wc: "2026-10-01" })
    expect(certificateDates("Brundage Bone Concrete Pumping GLWC3-18-2026.pdf")).toMatchObject({ gl: "2026-03-18", wc: "2026-03-18" })
    expect(certificateDates("Elk Horn Painting GL WC 8-1-2026.pdf")).toMatchObject({ gl: "2026-08-01", wc: "2026-08-01" })
    expect(certificateDates("Lamb Plumbing & Excavating Inc WC6-1-2026GL8-15-2026.pdf")).toMatchObject({ gl: "2026-08-15", wc: "2026-06-01" })
    expect(certificateDates("GPFraming-WC1-1-26-LIAB1-7-26.pdf")).toMatchObject({ gl: "2026-01-07", wc: "2026-01-01" })
    expect(certificateDates("Eco-Insulutions-Builder Services Group, Inc WCGL6-30-26.pdf")).toMatchObject({ gl: "2026-06-30", wc: "2026-06-30" })
    // "Glass" and "Auto" aren't certificate labels.
    expect(certificateDates("Kent Glass COI GL6-06-2026WC3-01-2027.pdf")).toMatchObject({ gl: "2026-06-06", wc: "2027-03-01" })
    expect(certificateDates("Apex Radon Auto 7-11-2027.pdf")).toMatchObject({ gl: null, wc: null })
  })
})

describe("matchVendor and vendorPartOfFileName", () => {
  it("finds the vendor in squashed and suffixed names", () => {
    expect(vendorPartOfFileName("Down to Earth ExcavationGL9-06-2026WC7-01-2026.pdf")).toBe("Down to Earth Excavation")
    expect(matchVendor(vendorPartOfFileName("SummitConcGL6-12-2026.pdf"), vendors)?.vendor.id).toBe("summit")
    expect(matchVendor(vendorPartOfFileName("Fox Excavation W9.pdf"), vendors)?.vendor.id).toBe("fox")
    expect(matchVendor(vendorPartOfFileName("Kent Glass COI GL6-06-2026WC3-01-2027.pdf"), vendors)?.vendor.id).toBe("kent")
    expect(matchVendor(vendorPartOfFileName("Glaser GL2-4-2026WC2-24-2026.pdf"), vendors)?.vendor.id).toBe("glaser")
    expect(matchVendor("Best Drywall, LLC", vendors)?.score).toBe(100)
    expect(matchVendor(vendorPartOfFileName("Aslan Corporation WC8-01-2026.pdf"), vendors)?.vendor.id).toBe("aslan-corp")
  })

  it("matches nothing for unrelated names", () => {
    expect(matchVendor("fw9", vendors)).toBeNull()
  })
})

describe("detectDocTypes", () => {
  it("recognizes each kind of document", () => {
    const ids = (name: string) => detectDocTypes(name, DEFAULT_TRADE_DOC_TYPES).map((d) => `${d.docType}${d.kind === "waiver" ? "*" : ""}`)
    expect(ids("Info Sheet and W-9.pdf")).toEqual(["w9", "info-sheet"])
    expect(ids("Subcontractor Trade Agreement - Signed.pdf")).toEqual(["trade-agreement"])
    expect(ids("ASF Engineering, LLC Declaration of Independent Contractor.pdf")).toEqual(["wc-certificate*"])
    expect(ids("Down to Earth Business License 11_2024-11_2025.pdf")).toEqual(["business-license"])
    expect(ids("COI Best Drywall LLc for High Performance Structures inc (002).pdf")).toEqual(["gl-certificate"])
  })
})

describe("proposeImports", () => {
  it("uses the vendor folder name and picks the signed agreement", () => {
    const proposals = proposeImports({
      files: [
        file("Trade Contractor Agreement - 2019.docx", ["Direct Electric, LLC"]),
        file("Subcontractor Trade Agreement - Signed.pdf", ["Direct Electric, LLC"]),
        file("Subcontractor Info Sheet - SIgned.pdf", ["Direct Electric, LLC"]),
        file("Declaration of Independent.pdf", ["Direct Electric, LLC"]),
      ],
      layout: "vendor-folders",
      defaultDocType: null,
      vendors,
      docTypes: DEFAULT_TRADE_DOC_TYPES,
      alreadyRecorded: new Set(),
    })
    expect(proposals.filter((p) => p.selected).map((p) => [p.fileName, p.docType, p.kind])).toEqual([
      ["Subcontractor Trade Agreement - Signed.pdf", "trade-agreement", "document"],
      ["Subcontractor Info Sheet - SIgned.pdf", "info-sheet", "document"],
      ["Declaration of Independent.pdf", "wc-certificate", "waiver"],
    ])
    expect(proposals.every((p) => p.vendorId === "direct")).toBe(true)
  })

  it("keeps the latest certificate per vendor and type across year folders", () => {
    const proposals = proposeImports({
      files: [
        file("Fox Excavation LLC GL5-01-2026WC10-01-2026.pdf", ["2026 Expiration"], "a"),
        file("Fox Excavation LLC GL5-01-2027.pdf", ["2027 Expiration"], "b"),
        file("Mystery Co GL1-1-2027.pdf", ["2027 Expiration"], "c"),
      ],
      layout: "file-names",
      defaultDocType: null,
      vendors,
      docTypes: DEFAULT_TRADE_DOC_TYPES,
      alreadyRecorded: new Set(["already"]),
    })
    const selected = proposals.filter((p) => p.selected).map((p) => [p.fileId, p.docType, p.expiresOn])
    expect(selected).toEqual([
      ["a", "wc-certificate", "2026-10-01"],
      ["b", "gl-certificate", "2027-05-01"],
    ])
    expect(proposals.find((p) => p.fileId === "c")?.note).toBe("No vendor matched")
  })

  it("applies the folder's document type when the name doesn't say", () => {
    const proposals = proposeImports({
      files: [file("Arlun.pdf"), file("already.pdf", [], "already")],
      layout: "file-names",
      defaultDocType: "w9",
      vendors: [{ id: "arlun", name: "Arlun Inc" }],
      docTypes: DEFAULT_TRADE_DOC_TYPES,
      alreadyRecorded: new Set(["already"]),
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ vendorId: "arlun", docType: "w9", selected: true })
  })
})
