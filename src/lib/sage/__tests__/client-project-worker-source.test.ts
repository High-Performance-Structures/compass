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
  it("contains only the seven approved queue operations and no destructive request", () => {
    expect(source).toContain('"ensure_client"')
    expect(source).toContain('"ensure_client_and_job"')
    expect(source).toContain('"update_client_email"')
    expect(source).toContain('"set_job_client"')
    expect(source).toContain('"add_client_contact"')
    expect(source).toContain('"set_job_tax_district"')
    expect(source).toContain('"ensure_vendor"')
    expect(source).toContain('BuildXml("ClientModRq"')
    expect(source).toContain('BuildXml("JobModRq"')
    expect(source).not.toMatch(/DeleteRq|VoidRq|VendorModRq/)
  })

  it("adds a vendor only behind its own local switch and never over a name Sage already has", () => {
    const ensureVendor = source.slice(
      source.indexOf("private static WriteOutcome ProcessEnsureVendor"),
      source.indexOf("private static readonly string[] VendorAddRequests")
    )
    expect(ensureVendor).toContain('"SAGE_VENDOR_CREATE_WRITES_ENABLED"')
    expect(ensureVendor).toContain("Local Sage vendor-add switch is off; no write was attempted.")
    // The name check runs before the add is submitted.
    expect(ensureVendor.indexOf("FindVendorByName(vendor.name)")).toBeLessThan(ensureVendor.indexOf("submit Sage vendor add"))
    expect(ensureVendor).toContain("link it in Compass instead of adding another. No write was attempted.")
  })

  it("only gives a client to an existing job that has none, matched by ID and name", () => {
    const setJobClient = source.slice(
      source.indexOf("private static WriteOutcome ProcessSetJobClient"),
      source.indexOf("private static WriteOutcome ProcessClientEmailUpdate")
    )
    expect(setJobClient).toContain("The Sage job ID and number do not identify the same job")
    expect(setJobClient).toContain("The Sage job name has changed since Compass matched it")
    expect(setJobClient).toContain("The Sage job already has client")
    expect(setJobClient).not.toMatch(/JobAdd/)
    expect(source).toContain("JobModRq has no client field; no write was attempted.")
  })

  it("only fills a blank job tax district, never replacing one already set", () => {
    const setTaxDistrict = source.slice(
      source.indexOf("private static WriteOutcome ProcessSetJobTaxDistrict"),
      source.indexOf("private static bool TaxDistrictExists")
    )
    expect(setTaxDistrict).toContain("The Sage job ID and number do not identify the same job")
    const refuse = setTaxDistrict.indexOf("already has tax district")
    expect(refuse).toBeGreaterThan(-1)
    expect(refuse).toBeLessThan(setTaxDistrict.indexOf("submit Sage job tax district"))
    expect(setTaxDistrict).not.toMatch(/JobAdd/)
    expect(source).toContain("JobModRq has no sales tax district field; no write was attempted.")
  })

  it("refuses to add a job when Sage already has one with the same project number", () => {
    const guard = source.slice(
      source.indexOf("private static SageRecord RefuseJobWithSameProjectNumber"),
      source.indexOf("private static bool AddedRecently")
    )
    expect(guard).toContain('@"^([A-Za-z]+-[0-9]+)(?:-|$)"')
    expect(guard).toContain('prefix + "-%"')
    expect(guard).toContain("link that job in Compass instead of adding another. No write was attempted.")
    // The guard runs before any client or job add is submitted.
    expect(source.indexOf("RefuseJobWithSameProjectNumber(request.payload.job, clientRecord, retry)")).toBeLessThan(
      source.indexOf('RunStage("submit Sage client add"')
    )
  })

  it("on a retried claim, takes its own earlier add instead of failing", () => {
    // A poll over 10 minutes is claimed again. The first attempt's add is in
    // Sage; refusing it would show "failed" although Sage has the record.
    // Only Compass's automatic reclaim of a stale claim counts; a staff
    // "Send to Sage" resend keeps every refusal.
    expect(source).toContain("bool retry = request.reclaimed;")
    expect(source).not.toContain("request.attempt > 1")
    const route = readFileSync(
      new URL("../../../app/api/integrations/sage/client-project-writes/requests/route.ts", import.meta.url),
      "utf8"
    )
    expect(route).toContain('reclaimed: candidate.status === "running",')
    const guard = source.slice(
      source.indexOf("private static SageRecord RefuseJobWithSameProjectNumber"),
      source.indexOf("private static bool AddedRecently")
    )
    expect(guard).toContain("if (retry && client != null && numbers.Count == 1 && clients[0] == client.Number)")
    expect(guard).toContain('AddedRecently("actrec", own.Id)')
    expect(guard.indexOf("return own;")).toBeLessThan(guard.indexOf("link that job in Compass instead"))
    const findClient = source.slice(
      source.indexOf("private static SageRecord FindClient(ClientPayload client, bool retry)"),
      source.indexOf("private static SageRecord FindClientAfterAdd")
    )
    expect(findClient).toContain('retry && AddedRecently("reccln", nameMatch.Id)')
    expect(findClient).toContain("matches the requested name but has no email")
    const recent = source.slice(
      source.indexOf("private static bool AddedRecently"),
      source.indexOf("private static SageRecord FindJobByNumber")
    )
    expect(recent).toContain("SELECT COL_LENGTH(@table, 'insdte')")
    expect(recent).toContain("DateTime.Now.AddDays(-2)")
  })

  it("only adds a contact line to the matched client, and skips a person already listed", () => {
    const addContact = source.slice(
      source.indexOf("private static WriteOutcome ProcessAddClientContact"),
      source.indexOf("private static WriteOutcome ProcessClientEmailUpdate")
    )
    expect(addContact).toContain("The Sage client ID and number do not identify the same client")
    expect(addContact).toContain("ClientListsContact(clientRecord.Id, contact.name)")
    expect(addContact.indexOf("ClientListsContact(")).toBeLessThan(addContact.indexOf("submit Sage client contact add"))
    expect(source).toContain("<ClientContactAdd>")
    expect(source).not.toMatch(/ClientContactMod|ClientContactDelete/)
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
    expect(source).toContain("return FindClientAfterAdd(client)")
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
    expect(source).toContain("catch\n                {\n                    ResetApi(true)")
    expect(source).toContain("if (ApiInitialized && ApiInstance != null)")
    expect(source).toContain("catch (TargetInvocationException error)")
    expect(source).toContain("error.InnerException")
  })
})
