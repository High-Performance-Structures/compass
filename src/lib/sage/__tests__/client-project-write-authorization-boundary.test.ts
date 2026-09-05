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
})
