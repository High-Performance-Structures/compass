import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
}

const customerActions = source("../../../app/actions/customers.ts")
const projectActions = source("../../../app/actions/projects.ts")
const resultsRoute = source(
  "../../../app/api/integrations/sage/client-project-writes/results/route.ts"
)
const windowsWriter = source(
  "../../../../scripts/Sage.100.Contractor.CompassClientProjectWriter.cs"
)
const repairScript = source(
  "../../../../scripts/repair_sage_client_project_writer.ps1"
)

describe("Sage customer/project creation authorization boundary", () => {
  it("queues the expected Sage write without a second person approval", () => {
    expect(customerActions).not.toContain("isSageWriteApproved")
    expect(projectActions).not.toContain("isSageWriteApproved")
    expect(customerActions).not.toContain('status: "approval_required"')
    expect(projectActions).not.toContain('status: "approval_required"')
    expect(customerActions).toContain('status: "queued"')
    expect(projectActions.match(/status: "queued"/g)?.length).toBeGreaterThanOrEqual(
      2
    )
  })

  it("retains normal Compass permissions and the operational switch", () => {
    expect(customerActions).toContain(
      'requirePermission(user, "customer", "create")'
    )
    expect(
      projectActions.match(/requirePermission\(user, "project", "create"\)/g)
        ?.length
    ).toBeGreaterThanOrEqual(2)
    expect(resultsRoute).toContain("sageClientProjectWritesEnabled")
  })

  it("writes returned Sage customer and job identities back to Compass", () => {
    expect(resultsRoute).toContain("UPDATE customers")
    expect(resultsRoute).toContain("sage_client_id = ?")
    expect(resultsRoute).toContain("sage_client_number = ?")
    expect(resultsRoute).toContain("UPDATE projects")
    expect(resultsRoute).toContain("sage_job_id = ?")
    expect(resultsRoute).toContain("sage_job_number = ?")
  })

  it("queues a Sage client update when a missing customer email is added", () => {
    expect(customerActions).toContain(
      "normalizedExistingEmail === null"
    )
    expect(customerActions).toContain(
      "normalizedNextEmail !== null"
    )
    expect(customerActions).toContain(
      'operationType: "update_client_email"'
    )
    expect(customerActions).toContain("Boolean(existing.sageClientId)")
    expect(customerActions).toContain("Boolean(existing.sageClientNumber)")
    expect(customerActions).toContain(
      "idempotencyKey: `customer:${id}:email-fill`"
    )
  })

  it("runs one Sage API session per one-minute scheduled process", () => {
    expect(windowsWriter).toContain(
      'using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))'
    )
    expect(windowsWriter.match(/using \(new ApiSession/g)).toHaveLength(2)
    expect(repairScript).toContain(
      'New-ScheduledTaskAction -Execute $binary -Argument "--once"'
    )
    expect(repairScript).toContain(
      "-RepetitionInterval (New-TimeSpan -Minutes 1)"
    )
  })

  it("limits client modification to filling a blank email", () => {
    expect(windowsWriter).toContain(
      "String.IsNullOrWhiteSpace(clientRecord.Email)"
    )
    expect(windowsWriter).toContain('return BuildXml("ClientModRq"')
    expect(windowsWriter).toContain(
      "The stored Sage client ID and number do not identify the same client"
    )
    expect(windowsWriter).toContain(
      "The Sage client already has a different email"
    )
    expect(windowsWriter).toContain(
      "Link its Sage client ID and number in Compass before filling the email"
    )
    expect(windowsWriter).not.toContain("ClientDelRq")
  })
})
