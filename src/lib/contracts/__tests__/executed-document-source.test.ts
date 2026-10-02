import { describe, expect, it } from "vitest"

import { executedContractDocumentSource } from "@/lib/contracts/executed-document-source"

describe("executed contract document source", () => {
  it("recognizes Compass Foxit documents", () => {
    expect(
      executedContractDocumentSource(
        "/api/integrations/foxit/envelopes/folder%201/document"
      )
    ).toEqual({ kind: "foxit", envelopeId: "folder 1" })
  })

  it.each([
    "https://drive.google.com/file/d/drive-file-1/view",
    "https://drive.google.com/open?id=drive-file-1",
  ])("recognizes a project Drive document from %s", (url) => {
    expect(executedContractDocumentSource(url)).toEqual({
      kind: "google_drive",
      fileId: "drive-file-1",
    })
  })

  it("allows other secure saved-document locations", () => {
    expect(
      executedContractDocumentSource("https://documents.example.com/contract.pdf")
    ).toEqual({
      kind: "external",
      url: "https://documents.example.com/contract.pdf",
    })
  })

  it.each([
    null,
    "",
    "not a link",
    "http://documents.example.com/contract.pdf",
    "https://user:password@documents.example.com/contract.pdf",
    "https://drive.google.com/drive/folders/folder-1",
  ])("rejects an unsafe or unsupported source: %s", (value) => {
    expect(executedContractDocumentSource(value)).toBeNull()
  })
})
