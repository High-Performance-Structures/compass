import { describe, expect, it } from "vitest"

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
  })

  it("snapshots phase descriptions and selected acknowledgements", () => {
    expect(projectEstimatePhaseDescriptions.divisionCode.name).toBe(
      "division_code"
    )
    expect(projectEstimateAcknowledgements.templateId.name).toBe("template_id")
    expect(projectEstimateAcknowledgements.body.name).toBe("body")
  })
})
