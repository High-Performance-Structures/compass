import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  estimateTermsTemplates,
  projectEstimateAcknowledgements,
  projectEstimatePhaseDescriptions,
  projectEstimates,
} from "@/db/schema-estimates"

describe("estimate client report persistence contract", () => {
  it("scopes reusable estimate copy by department and content type", () => {
    expect(estimateTermsTemplates.departmentCode.name).toBe("department_code")
    expect(estimateTermsTemplates.templateType.name).toBe("template_type")
    expect(estimateTermsTemplates.sourceDocumentId.name).toBe(
      "source_document_id"
    )
  })

  it("stores editable opening and closing estimate copy", () => {
    expect(projectEstimates.introductionText.name).toBe("introduction_text")
    expect(projectEstimates.closingText.name).toBe("closing_text")
    expect(projectEstimates.clientReportMode.name).toBe("client_report_mode")
  })

  it("migrates report choice and repairs prior PlanSwift visibility", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0125_estimate_client_report_mode.sql"),
      "utf8"
    )
    expect(migration).toContain("ADD `client_report_mode` text")
    expect(migration).toContain("`specifications` LIKE '%PlanSwift source:%'")
    expect(migration).toContain("SET `owner_visible` = 1")
  })

  it("snapshots phase descriptions and selected acknowledgements", () => {
    expect(projectEstimatePhaseDescriptions.divisionCode.name).toBe(
      "division_code"
    )
    expect(projectEstimateAcknowledgements.templateId.name).toBe("template_id")
    expect(projectEstimateAcknowledgements.body.name).toBe("body")
  })
})
