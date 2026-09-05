import { describe, expect, it } from "vitest"
import { dashboardFixture } from "./fixtures/project-audience-dashboard"
import {
  commitmentReport,
  rfiReport,
  rfqReport,
} from "@/lib/print/audience-record-reports"
import { portalReportHtml } from "@/lib/print/portal-report"
import { selectionReport } from "@/lib/selections/report"
import type { SelectionDecisionItem } from "@/lib/selections/types"

const spec = {
  roomName: "Kitchen",
  name: "Faucet",
  category: "Plumbing",
  description: "Verify clearance",
  quantity: 2,
  manufacturer: "Waterworks",
  model: "Henry",
  colorFinish: "Brass",
  supplierName: "Fixture Co",
  productUrl: "https://example.test/faucet",
}
const item: SelectionDecisionItem = {
  id: "a",
  spec,
  currentSpec: spec,
  revision: 2,
  published: true,
  current: true,
  decisionDueDate: "2026-10-01",
  allowanceCents: 100000,
  quotedCents: 125000,
  scheduleImpact: "Private schedule note",
  ownerNote: "Private owner note",
  requiresChangeOrder: false,
  changeOrderId: null,
  approvedAt: "2026-09-05",
  approvedByName: "Private owner identity",
  approvalBlocker: null,
  status: "selected",
  selectionUpdatedAt: "2026-09-05",
  requests: [],
  history: [],
  links: [],
}

describe("portal reports", () => {
  it("uses branded report layout and escapes all record text", () => {
    const html = portalReportHtml(
      {
        id: "proj-o-210",
        name: "<script>secret()</script>",
        projectNumber: "O-210",
      },
      {
        title: "Selections",
        note: "Check revisions",
        groups: [
          {
            title: "Kitchen",
            items: [
              {
                title: '<img src=x onerror="bad()">',
                fields: [["Model", "A&B"]],
                paragraphs: [["Description", "line 1\nline 2"]],
              },
            ],
          },
        ],
      },
      true,
      "Today",
    )
    expect(html).toContain("/department-logos/orc-mark.png")
    expect(html).toContain("selection-print-room-sheet")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;img")
    expect(html).toContain("A&amp;B")
    expect(html).not.toContain("<script>")
  })
  it("prints technical details without owner terms or approval identity for partners, even if supplied", () => {
    const text = JSON.stringify(selectionReport([item], "sub_vendor"))
    expect(text).toContain("Owner approved")
    expect(text).toContain("Henry")
    expect(text).toContain("Quantity")
    expect(text).not.toContain("Private")
    expect(text).not.toContain("$1,250")
    const owner = JSON.stringify(selectionReport([item], "owner"))
    expect(owner).toContain("$1,250.00")
    expect(owner).toContain("Private owner note")
    expect(
      selectionReport([{ ...item, current: false }], "owner").groups[0]
        ?.items[0]?.status,
    ).toContain("revision pending")
  })
  it("retains assigned RFQ scope and vendor quote detail without adding unrelated records", () => {
    const data = dashboardFixture("sub_vendor")
    const rfq = data.rfqs[0]
    if (!rfq) throw Error("Missing RFQ fixture")
    const report = rfqReport([
      {
        ...rfq,
        scopeItems: [
          {
            lineNumber: 1,
            description: "Kitchen faucet estimate",
            phaseCode: null,
            costCode: null,
            notes: "Manufacturer: Waterworks | Model: Henry",
          },
        ],
        vendorResponse: {
          decision: "quote",
          amount: 1250,
          lines: [{ lineNumber: 1, amount: 1250, notes: "Includes freight" }],
          leadTime: "6 weeks",
          validUntil: "2026-10-01",
          notes: "Price only",
          responderUserId: "vendor",
          responderName: "Supplier",
          responderCompany: "Fixtures",
          submittedAt: "2026-09-05",
        },
      },
    ])
    expect(report.groups).toHaveLength(1)
    expect(JSON.stringify(report)).toContain("Model: Henry")
    expect(JSON.stringify(report)).toContain("Includes freight")
    expect(JSON.stringify(report)).toContain("$1,250.00")
    expect(JSON.stringify(report)).not.toContain("responderUserId")
  })
  it("preserves complete RFI text and assigned PO details", () => {
    const data = dashboardFixture("sub_vendor")
    const rfi = data.rfis[0]
    const operation = data.operations[0]
    if (!rfi || !operation) throw Error("Missing record fixture")
    const question = "Clearance issue\n".repeat(100)
    expect(
      JSON.stringify(
        rfiReport([{ ...rfi, question, answer: "Use revised detail A" }]),
      ),
    ).toContain(JSON.stringify(question).slice(1, -1))
    const report = commitmentReport([
      {
        ...operation,
        sourceRecordType: "purchase_order",
        amount: 1234.56,
        description: "Deliver selected kitchen fixtures",
      },
    ])
    expect(report.title).toBe("Purchase Order")
    expect(JSON.stringify(report)).toContain("$1,234.56")
    expect(JSON.stringify(report)).toContain(
      "Deliver selected kitchen fixtures",
    )
  })
})
