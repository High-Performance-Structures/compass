import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type {
  ProjectEstimateSummary,
  ProjectEstimateVersionComparison,
} from "@/app/actions/project-estimates"
import { ProjectEstimateVersionComparisonDocument } from "@/components/projects/project-estimate-version-comparison"

function estimate(
  id: string,
  versionNumber: number,
  estimateDate: string
): ProjectEstimateSummary {
  return {
    id,
    estimateNumber: "COMPASS-00",
    versionNumber,
    title: "Developer estimate",
    status: versionNumber === 1 ? "superseded" : "draft",
    estimateDate,
    clientName: "Example Client",
    clientSignerContactId: null,
    clientSignerName: "Alex Owner",
    clientSignerTitle: "Owner",
    clientSignerEmail: "alex@example.com",
    clientSigners: [{
      contactId: null,
      name: "Alex Owner",
      title: "Owner",
      email: "alex@example.com",
      initials: "AO",
    }],
    companySignerContactId: null,
    companySignerName: "Jordan Builder",
    companySignerTitle: "Project Manager",
    companySignerEmail: "jordan@example.com",
    companySignerInitials: "JB",
    sourceWorkbookUrl: null,
    defaultTaxEntityId: null,
    defaultTaxCode: null,
    defaultTaxName: null,
    defaultTaxRateBasisPoints: 0,
    termsTemplateId: null,
    contractTerms: null,
    introductionTemplateId: null,
    introductionText: null,
    closingTemplateId: null,
    closingText: null,
    clientReportMode: "line_items",
    directCostCents: versionNumber === 1 ? 10_000 : 12_500,
    markupCents: 0,
    taxCents: 0,
    builderFeeBaseCents: versionNumber === 1 ? 10_000 : 12_500,
    overheadRateBasisPoints: 0,
    overheadCents: 0,
    marginRateBasisPoints: 0,
    marginCents: 0,
    contingencyRateBasisPoints: 0,
    contingencyCents: 0,
    builderFeeCents: 0,
    estimateTotalCents: versionNumber === 1 ? 10_000 : 12_500,
    foxitStatus: "not_started",
    foxitEnvelopeId: null,
    foxitEmbeddedSessionUrl: null,
    signaturePackageUrl: null,
    signedAt: null,
    acceptanceMethod: null,
    acceptanceNote: null,
    acceptanceEvidenceLabel: null,
    acceptanceRecordedByName: null,
    acceptedAt: null,
    sageStatus: "not_ready",
    createdAt: `${estimateDate}T12:00:00.000Z`,
    updatedAt: `${estimateDate}T12:00:00.000Z`,
  }
}

describe("estimate version comparison document", () => {
  it("prints both version dates, totals, and changed scope side by side", () => {
    const baseEstimate = estimate("estimate-1", 1, "2026-08-01")
    const revisedEstimate = estimate("estimate-2", 2, "2026-08-21")
    const data: ProjectEstimateVersionComparison = {
      canEdit: true,
      projectNumber: "COMPASS",
      projectName: "Compass Developer",
      estimates: [revisedEstimate, baseEstimate],
      baseEstimate,
      revisedEstimate,
      comparison: {
        baseTotalCents: 10_000,
        revisedTotalCents: 12_500,
        deltaCents: 2_500,
        changedRowCount: 1,
        divisions: [
          {
            divisionCode: "01",
            divisionName: "General Requirements",
            baseTotalCents: 10_000,
            revisedTotalCents: 12_500,
            deltaCents: 2_500,
            rows: [
              {
                key: "01|01-1000",
                divisionCode: "01",
                divisionName: "General Requirements",
                costCode: "01-1000",
                baseDescription: "Original supervision",
                revisedDescription: "Revised supervision",
                baseTotalCents: 10_000,
                revisedTotalCents: 12_500,
                deltaCents: 2_500,
                change: "changed",
              },
            ],
          },
        ],
      },
    }

    const html = renderToStaticMarkup(
      createElement(ProjectEstimateVersionComparisonDocument, { data })
    )

    expect(html).toContain("Compass Developer")
    expect(html).toContain("Estimate date: August 1, 2026")
    expect(html).toContain("Estimate date: August 21, 2026")
    expect(html).toContain("Original supervision")
    expect(html).toContain("Revised supervision")
    expect(html).toContain("+$25.00")
  })
})
