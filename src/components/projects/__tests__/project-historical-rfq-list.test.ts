import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { describe, expect, it } from "vitest"

import { ProjectHistoricalRfqList } from "@/components/projects/project-historical-rfq-list"
import type {
  HistoricalRfqWorkspace,
  HistoricalRfqWorkspaceItem,
} from "@/lib/rfqs/historical-workspace"

function request(
  overrides: Partial<Extract<HistoricalRfqWorkspaceItem, { readonly kind: "request" }>> = {}
): Extract<HistoricalRfqWorkspaceItem, { readonly kind: "request" }> {
  return {
    kind: "request",
    sourceRecordId: "source-response-1",
    requestId: "request-1",
    bidPackageId: "package-1",
    operationId: "operation-1",
    vendorDisplay: "Synthetic Vendor",
    sourceStatus: "Draft",
    submission: "draft",
    pricingReconciliation: "unpriced",
    sourceAmountDisplay: null,
    submittedAmountCents: null,
    amountDisplayProvenance: "captured",
    releasedDisplay: "Released as captured",
    submittedDisplay: null,
    submittedByDisplay: "Historical submitter",
    vendorNotes: "Source <note>\nSecond line",
    lines: [
      {
        lineNumber: 1,
        title: "Line title",
        description: "Line description",
        expandedDescription: "Expanded line description",
        costCodeDisplay: "01-100",
        costTypeDisplay: "Labor",
        unitCostDisplay: "$10.00",
        quantityDisplay: "2",
        unitDisplay: "EA",
        builderCostDisplay: "$20.00",
        submittedLineAmountCents: null,
      },
    ],
    attachments: [
      {
        status: "verified",
        documentInstanceId: "document-verified",
        label: "Verified file",
        url: "https://files.example.test/verified.pdf",
      },
      {
        status: "held",
        documentInstanceId: "document-held",
        label: "Held file",
        reason: "original_not_verified",
      },
    ],
    holds: ["Source file requires review"],
    ...overrides,
  }
}

function workspace(
  overrides: Partial<Extract<HistoricalRfqWorkspace, { readonly success: true }>> = {}
): Extract<HistoricalRfqWorkspace, { readonly success: true }> {
  return {
    success: true,
    projectId: "project/one",
    totalRecords: 2,
    items: [
      request(),
      {
        kind: "held",
        sourceRecordId: "source-held-1",
        bidPackageId: null,
        reason: "Capture did not pass identity checks",
      },
    ],
    nextCursor: null,
    hasPreviousPage: false,
    ...overrides,
  }
}

describe("ProjectHistoricalRfqList", () => {
  it("keeps known-package holds with their package and unknown identities separate", () => {
    const html = renderToStaticMarkup(createElement(ProjectHistoricalRfqList, {
      workspace: workspace({ items: [
        request({ bidPackageId: "71001" }),
        { kind: "held", sourceRecordId: "held-known", bidPackageId: "71001", reason: "Missing immutable observation" },
        { kind: "held", sourceRecordId: "held-other", bidPackageId: "71002", reason: "Unsupported source format" },
        { kind: "held", sourceRecordId: "held-unknown", bidPackageId: null, reason: "Package identity not reconciled" },
      ] }),
    }))
    expect(html.match(/Bid package 71001/g)).toHaveLength(1)
    expect(html.indexOf("Missing immutable observation")).toBeGreaterThan(html.indexOf("Bid package 71001"))
    expect(html.indexOf("Missing immutable observation")).toBeLessThan(html.indexOf("Bid package 71002"))
    expect(html.indexOf("Unsupported source format")).toBeGreaterThan(html.indexOf("Bid package 71002"))
    expect(html.indexOf("Unsupported source format")).toBeLessThan(html.indexOf("Bid package held source records"))
    expect(html).toContain("Package identity not reconciled")
    expect(html).not.toContain("buildertrend.net")
  })

  it("renders complete line evidence and keeps held files non-clickable", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectHistoricalRfqList, {
        workspace: workspace(),
      })
    )

    expect(html).toContain("Synthetic Vendor")
    expect(html).toContain("Historical submitter")
    expect(html).toContain("Submitted by (source display)")
    expect(html).toContain("Line title")
    expect(html).toContain("Line description")
    expect(html).toContain("Expanded line description")
    expect(html).toContain("01-100")
    expect(html).toContain("Labor")
    expect(html).toContain("$10.00")
    expect(html).toContain("2")
    expect(html).toContain("EA")
    expect(html).toContain("$20.00")
    expect(html).toContain("Source vendor notes")
    expect(html).toContain("Source &lt;note&gt;")
    expect(html).toContain("Second line")
    expect(html).not.toContain("Source <note>")
    expect(html).toContain("https://files.example.test/verified.pdf")
    expect(html).toContain("Held file (original_not_verified; link withheld)")
    expect(html).not.toContain("buildertrend.net")
    expect(html).not.toContain("rawPayloadJson")
    expect(html).not.toContain("Approve")
    expect(html).not.toContain("approveHistorical")
  })

  it("shows an empty cursor page as empty and links back to the filtered first page", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectHistoricalRfqList, {
        statusFilter: "response received",
        workspace: workspace({
          items: [],
          nextCursor: null,
          hasPreviousPage: true,
        }),
      })
    )

    expect(html).toContain("No historical responses on this page.")
    expect(html).toContain(
      'href="/dashboard/projects/project%2Fone/rfqs?status=response%20received#historical-rfq-history"'
    )
    expect(html).not.toContain("No historical responses captured.")
  })

  it("uses the exact encoded project and cursor in the next-page link", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectHistoricalRfqList, {
        workspace: workspace({
          items: [request()],
          totalRecords: 3,
          nextCursor: "cursor/value+next",
        }),
      })
    )

    expect(html).toContain(
      'href="/dashboard/projects/project%2Fone/rfqs?historyAfter=cursor%2Fvalue%2Bnext#historical-rfq-history"'
    )
  })

  it("does not describe an unpriced source response as a missing capture", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectHistoricalRfqList, {
        workspace: workspace({
          totalRecords: 1,
          items: [request({
            sourceStatus: "Submitted",
            submission: "submitted",
            pricingReconciliation: "unpriced",
            vendorNotes: null,
          })],
        }),
      })
    )

    expect(html).toContain("No price supplied in source response")
    expect(html).toContain("No priced total in source response")
    expect(html).toContain("Source vendor notes")
    expect(html).toContain("Not captured")
    expect(html).not.toContain("Pricing not captured")
  })
})
