import { describe, expect, it } from "vitest"

import { dayBefore, planSageCertificates, sageCertificateFlags } from "@/lib/domain/sage-bridge/certificate-rules"
import { DEFAULT_TRADE_DOC_TYPES } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs, type TradeDocOnFile } from "@/lib/trade-docs/status"

const today = "2026-11-01"

function doc(docType: string, patch: Partial<TradeDocOnFile> = {}): TradeDocOnFile {
  return {
    id: `${docType}-1`,
    docType,
    kind: "document",
    fileName: `${docType}.pdf`,
    webUrl: null,
    effectiveOn: "2026-01-15",
    expiresOn: null,
    checks: [],
    notes: null,
    source: "manual",
    createdAt: "2026-01-16T00:00:00.000Z",
    createdByName: "Office",
    ...patch,
  }
}

function plan(docs: readonly TradeDocOnFile[], billMode: "flag" | "hold" | "off", warnOnly: boolean, sageNames: Readonly<Record<string, string>> = {}) {
  const summary = summarizeTradeDocs({ docTypes: DEFAULT_TRADE_DOC_TYPES, vendorCategory: "Subcontractor", docs, today })
  return planSageCertificates({ summary, billMode, warnOnly, sageNames, missingExpiresOn: dayBefore(today) })
}

describe("Sage certificate flags", () => {
  it("warns only while the rollout switch is on, even for hold", () => {
    expect(sageCertificateFlags("hold", true)).toEqual({ warn: "Y", stopPay: "N" })
    expect(sageCertificateFlags("hold", false)).toEqual({ warn: "Y", stopPay: "Y" })
    expect(sageCertificateFlags("flag", false)).toEqual({ warn: "Y", stopPay: "N" })
    expect(sageCertificateFlags("off", false)).toEqual({ warn: "N", stopPay: "N" })
  })
})

describe("planSageCertificates", () => {
  it("sends one row per required document, missing ones already expired", () => {
    const rows = plan([doc("w9"), doc("gl-certificate", { expiresOn: "2027-03-01" })], "hold", false)
    const required = summarizeTradeDocs({ docTypes: DEFAULT_TRADE_DOC_TYPES, vendorCategory: "Subcontractor", docs: [], today }).lines.filter((line) => line.required)
    expect(rows).toHaveLength(required.length)
    const w9 = rows.find((row) => row.docTypeId === "w9")
    expect(w9).toMatchObject({ desc: "W-9", expiryDate: null, receivedDate: "2026-01-15", warn: "Y", stopPay: "Y" })
    const gl = rows.find((row) => row.docTypeId === "gl-certificate")
    expect(gl).toMatchObject({ expiryDate: "2027-03-01", stopPay: "Y" })
    const missing = rows.filter((row) => row.docTypeId !== "w9" && row.docTypeId !== "gl-certificate")
    expect(missing.length).toBeGreaterThan(0)
    for (const row of missing) expect(row).toMatchObject({ receivedDate: null, expiryDate: "2026-10-31", warn: "Y", stopPay: "Y" })
  })

  it("uses the company's Sage names and still matches the Compass label", () => {
    const rows = plan([], "flag", true, { "gl-certificate": "General Liability" })
    const gl = rows.find((row) => row.docTypeId === "gl-certificate")
    expect(gl?.desc).toBe("General Liability")
    expect(gl?.matchNames).toEqual(["general liability", "general liability certificate"])
  })

  it("keeps an expired certificate's real expiry", () => {
    const rows = plan([doc("gl-certificate", { expiresOn: "2026-06-30" })], "flag", true)
    expect(rows.find((row) => row.docTypeId === "gl-certificate")).toMatchObject({ expiryDate: "2026-06-30", warn: "Y", stopPay: "N" })
  })
})

describe("dayBefore", () => {
  it("crosses month and year ends", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28")
    expect(dayBefore("2027-01-01")).toBe("2026-12-31")
  })
})
