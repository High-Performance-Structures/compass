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

  it("snapshots both contract signers on the estimate", () => {
    expect(projectEstimates.clientSignerName.name).toBe("client_signer_name")
    expect(projectEstimates.companySignerName.name).toBe(
      "company_signer_name"
    )
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0128_estimate_signers.sql"),
      "utf8"
    )
    expect(migration).toContain("ADD `client_signer_contact_id` text")
    expect(migration).toContain("ADD `company_signer_contact_id` text")
  })

  it("supports multiple client signers and staged Foxit preparation", () => {
    expect(projectEstimates.clientSignersJson.name).toBe("client_signers_json")
    expect(projectEstimates.companySignerInitials.name).toBe(
      "company_signer_initials"
    )
    expect(projectEstimates.foxitEmbeddedSessionUrl.name).toBe(
      "foxit_embedded_session_url"
    )
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0129_estimate_multi_signers_foxit.sql"),
      "utf8"
    )
    expect(migration).toContain("ADD `client_signers_json` text")
    expect(migration).toContain("ADD `foxit_prepared_source_hash` text")
  })
})
