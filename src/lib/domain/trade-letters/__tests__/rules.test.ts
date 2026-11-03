import { describe, expect, it } from "vitest"

import type { TradeLetter } from "@/db/schema-trade-docs"

import {
  summarizeTradeLetter,
  tradeLetterCodeIndexes,
  tradeLetterEventChange,
  tradeLetterIsEditable,
  tradeLetterKindOf,
  tradeLetterScope,
  tradeLetterStatusOf,
  tradeLetterTotalCents,
} from "../rules"

const codes = [
  { costCode: "06-100", description: "Framing", amountCents: 1_000_00 },
  { costCode: "07-200", description: "Roofing", amountCents: 250_50 },
  { costCode: null, description: "Cleanup", amountCents: 75 },
]

function letter(overrides: Partial<TradeLetter>): TradeLetter {
  return {
    id: "letter-1",
    organizationId: "org",
    projectId: "project",
    estimateId: "estimate",
    rfqOperationId: "rfq",
    vendorId: null,
    vendorName: "Vendor",
    kind: "intent",
    letterNumber: "LOI-0001",
    status: "draft",
    scopeJson: "[]",
    totalCents: 0,
    quoteLabel: "your quote",
    owedJson: "[]",
    note: null,
    includesAgreement: false,
    agreementDriveFileId: null,
    signerName: "Signer",
    signerEmail: "signer@example.com",
    companySignerName: "Staff",
    companySignerEmail: "staff@example.com",
    companySignerTitle: null,
    foxitEnvelopeId: null,
    foxitEmbeddedSessionUrl: null,
    signedDriveFileId: null,
    sentAt: null,
    signedAt: null,
    createdBy: null,
    createdByName: "Staff",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("trade letter scope", () => {
  it("takes each chosen code once, ignoring bad indexes", () => {
    const scope = tradeLetterScope(codes, [1, 1, 0, 9, -1, 1.5])
    expect(scope).toEqual([
      { costCode: "07-200", description: "Roofing", amountCents: 250_50 },
      { costCode: "06-100", description: "Framing", amountCents: 1_000_00 },
    ])
    expect(tradeLetterTotalCents(scope)).toBe(1_250_50)
    expect(tradeLetterScope(codes, [])).toEqual([])
  })
  it("finds the codes a saved letter covers", () => {
    expect(tradeLetterCodeIndexes(codes, [{ costCode: null, description: "Cleanup", amountCents: 1 }, { costCode: "06-100", description: "Framing", amountCents: 0 }])).toEqual([0, 2])
  })
})

describe("trade letter summary", () => {
  it("reads unknown kinds and statuses as intent and draft", () => {
    expect(tradeLetterKindOf({ kind: "other" })).toBe("intent")
    expect(tradeLetterKindOf({ kind: "award" })).toBe("award")
    expect(tradeLetterStatusOf({ status: "weird" })).toBe("draft")
    expect(tradeLetterStatusOf({ status: "sent" })).toBe("sent")
  })
  it("links the signed copy from Drive, else Foxit", () => {
    expect(summarizeTradeLetter(letter({ status: "signed", signedDriveFileId: "drive-1", foxitEnvelopeId: "env" })).signedUrl).toBe("https://drive.google.com/file/d/drive-1/view")
    expect(summarizeTradeLetter(letter({ status: "signed", foxitEnvelopeId: "env/1" })).signedUrl).toBe("/api/integrations/foxit/envelopes/env%2F1/document")
    expect(summarizeTradeLetter(letter({ status: "sent", signedDriveFileId: "drive-1" })).signedUrl).toBeNull()
  })
  it("shows the Foxit sending page only while preparing", () => {
    expect(summarizeTradeLetter(letter({ status: "preparing", foxitEmbeddedSessionUrl: "https://foxit" })).embeddedSessionUrl).toBe("https://foxit")
    expect(summarizeTradeLetter(letter({ status: "sent", foxitEmbeddedSessionUrl: "https://foxit" })).embeddedSessionUrl).toBeNull()
  })
  it("allows edits only before the letter goes out", () => {
    expect(tradeLetterIsEditable("draft")).toBe(true)
    expect(tradeLetterIsEditable("preparing")).toBe(true)
    expect(tradeLetterIsEditable("sent")).toBe(false)
  })
})

describe("Foxit envelope events", () => {
  const now = "2026-10-31T12:00:00.000Z"
  it("marks a draft or preparing letter sent", () => {
    expect(tradeLetterEventChange({ status: "preparing" }, "folder_sent", now)).toEqual({ kind: "sent", values: { status: "sent", sentAt: now, foxitEmbeddedSessionUrl: null, updatedAt: now } })
    expect(tradeLetterEventChange({ status: "signed" }, "folder_sent", now)).toEqual({ kind: "none", ignored: false })
  })
  it("records a decline or cancellation once, never over a signature", () => {
    expect(tradeLetterEventChange({ status: "sent" }, "folder_declined", now)).toEqual({ kind: "closed", outcome: "declined", values: { status: "declined", updatedAt: now } })
    expect(tradeLetterEventChange({ status: "sent" }, "folder_cancelled", now)).toMatchObject({ kind: "closed", outcome: "cancelled" })
    expect(tradeLetterEventChange({ status: "declined" }, "folder_declined", now)).toEqual({ kind: "none", ignored: false })
    expect(tradeLetterEventChange({ status: "signed" }, "folder_cancelled", now)).toEqual({ kind: "none", ignored: false })
  })
  it("signs once and ignores other events", () => {
    expect(tradeLetterEventChange({ status: "sent" }, "folder_executed", now)).toEqual({ kind: "signed", values: { status: "signed", signedAt: now, updatedAt: now } })
    expect(tradeLetterEventChange({ status: "signed" }, "folder_executed", now)).toEqual({ kind: "none", ignored: true })
    expect(tradeLetterEventChange({ status: "sent" }, "folder_viewed", now)).toEqual({ kind: "none", ignored: true })
  })
})
