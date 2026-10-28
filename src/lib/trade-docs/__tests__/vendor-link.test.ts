import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { parseFeatureSettings } from "@/lib/feature-settings/registry"
import { buildInfoSheetPdf, pdfSafeText } from "@/lib/trade-docs/info-sheet-pdf"
import { tradeDocRequestHtml, tradeDocRequestText } from "@/lib/trade-docs/request-email"
import { DEFAULT_INFO_SHEET, DEFAULT_TRADE_DOC_TYPES, driveFileIdFromInput } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs } from "@/lib/trade-docs/status"
import {
  certificateHolderLines,
  checkInfoSheetAnswers,
  infoSheetAgent,
  tradeDocFileName,
  tradeDocLinkItemState,
  uploadedDriveFileId,
} from "@/lib/trade-docs/vendor-link"

const fields = DEFAULT_INFO_SHEET.fields

const goodAnswers = {
  "legal-name": "Fox Excavation LLC",
  address: "12 Main St\nWoodland Park, CO 80863",
  phone: "719-555-0100",
  email: "office@foxexc.com",
  entity: "LLC",
  "federal-id": "84-1234567",
  employees: "Yes",
  agency: "Peak Insurance",
  "agent-name": "Dana Ruiz",
  "agent-email": "Dana@PeakIns.com",
}

describe("checkInfoSheetAnswers", () => {
  it("accepts a complete sheet and finds the agent", () => {
    const result = checkInfoSheetAnswers(fields, goodAnswers)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.answers.find((answer) => answer.field.id === "dba")?.value).toBe("")
    expect(infoSheetAgent(result.answers)).toEqual({ name: "Dana Ruiz", email: "dana@peakins.com" })
  })

  it("asks for required answers and checks emails, phones and choices", () => {
    const { phone: _phone, ...missingPhone } = goodAnswers
    expect(checkInfoSheetAnswers(fields, missingPhone)).toEqual({ ok: false, error: 'Answer "Business telephone".' })
    expect(checkInfoSheetAnswers(fields, { ...goodAnswers, email: "not an email" })).toMatchObject({ ok: false })
    expect(checkInfoSheetAnswers(fields, { ...goodAnswers, phone: "12" })).toMatchObject({ ok: false })
    expect(checkInfoSheetAnswers(fields, { ...goodAnswers, entity: "Trust" })).toMatchObject({ ok: false })
    expect(checkInfoSheetAnswers(fields, { ...goodAnswers, employees: "Maybe" })).toMatchObject({ ok: false })
  })

  it("ignores fields that are turned off", () => {
    const off = fields.map((field) => (field.id === "federal-id" ? { ...field, active: false } : field))
    const { "federal-id": _taxId, ...rest } = goodAnswers
    const result = checkInfoSheetAnswers(off, { ...rest, "federal-id": "should be dropped" })
    expect(result.ok && result.answers.some((answer) => answer.field.id === "federal-id")).toBe(false)
  })

  it("has no agent without a usable email", () => {
    const result = checkInfoSheetAnswers(fields, { ...goodAnswers, "agent-email": "" })
    expect(result.ok && infoSheetAgent(result.answers)).toBeNull()
  })
})

describe("tradeDocLinkItemState", () => {
  const summary = summarizeTradeDocs({
    docTypes: DEFAULT_TRADE_DOC_TYPES,
    vendorCategory: "Subcontractor",
    docs: [
      { id: "a", docType: "w9", kind: "document", fileName: "w9.pdf", webUrl: null, effectiveOn: null, expiresOn: null, checks: [], notes: null, source: "import", createdAt: "2026-01-01", createdByName: "x" },
      { id: "b", docType: "gl-certificate", kind: "document", fileName: "gl.pdf", webUrl: null, effectiveOn: null, expiresOn: "2026-11-10", checks: [], notes: null, source: "import", createdAt: "2026-01-01", createdByName: "x" },
    ],
    today: "2026-10-28",
  })
  const line = (id: string) => {
    const found = summary.lines.find((item) => item.type.id === id)
    if (!found) throw new Error(id)
    return found
  }

  it("tells the vendor what's still needed", () => {
    expect(tradeDocLinkItemState(line("w9"), false)).toBe("on_file")
    expect(tradeDocLinkItemState(line("gl-certificate"), false)).toBe("renew")
    expect(tradeDocLinkItemState(line("wc-certificate"), false)).toBe("needed")
    expect(tradeDocLinkItemState(line("wc-certificate"), true)).toBe("received")
  })
})

describe("settings", () => {
  it("keeps a company's saved trade docs settings when new options are added", () => {
    // Saved before docs links existed: no forms, note, holder or info sheet.
    const saved = JSON.stringify({
      docTypes: DEFAULT_TRADE_DOC_TYPES.map(({ formLink: _form, waiverFormLink: _waiver, ...type }) => type),
      certificateChecks: ["Limits meet our minimums"],
      driveFolderId: "1hZlBSF7oOR3iU25DKhDU1rrcN41BIwCD",
      billModeDefault: "hold",
    })
    const parsed = parseFeatureSettings("trade-docs", saved)
    expect(parsed.driveFolderId).toBe("1hZlBSF7oOR3iU25DKhDU1rrcN41BIwCD")
    expect(parsed.billModeDefault).toBe("hold")
    expect(parsed.linkDays).toBe(30)
    expect(parsed.infoSheet.docTypeId).toBe("info-sheet")
    expect(parsed.docTypes[0]?.formLink).toBeNull()
  })

  it("reads Drive file links", () => {
    expect(driveFileIdFromInput("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp")
    expect(driveFileIdFromInput("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit")).toBe("1AbCdEfGhIjKlMnOp")
    expect(driveFileIdFromInput("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp")
    expect(driveFileIdFromInput("not a link")).toBeNull()
    expect(driveFileIdFromInput(null)).toBeNull()
  })
})

describe("documents and emails", () => {
  it("builds a signed info sheet PDF", async () => {
    const result = checkInfoSheetAnswers(fields, goodAnswers)
    if (!result.ok) throw new Error(result.error)
    const bytes = await buildInfoSheetPdf({
      title: "Subcontractor info sheet",
      companyName: "High Performance Structures Inc.",
      companyContactLines: ["PO Box 1813", "Woodland Park, CO 80866"],
      vendorName: "Fox Excavation LLC",
      answers: result.answers,
      certification: DEFAULT_INFO_SHEET.certification,
      signerName: "Sam Fox",
      signerTitle: "Owner",
      signedAt: new Date("2026-10-28T15:00:00Z"),
      linkRecipient: "office@foxexc.com",
    })
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(pdf.getTitle()).toBe("Fox Excavation LLC - Subcontractor info sheet")
  })

  it("keeps PDF text to characters the standard fonts have", () => {
    expect(pdfSafeText("Workers’ comp — “yes” \u{1F600}")).toBe('Workers\' comp - "yes" ')
  })

  it("lists what's needed, who certificates name and the link", () => {
    const input = {
      audience: "vendor" as const,
      companyName: "High Performance Structures Inc.",
      companyContactLines: ["Tel: 719.900.8850"],
      vendorName: "Fox Excavation LLC",
      message: "Payments are mailed on the 10th.",
      items: ["W-9", "Workers' comp certificate"],
      certificateHolder: certificateHolderLines("", { legalName: "High Performance Structures Inc.", contactLines: ["PO Box 1813"] }),
      linkUrl: "https://compass.example/vendor-docs/abc",
      expiresOn: "November 27, 2026",
      senderName: "Martine",
      requestedBy: null,
    }
    const text = tradeDocRequestText(input)
    expect(text).toContain("- Workers' comp certificate")
    expect(text).toContain("High Performance Structures Inc.\nPO Box 1813")
    expect(text).toContain("https://compass.example/vendor-docs/abc")
    expect(tradeDocRequestHtml({ ...input, vendorName: "<b>Fox</b>" })).not.toContain("<b>Fox</b>")
  })

  it("names files Compass writes and reads upload responses", () => {
    expect(tradeDocFileName("Fox/Excavation: LLC", "Info sheet", "2026-10-28")).toBe("Fox Excavation LLC - Info sheet 2026-10-28.pdf")
    expect(uploadedDriveFileId('{"id":"abc123"}')).toBe("abc123")
    expect(uploadedDriveFileId("oops")).toBeNull()
    expect(certificateHolderLines("HPS\n\nPO Box 1813 ", { legalName: "x", contactLines: [] })).toEqual(["HPS", "PO Box 1813"])
  })
})
