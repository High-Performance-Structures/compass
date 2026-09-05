import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ProjectChangeOrderItem, ProjectChangeOrderFormOptions } from "@/app/actions/project-change-orders"

vi.mock("@/components/projects/project-change-order-create-form", () => ({ ProjectChangeOrderCreateForm: () => null }))
vi.mock("@/components/projects/project-change-order-edit-form", () => ({ ProjectChangeOrderEditForm: () => null }))
vi.mock("@/components/developer-mode-provider", () => ({ DeveloperOnly: () => null }))

import { ProjectChangeOrderList } from "@/components/projects/project-change-order-list"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"

const formOptions: ProjectChangeOrderFormOptions = {
  phases: [], costCodes: [], companies: [], estimates: [], currentBaselineEstimateId: null,
}

function item(overrides: Partial<ProjectChangeOrderItem> = {}): ProjectChangeOrderItem {
  return {
    id: "synthetic-co", projectId: "project-test", changeOrderNumber: "CO-001", title: "Budgeted fixture adjustment",
    scope: "Fixture allowance variance", reason: "Owner request copied from a legacy note",
    amountCents: 12345, scheduleImpactDays: 2, status: "executed", audience: "owner",
    requesterType: "owner", requesterUserId: null, requesterName: "Legacy project owner",
    requesterCompany: "Legacy company", sourceType: "buildertrend_import", sourceRecordId: "source-1",
    sourceHref: null, internalNotes: null, budgetTreatment: "additive", baselineEstimate: null,
    replacementEstimate: null, replacementEstimateUrl: null, estimateComparisonUrl: null,
    rebaselineCompletedAt: null, rebaselineBlockers: [], canExecuteRebaseline: false,
    foxitStatus: "not_started", sageStatus: "not_ready", submittedAt: null,
    createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
    canEdit: false, canApprove: false, allowedTransitions: [], lines: [], documents: [],
    history: [{ id: "history", eventType: "buildertrend_import", fromStatus: null, toStatus: "executed",
      actorName: "Buildertrend import", actorRole: "system", note: "Original approval preserved",
      createdAt: "2026-09-01T12:00:00.000Z" }],
    ...overrides,
  }
}

function render(record: ProjectChangeOrderItem, internal: boolean): readonly string[] {
  return [
    renderToStaticMarkup(React.createElement(ProjectChangeOrderList, {
      projectId: record.projectId, items: [record], detailBaseHref: "/change-orders",
      internal, formOptions, canCreate: false,
    })),
    renderToStaticMarkup(React.createElement(ProjectChangeOrderDetail, {
      item: record, backHref: "/change-orders", internal, formOptions,
    })),
  ]
}

describe("imported change-order provenance in shared list and detail", () => {
  it.each([true, false])("separates unverified initiation and purpose from approval (internal=%s)", (internal) => {
    for (const markup of render(item(), internal)) {
      expect(markup).toContain("Initiator: Not verified from Buildertrend")
      expect(markup).toContain("Purpose: Not classified")
      expect(markup).toContain("Approved · Buildertrend")
      expect(markup).toContain("$123.45")
      expect(markup).not.toContain("Requested by")
      expect(markup).not.toContain("Legacy project owner")
      expect(markup).not.toContain("Legacy company")
    }
    const detail = render(item(), internal)[1]
    expect(detail).toContain("Historical record imported")
    expect(detail).toContain("Original approval preserved")
    expect(detail).not.toContain("Request created")
  })

  it.each(["owner", "internal", "subcontractor", "unknown"] satisfies readonly ProjectChangeOrderItem["requesterType"][])(
    "does not treat legacy requester type %s as evidence", (requesterType) => {
      for (const markup of render(item({ requesterType, budgetTreatment: "baseline_replacement" }), false)) {
        expect(markup).toContain("Initiator: Not verified from Buildertrend")
        expect(markup).toContain("Purpose: Not classified")
        expect(markup).toContain("Baseline replacement")
      }
    },
  )

  it("retains native requester, approval label, and creation history", () => {
    const native = item({ sourceType: "owner_request", history: [{ id: "created", eventType: "created",
      fromStatus: null, toStatus: "submitted", actorName: "Legacy project owner", actorRole: "owner",
      note: null, createdAt: "2026-09-01T12:00:00.000Z" }] })
    for (const markup of render(native, false)) {
      expect(markup).toContain("Requested by Legacy project owner")
      expect(markup).toContain("Executed")
      expect(markup).not.toContain("Not verified from Buildertrend")
      expect(markup).not.toContain("Purpose: Not classified")
    }
    expect(render(native, false)[1]).toContain("Request created")
  })
})
