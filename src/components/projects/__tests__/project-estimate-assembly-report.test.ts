import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getProjectEstimateWorkspace: vi.fn() }))
vi.mock("@/app/actions/project-estimates", () => ({ getProjectEstimateWorkspace: mocks.getProjectEstimateWorkspace }))
vi.mock("@/lib/project-route-id", () => ({ requireProjectRouteId: vi.fn(async (id: string) => id) }))
vi.mock("@/components/projects/project-brand-logo", () => ({ ProjectBrandLogo: () => null }))
vi.mock("@/components/projects/project-brand-contact-details", () => ({ ProjectBrandContactDetails: () => null }))
vi.mock("@/components/projects/project-estimate-report-actions", () => ({ ProjectEstimateReportActions: () => null }))

import ProjectEstimatePrintPage from "@/app/print/projects/[id]/estimate/page"

const lines = [
  { id: "earth", assemblyId: "foundation", divisionCode: "31", divisionName: "Earthwork", costCode: "31-100", description: "Excavation", lineTotalCents: 1200000, ownerVisible: true },
  { id: "concrete", assemblyId: "foundation", divisionCode: "03", divisionName: "Concrete", costCode: "03-100", description: "Footings", lineTotalCents: 1800000, ownerVisible: true },
  { id: "other", assemblyId: null, divisionCode: "01", divisionName: "General requirements", costCode: "01-100", description: "Mobilization", lineTotalCents: 500000, ownerVisible: true },
  { id: "private", assemblyId: "foundation", divisionCode: "03", divisionName: "Concrete", costCode: "03-999", description: "Private pricing", lineTotalCents: 9900000, ownerVisible: false },
].map((line, sortOrder) => ({ ...line, reportPhaseId: null, costCodeName: line.costCode, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, costItems: [], quantity: 1, unit: "LS", unitCostCents: line.lineTotalCents, specifications: null, includeInBuilderFee: true, sortOrder }))

async function report(mode: string): Promise<string> {
  mocks.getProjectEstimateWorkspace.mockResolvedValue({
    projectName: "Example project", projectNumber: "D-100", department: "D", reportMode: mode,
    activeEstimate: {
      id: "estimate", status: "draft", title: "Construction Estimate", estimateNumber: "EST-100", versionNumber: 1,
      estimateDate: "2026-09-30", createdAt: "2026-09-30T12:00:00Z", clientName: "Example Owner",
      clientSigners: [], companySignerName: null, companySignerTitle: null, companySignerEmail: null,
      introductionText: "Estimate introduction", closingText: "Estimate closing", contractTerms: "Existing contract terms",
      builderFeeCents: 350000, builderFeeBaseCents: 3500000, overheadCents: 350000, overheadRateBasisPoints: 1000,
      marginCents: 0, marginRateBasisPoints: 0, contingencyCents: 0, contingencyRateBasisPoints: 0,
    },
    assemblies: [{ id: "foundation", name: "Foundation package", description: "Complete foundation scope", sortOrder: 0 }],
    reportPhases: [], lines, phaseDescriptions: [{ divisionCode: "03", description: "Custom concrete scope" }],
    basisDocuments: [], selectedAcknowledgements: [],
  })
  const page = await ProjectEstimatePrintPage({ params: Promise.resolve({ id: "project" }), searchParams: Promise.resolve({ estimateId: "estimate" }) })
  return renderToStaticMarkup(page)
}

describe("printed estimate report formats", () => {
  it("prints assembly totals without exposing individual items", async () => {
    const html = await report("assembly_summary")
    expect(html).toContain("Foundation package")
    expect(html).toContain("Complete foundation scope")
    expect(html).toContain("$30,000.00")
    expect(html).toContain("Other work")
    expect(html).not.toContain("Excavation")
    expect(html).not.toContain("31-100")
  })

  it("prints items and subtotals inside each assembly with source divisions", async () => {
    const html = await report("assembly_items")
    expect(html).toContain("Total: Foundation package")
    expect(html).toContain("$30,000.00")
    expect(html).toContain("31-100")
    expect(html).toContain("Excavation")
    expect(html).toContain("03 · Concrete")
    expect(html).toContain("Total: Other work")
  })

  it("preserves division summary, phase descriptions, and division detail", async () => {
    const summary = await report("division_summary")
    expect(summary).toContain("Concrete")
    expect(summary).not.toContain("Footings")
    expect(summary).not.toContain("Foundation package")
    expect(await report("phase_summary")).toContain("Custom concrete scope")
    const detail = await report("line_items")
    expect(detail).toContain("Total: 03 · Custom concrete scope")
    expect(detail).toContain("Footings")
    expect(detail).not.toContain("Foundation package")
  })

  it("preserves totals, builder fee, copy and privacy in every format", async () => {
    for (const mode of ["division_summary", "phase_summary", "line_items", "assembly_summary", "assembly_items"]) {
      const html = await report(mode)
      expect(html).toContain("$38,500.00")
      expect(html).toContain("$3,500.00")
      expect(html).toContain("Estimate introduction")
      expect(html).toContain("Estimate closing")
      expect(html).toContain("Existing contract terms")
      expect(html).not.toContain("Private pricing")
      expect(html).not.toContain("03-999")
    }
  })
})
