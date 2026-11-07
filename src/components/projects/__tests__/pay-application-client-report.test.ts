import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/projects/project-brand-logo", () => ({ ProjectBrandLogo: () => null }))
vi.mock("@/components/projects/project-brand-contact-details", () => ({ ProjectBrandContactDetails: () => null }))
vi.mock("@/components/projects/document-report-actions", () => ({ DocumentReportActions: () => null }))

import type { ProjectOwnerPayApplicationReport } from "@/app/actions/project-financial-workflows"
import { PayApplicationClientReport } from "@/components/projects/pay-application-client-report"
import { brandForDepartment } from "@/lib/project-branding"

const line = {
  id: "line-1",
  costCode: "03 31 00",
  assemblyKey: "asm:footer",
  assemblyName: "Footer Labor & Materials",
  assemblySort: 1,
  divisionCode: "03",
  divisionName: "Concrete",
  description: "Structural Concrete",
  originalEstimate: 44_497.69,
  priorChanges: 0,
  currentChanges: 0,
  totalChanges: 0,
  totalVariances: 0,
  adjustedEstimate: 44_497.69,
  previousWorkCompleted: 0,
  currentWorkCompleted: 44_497.69,
  storedMaterials: 0,
  totalCompletedStored: 44_497.69,
  retainageHeld: 0,
  balanceToFinish: 0,
  ownerVisible: true,
}

function report(
  ownerDetail: ProjectOwnerPayApplicationReport["draft"]["ownerDetail"],
  changeOrders: ProjectOwnerPayApplicationReport["changeOrders"] = []
): string {
  const value: ProjectOwnerPayApplicationReport = {
    changeOrders,
    project: {
      name: "Example Residence",
      projectNumber: "H-100-1000",
      department: "H",
      address: "1 Example Rd",
      clientName: "Example Owner",
      clientAddress: null,
    },
    draft: {
      id: "app-1",
      applicationNumber: "1",
      periodTo: "2026-10-23",
      status: "draft",
      budgetRevisionId: "rev-2",
      originalContractSum: 44_497.69,
      netChanges: 1_700,
      contractSumToDate: 46_197.69,
      totalCompletedStoredToDate: 44_497.69,
      retainageHeld: 0,
      totalEarnedLessRetainage: 44_497.69,
      previousCertificates: 0,
      depositApplied: 44_497.69,
      depositAppliedMode: "manual",
      depositAvailable: 80_565.89,
      currentPaymentDue: 0,
      balanceToFinish: 1_700,
      ownerDetail,
      ownerDetailOverride: null,
      ownerDetailDefault: { detail: "cost_code", source: "company" },
      newerBudgetRevision: null,
      assemblySplitStale: false,
      lines: [
        line,
        { ...line, id: "line-2", costCode: "07 10 00", assemblyKey: "co:1", assemblyName: "Change order CO-001", assemblySort: 500_000, divisionCode: "07", divisionName: "Thermal and Moisture Protection", description: "Waterproofing", originalEstimate: 0, currentChanges: 1_700, totalChanges: 1_700, adjustedEstimate: 1_700, currentWorkCompleted: 0, totalCompletedStored: 0, balanceToFinish: 1_700 },
      ],
    },
  }
  return renderToStaticMarkup(
    createElement(PayApplicationClientReport, { projectId: "project-1", report: value, brand: brandForDepartment("H"), showActions: true })
  )
}

describe("PayApplicationClientReport", () => {
  it("prints a landscape G702 with sign-offs and the G703 by assembly", () => {
    const html = report("assembly_percent")
    expect(html).toContain("size: letter landscape")
    expect(html).toContain("Reviewed and approved")
    expect(html).toContain("Reviewer signature")
    expect(html).toContain("Change order CO-001 $1,700.00")
    expect(html).toContain("2a</td><td>Net change by change orders")
    expect(html).toContain("2b</td><td>Net change by variances")
    expect(html).toContain("Change orders<small>C</small>")
    expect(html).toContain("Variances<small>D</small>")
    expect(html).not.toContain("Variance schedule")
    expect(html).toContain("$36,068.20 of the deposit carries forward")
    expect(html).toContain("Footer Labor &amp; Materials")
    expect(html).toContain("$44,497.69")
    expect(html).toContain("100%")
    expect(html).not.toContain("03 31 00 · Structural Concrete")
  })

  it("prints a variance schedule and line 2b from the variances in the contract", () => {
    const html = report("cost_code", [
      {
        id: "co-1", recordType: "variance", number: "V-001", title: "Waterproofing membrane price increase", executedAt: "2026-10-15T12:00:00.000Z",
        costCodes: ["07 10 00"], firstBilled: null, name: "V-001 · Waterproofing membrane price increase", amount: 1_700, current: true, assemblies: [],
      },
    ])
    expect(html).toContain("Variance schedule")
    expect(html).toContain("Waterproofing membrane price increase")
    expect(html).toContain("Application 1 (this period)")
    expect(html).toMatch(/2a<\/td><td>Net change by change orders<\/td><td class="num">\$0\.00/)
    expect(html).toMatch(/2b<\/td><td>Net change by variances<\/td><td class="num">\$1,700\.00/)
  })

  it("lists cost codes under each assembly when the client sees assembly detail", () => {
    expect(report("assembly")).toContain("03 31 00 · Structural Concrete")
  })
})
