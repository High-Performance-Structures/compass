import { PDFDocument } from "pdf-lib"
import { describe, expect, test } from "vitest"

import { base64PdfBytes, prepareContractPacketPdf } from "@/lib/contracts/packet-pdf"

describe("contract packet PDF", () => {
  test("merges CA22, withholds closeout bodies, and adds Foxit fields", async () => {
    const estimateDocument = await PDFDocument.create()
    estimateDocument.addPage([612, 792])
    estimateDocument.addPage([612, 792])
    const estimateBytes = await estimateDocument.save()
    const estimateBuffer = new Uint8Array(estimateBytes.byteLength)
    estimateBuffer.set(estimateBytes)
    const prepared = await prepareContractPacketPdf({
      packet: {
        id: "packet-1",
        estimateId: "estimate-1",
        packetNumber: "CA22-001",
        versionNumber: 1,
        title: "Construction Contract",
        status: "draft",
        legalEntityName: "High Performance Structures Inc.",
        contractDraftDate: "2026-08-23",
        approximateCommencementDate: "2026-09-01",
        approximateCompletionDate: "2027-08-31",
        depositRateBasisPoints: 1_000,
        depositCents: 10_000_00,
        latePaymentRateBasisPoints: 1200,
        details: {
          projectAddress: "1 Main Street",
          county: "Teller",
          ownerName: "Alex Owner",
          ownerMailingAddress: "PO Box 100, Woodland Park, CO 80866",
        },
        clientSigners: [{ contactId: null, name: "Alex Owner", title: "Owner", email: "alex@example.com", initials: "AO" }],
        companySignerName: "Casey Builder",
        companySignerTitle: "President",
        companySignerEmail: "casey@example.com",
        companySignerInitials: "CB",
        foxitStatus: "not_started",
        foxitEnvelopeId: null,
        foxitEmbeddedSessionUrl: null,
        signaturePackageUrl: null,
        signedAt: null,
        acceptanceMethod: null,
        acceptanceEvidenceLabel: null,
        acceptanceRecordedByName: null,
        acceptedAt: null,
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
      documents: [
        { id: "ca00", templateId: null, templateVersionId: null, code: "CA00", title: "Agreement", contentMarkdown: "# Agreement\n\n{{contract.document_schedule}}", inclusionMode: "embedded", signingStage: "contract", signaturePolicy: "all_signers", documentDate: null, revision: null, sourceUrl: null, sortOrder: 0 },
        { id: "ca11", templateId: null, templateVersionId: null, code: "CA11", title: "Inspection Checklist", contentMarkdown: "This closeout body must not be in the initial envelope.", inclusionMode: "embedded", signingStage: "closeout", signaturePolicy: "stage_signers", documentDate: null, revision: null, sourceUrl: null, sortOrder: 10 },
        { id: "ca18", templateId: null, templateVersionId: null, code: "CA18", title: "Warranty Handbook", contentMarkdown: "Reference only.", inclusionMode: "reference", signingStage: "reference", signaturePolicy: "stage_signers", documentDate: null, revision: null, sourceUrl: null, sortOrder: 20 },
        { id: "ca22", templateId: null, templateVersionId: null, code: "CA22", title: "Construction Estimate", contentMarkdown: "Generated", inclusionMode: "generated", signingStage: "contract", signaturePolicy: "all_signers", documentDate: "2026-08-23", revision: "v1", sourceUrl: null, sortOrder: 30 },
      ],
      estimate: {
        id: "estimate-1",
        estimateNumber: "CA22-001",
        versionNumber: 1,
        title: "Construction Estimate",
        status: "draft",
        estimateDate: "2026-08-23",
        clientName: "Alex Owner",
        clientMailingAddress: "PO Box 100, Woodland Park, CO 80866",
        builderFeeCents: 15_000_00,
        builderFeeRateBasisPoints: 1500,
        estimateTotalCents: 115_000_00,
      },
      projectName: "Compass Developer",
      projectNumber: "H-001",
      projectAddress: "1 Main Street",
      brand: {
        companyName: "High Performance Structures, Inc.",
        contactLines: ["PO Box 1813", "Woodland Park, CO 80866", "Tel: 719.900.8850"],
        logoBytes: new Uint8Array(Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvV1AAAAAElFTkSuQmCC",
          "base64"
        )),
      },
      estimatePdf: estimateBuffer.buffer,
    })
    const finalPdf = await PDFDocument.load(base64PdfBytes(prepared.pdfBase64))
    expect(finalPdf.getPageCount()).toBe(3)
    expect(prepared.fields.filter((field) => field.type === "initial")).toHaveLength(4)
    expect(prepared.fields.filter((field) => field.type === "signature")).toHaveLength(2)
    expect(prepared.fields.filter((field) => field.type === "date")).toHaveLength(2)
    expect(
      prepared.fields.find(
        (field) => field.type === "signature" && field.party === 2
      )
    ).toMatchObject({ x: 339, width: 233 })
    expect(
      prepared.fields.find((field) => field.type === "date" && field.party === 2)
    ).toMatchObject({ x: 321, width: 251, y: 205 })
  })
})
