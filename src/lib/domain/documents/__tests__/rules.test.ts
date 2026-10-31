import { describe, expect, it } from "vitest"

import { cleanDocumentDate, requiredText } from "@/lib/domain/documents/rules"

describe("requiredText", () => {
  it("returns the trimmed value", () => {
    expect(requiredText("  Contract  ", "Packet title")).toBe("Contract")
  })

  it("names the field when the value is blank or missing", () => {
    expect(() => requiredText("   ", "Packet title")).toThrow("Packet title is required.")
    expect(() => requiredText(null, "Source folder")).toThrow("Source folder is required.")
  })
})

describe("cleanDocumentDate", () => {
  it("treats a blank date as no date", () => {
    expect(cleanDocumentDate(null)).toBeNull()
    expect(cleanDocumentDate("  ")).toBeNull()
  })

  it("keeps a trimmed YYYY-MM-DD date", () => {
    expect(cleanDocumentDate(" 2026-10-31 ")).toBe("2026-10-31")
  })

  it("rejects any other format", () => {
    expect(() => cleanDocumentDate("10/31/2026")).toThrow("Document date must use YYYY-MM-DD.")
    expect(() => cleanDocumentDate("2026-10-31T00:00")).toThrow("Document date must use YYYY-MM-DD.")
  })
})
