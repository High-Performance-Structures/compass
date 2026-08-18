import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const source = readFileSync(
  new URL(
    "../../../../scripts/Sage.100.Contractor.CompassClientProjectWriter.cs",
    import.meta.url
  ),
  "utf8"
)

describe("Sage client/project worker source boundary", () => {
  it("contains only the two approved queue operation names", () => {
    expect(source).toContain('"ensure_client"')
    expect(source).toContain('"ensure_client_and_job"')
    expect(source).not.toMatch(/DeleteRq|ModRq|VoidRq/)
  })

  it("pins both API and SQL access to the HPS Sage company", () => {
    expect(source).toContain(
      'private const string TargetCompany = "High Performance Structures Inc"'
    )
    expect(source).toContain('new SqlCommand("SELECT DB_NAME()", connection)')
    expect(source).toContain("SAGE_CLIENT_PROJECT_WRITES_ENABLED")
  })

  it("validates generated XML before submitting it", () => {
    expect(source).toContain("ValidateXml(xml)")
    expect(source.indexOf("ValidateXml(xml)")).toBeLessThan(
      source.indexOf('Invoke("submitXML"')
    )
  })

  it("has a read-only diagnostic path that verifies Sage without claiming work", () => {
    expect(source).toContain('"--diagnose"')
    expect(source).toContain("RunDiagnostics()")
    expect(source).toContain(
      'new string[] { "Current", "Warranty", "Complete", "Inactive", "Archive", "Other" }'
    )
    expect(source).toContain(
      'using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))'
    )
    expect(source).toContain(
      'BuildClientXml(clientRequestName, user, new ClientPayload'
    )
    expect(source).toContain(
      'BuildJobXml(jobRequestName, user, new JobPayload'
    )
  })

  it("prefers Sage add-next requests so Sage allocates client and job numbers", () => {
    expect(source).toContain(
      'new string[] { "ClientAddNextRq", "ClientAddRq" }'
    )
    expect(source).toContain(
      'new string[] { "JobAddNextWithCustomJobStatusRq", "JobAddNextRq", "JobAddWithCustomJobStatusRq", "JobAddRq" }'
    )
  })

  it("limits exact-name reconciliation to post-add readback", () => {
    expect(source).toContain("clientRecord = FindClientAfterAdd(client)")
    expect(source).toContain("private static SageRecord FindClientAfterAdd")
    expect(source).toContain(
      "Sage can accept the client while leaving reccln.e_mail blank"
    )
    expect(source).toContain(
      "A Sage client matches the requested name but not the requested email; no write was attempted."
    )
  })

  it("does not require exclusive company access for normal API writes", () => {
    expect(source).not.toContain("GetExclusiveAccess")
    expect(source).not.toContain("ReleaseExclusiveAccess")
  })

  it("cleans up failed API initialization and exposes Sage errors", () => {
    expect(source).toContain("catch\n                {\n                    ResetApi()")
    expect(source).toContain("if (ApiInitialized && ApiInstance != null)")
    expect(source).toContain("catch (TargetInvocationException error)")
    expect(source).toContain("error.InnerException")
  })
})
