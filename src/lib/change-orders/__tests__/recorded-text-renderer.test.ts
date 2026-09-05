import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectChangeOrderItem, ProjectChangeOrderFormOptions } from "@/app/actions/project-change-orders"
import { dashboardFixture } from "../../../../__tests__/fixtures/project-audience-dashboard"

const readers = vi.hoisted(() => ({
  detail: vi.fn(), list: vi.fn(), preview: vi.fn(), options: vi.fn(), capabilities: vi.fn(),
}))
vi.mock("@/app/actions/project-change-orders", () => ({
  getProjectChangeOrder: readers.detail,
  getProjectChangeOrders: readers.list,
  getProjectChangeOrderFormOptions: readers.options,
  getProjectChangeOrderCapabilities: readers.capabilities,
  executeProjectChangeOrderRebaseline: vi.fn(),
  updateProjectChangeOrder: vi.fn(),
  getProjectChangeOrderUploadSessionUrl: vi.fn(),
}))
vi.mock("@/app/actions/project-audience-preview", () => ({ getProjectAudiencePreview: readers.preview }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => { throw new Error("not found") },
}))
vi.mock("@/components/projects/project-audience-preview-shell", () => ({
  ProjectAudiencePreviewShell: ({ children }: { readonly children: React.ReactNode }) => children,
}))
vi.mock("@/components/projects/project-change-order-create-form", () => ({ ProjectChangeOrderCreateForm: () => null }))
vi.mock("@/components/developer-mode-provider", () => ({ DeveloperOnly: () => null }))

import { ProjectChangeOrderList } from "@/components/projects/project-change-order-list"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"
import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"
import { changeOrderReport } from "@/lib/print/audience-record-reports"
import { portalReportHtml } from "@/lib/print/portal-report"

const formOptions: ProjectChangeOrderFormOptions = {
  phases: [], costCodes: [], companies: [], estimates: [], currentBaselineEstimateId: null,
}

// Synthetic Loomis CO0007-shaped regression, not a source attestation or copy
// of the current production ledger. Nine offsetting pairs retain all 18 lines.
function record(sourceType = "buildertrend_import"): ProjectChangeOrderItem {
  return {
    id: "synthetic-co0007", projectId: "cedar", changeOrderNumber: "CO-0007",
    title: "Millwork Budget Reallocation",
    scope: "Owner-approved interior-door and railing reallocations plus remaining July transfers.",
    reason: "Owner-requested and approved budget reconciliation (recorded wording).",
    amountCents: 0, scheduleImpactDays: 0, status: "executed", audience: "owner",
    requesterType: "owner", requesterUserId: null, requesterName: "Unverified project owner",
    requesterCompany: "Unverified company", sourceType, sourceRecordId: "synthetic-source-0007",
    sourceHref: null, internalNotes: null, budgetTreatment: "additive", baselineEstimate: null,
    replacementEstimate: null, replacementEstimateUrl: null, estimateComparisonUrl: null,
    rebaselineCompletedAt: null, rebaselineBlockers: [], canExecuteRebaseline: false,
    foxitStatus: "not_started", sageStatus: "not_ready", submittedAt: null,
    createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
    canEdit: false, canApprove: false, allowedTransitions: [],
    lines: Array.from({ length: 18 }, (_, index) => ({
      id: `line-${index + 1}`, lineNumber: index + 1, description: `G703 transfer ${index + 1}`,
      phaseCode: "01", costCode: `code-${index + 1}`,
      amountCents: (Math.floor(index / 2) + 1) * 10000 * (index % 2 === 0 ? 1 : -1),
    })),
    documents: [
      { id: "doors", label: "Interior Door Homeowner Approval.pdf", url: "https://example.com/doors", notes: "Recorded door acceptance text" },
      { id: "railing", label: "Homeowner Budget Reallocation Approval.pdf", url: "https://example.com/railing", notes: "Recorded Railing Budget acceptance text" },
    ],
    history: [{ id: "import", eventType: "buildertrend_import", fromStatus: null, toStatus: "executed",
      actorName: "Import operator", actorRole: "system", note: "Owner requested and signed (unverified recorded note).",
      createdAt: "2026-09-01T12:00:00Z" }],
  }
}

function expectHistoricalContext(markup: string): void {
  expect(markup).toContain("Not verified from Buildertrend")
  expect(markup).toContain("Not classified")
  expect(markup).toContain("retained as recorded")
  expect(markup).toContain("does not independently verify initiation, owner acceptance or signature, staff approval, or purpose")
  expect(markup).not.toContain("Requested by")
  expect(markup).not.toContain("Unverified project owner")
  expect(markup).toContain("Approved · Buildertrend")
}

describe("recorded historical CO text is preserved without evidentiary claims", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readers.detail.mockResolvedValue(record())
    readers.list.mockResolvedValue([record()])
    readers.options.mockResolvedValue(formOptions)
    readers.capabilities.mockResolvedValue({ canCreate: false })
  })

  it.each([true, false])("renders actual form and all 18 lines without reclassifying a zero-dollar reallocation (internal=%s)", (internal) => {
    const item = record()
    const before = structuredClone(item)
    const markup = renderToStaticMarkup(React.createElement(ProjectChangeOrderDetail, {
      item, backHref: "/change-orders", internal, formOptions,
    }))
    expectHistoricalContext(markup)
    expect(markup).toContain("Recorded scope")
    expect(markup).toContain("Recorded reason")
    expect(markup).toContain(item.scope)
    expect(markup).toContain(item.reason)
    expect(markup).toContain("Owner requested and signed (unverified recorded note).")
    expect(markup).toContain("Import operator")
    expect(markup).toContain("$0.00")
    expect(markup).not.toContain(">Executed<")
    for (const line of item.lines) expect(markup).toContain(`value="${line.description}"`)
    for (const document of item.documents) {
      expect(markup).toContain(document.label)
      expect(markup).toContain(document.url)
      expect(markup).toContain(document.notes)
    }
    expect(item.lines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0)).toBe(0)
    expect(item).toEqual(before)
  })

  it("keeps list text visible with the same historical context", () => {
    const item = record()
    const markup = renderToStaticMarkup(React.createElement(ProjectChangeOrderList, {
      projectId: item.projectId, items: [item], detailBaseHref: "/change-orders",
      internal: true, formOptions, canCreate: false,
    }))
    expectHistoricalContext(markup)
    expect(markup).toContain(item.scope)
  })

  it.each(["owner", "sub_vendor"] satisfies readonly ("owner" | "sub_vendor")[])(
    "passes the %s audience to readers and renders contextualized detail and list", async (audience) => {
      readers.preview.mockResolvedValue(dashboardFixture(audience))
      for (const changeOrderId of ["synthetic-co0007", undefined]) {
        const markup = renderToStaticMarkup(await ProjectAudienceChangeOrders({ projectId: "cedar", audience, changeOrderId }))
        expectHistoricalContext(markup)
        expect(markup).toContain("Print / Save PDF")
      }
      expect(readers.detail).toHaveBeenCalledWith("cedar", "synthetic-co0007", audience)
      expect(readers.list).toHaveBeenCalledWith("cedar", audience)
      expect(readers.options).toHaveBeenCalledWith("cedar", audience)
    },
  )

  it("carries the context, verbatim text, documents and all line amounts through the print HTML builder", () => {
    const item = record()
    const before = structuredClone(item)
    const report = changeOrderReport([item])
    const markup = portalReportHtml({ id: "cedar", name: "Synthetic project", projectNumber: null }, report)
    expectHistoricalContext(markup)
    expect(markup).toContain("Recorded scope")
    expect(markup).toContain("Recorded reason")
    expect(markup).toContain(item.scope)
    expect(markup).toContain(item.reason)
    for (const line of item.lines) {
      expect(markup).toContain(`${line.lineNumber}. ${line.description}`)
      expect(markup).toContain(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((line.amountCents ?? 0) / 100))
    }
    for (const document of item.documents) {
      expect(markup).toContain(document.label)
      expect(markup).toContain(document.url)
    }
    expect(item).toEqual(before)
  })

  it("keeps native request labels and executed status unchanged", () => {
    const item = record("owner_request")
    const detail = renderToStaticMarkup(React.createElement(ProjectChangeOrderDetail, {
      item, backHref: "/change-orders", internal: true, formOptions,
    }))
    const report = portalReportHtml({ id: "cedar", name: "Synthetic project", projectNumber: null }, changeOrderReport([item]))
    for (const markup of [detail, report]) {
      expect(markup).toContain("Requested by")
      expect(markup).toContain("Unverified project owner")
      expect(markup).toContain("Executed")
      expect(markup).not.toContain("retained as recorded")
      expect(markup).not.toContain("Recorded scope")
      expect(markup).not.toContain("Recorded reason")
    }
  })
})
