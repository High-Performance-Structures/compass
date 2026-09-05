vi.mock("@/app/actions/selection-decisions-read", () => ({
  getSelectionWorkspace: vi.fn().mockResolvedValue({ items: [] }),
}))
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { dashboardFixture } from "../../../../__tests__/fixtures/project-audience-dashboard"
import { ProjectAudienceDashboard } from "@/components/projects/project-audience-dashboard"
import type { AudienceDashboardFinancials } from "@/lib/project-audience-dashboard"

const readers = vi.hoisted(() => ({ changes: vi.fn(), budget: vi.fn() }))
vi.mock("@/app/actions/project-change-orders", () => ({
  getProjectChangeOrders: readers.changes,
}))
vi.mock("@/app/actions/project-budget", () => ({
  getProjectBudgetSummary: readers.budget,
}))
vi.mock("@/components/projects/project-audience-dashboard-view", () => ({
  ProjectAudienceDashboardView: ({
    financials,
  }: {
    readonly financials: AudienceDashboardFinancials
  }) =>
    createElement("div", {
      "data-changes":
        financials.changeOrders === null ? "unavailable" : "loaded",
      "data-budget":
        financials.applications === null ? "unavailable" : "loaded",
    }),
}))

describe("audience dashboard summary readers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readers.changes.mockResolvedValue([])
    readers.budget.mockResolvedValue({ applications: [] })
  })

  it("uses owner-filtered readers even when staff preview the owner workspace", async () => {
    const data = { ...dashboardFixture(), viewerIsInternal: true }
    await ProjectAudienceDashboard({ data, messageShortcut: null })
    expect(readers.changes).toHaveBeenCalledWith("cedar", "owner")
    expect(readers.budget).toHaveBeenCalledWith("cedar", "owner")
  })

  it("does not load owner financials for the shared sub/supplier workspace", async () => {
    await ProjectAudienceDashboard({
      data: dashboardFixture("sub_vendor"),
      messageShortcut: null,
    })
    expect(readers.changes).toHaveBeenCalledWith("cedar", "sub_vendor")
    expect(readers.budget).not.toHaveBeenCalled()
  })

  it("preserves the dashboard when an optional summary fails and exposes its unavailable state", async () => {
    readers.changes.mockRejectedValue(new Error("Unavailable"))
    const result = await ProjectAudienceDashboard({
      data: dashboardFixture(),
      messageShortcut: null,
    })
    expect(renderToStaticMarkup(result)).toContain(
      'data-changes="unavailable" data-budget="loaded"'
    )
  })

  it("keeps an unavailable budget distinct from an empty published budget", async () => {
    readers.budget.mockRejectedValue(new Error("Unavailable"))
    const result = await ProjectAudienceDashboard({
      data: dashboardFixture(),
      messageShortcut: null,
    })
    expect(renderToStaticMarkup(result)).toContain(
      'data-changes="loaded" data-budget="unavailable"'
    )
  })
})
