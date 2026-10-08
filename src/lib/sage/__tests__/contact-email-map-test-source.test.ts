import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const writer = readFileSync(
  new URL("../../../../scripts/Sage.100.Contractor.CompassContactWriter.cs", import.meta.url),
  "utf8"
)
const entrypoint = readFileSync(
  new URL("../../../../scripts/Sage.100.Contractor.CompassClientProjectWriter.cs", import.meta.url),
  "utf8"
)
const harness = readFileSync(
  new URL("../../../../scripts/test_sage_contacts_hps_test.ps1", import.meta.url),
  "utf8"
)
const installer = readFileSync(
  new URL("../../../../scripts/install_sage_contact_writer_release.ps1", import.meta.url),
  "utf8"
)

describe("pinned Sage contact source", () => {
  it("keeps both guarded host scripts pinned to the current writer bytes", () => {
    const hash = createHash("sha256").update(writer.replace(/\r\n/g, "\n")).digest("hex").toUpperCase()
    expect(harness).toContain(`Name = 'Sage.100.Contractor.CompassContactWriter.cs'; Hash = '${hash}'`)
    expect(installer).toContain(`Name = 'Sage.100.Contractor.CompassContactWriter.cs'; Hash = '${hash}'`)
    expect(harness).toContain("[ValidatePattern('^[0-9a-fA-F]{40}$')]")
    expect(installer).toContain("[ValidatePattern('^[0-9a-fA-F]{40}$')]")
    expect(harness).toContain("/$SourceCommit/scripts")
    expect(installer).toContain("/$SourceCommit/scripts")
  })

  it("reads employee names only as identity evidence", () => {
    expect(writer).toContain('if (task.kind == "employee") query.Append(", fstnme, lstnme")')
    expect(writer).toContain("snapshot.identityName = fullName.Length == 0 ? null : fullName")
    const employeeFields = writer.split("private static readonly ContactField[] EmployeeFields = {")[1]
      ?.split("};")[0]
    expect(employeeFields).not.toContain("fstnme")
    expect(employeeFields).not.toContain("lstnme")
  })

  it("backs up the installed writer afresh on every HPS Test rerun", () => {
    expect(harness).toContain("'CompassSageClientProjectWriter.pre-contact-write-test-' + (Get-Date -Format 'yyyyMMdd-HHmmss')")
    expect(harness).toContain("(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash")
    expect(harness).not.toContain("$priorBackup")
  })

  it("allows blank HPS Test contact fields when selecting exact records", () => {
    const selection = writer.split("private static ContactTask FindContactTestRecord")[1]
      ?.split("private static int RunContactSchemaTest")[0] ?? ""
    expect(selection).toContain('" > 0" + eligibility +')
    expect(selection).toContain('string eligibility = person ?')
    expect(selection).toContain('kind == "employee" ?')
    expect(selection).toContain('c.fstnme')
    expect(selection).toContain('c.lstnme')
    expect(selection).not.toContain("check City is populated")
  })
})

describe("HPS Test contact primary-email mapping probe", () => {
  it("allows the HPS Test-verified vendor mapping but not the client mapping", () => {
    const vendorFields = writer.split("private static readonly ContactField[] VendorCompanyFields = {")[1]
      ?.split("};")[0]
    const clientFields = writer.split("private static readonly ContactField[] ClientCompanyFields = {")[1]
      ?.split("};")[0]
    expect(vendorFields).toBeDefined()
    expect(vendorFields).toContain('new ContactField("primaryEmail", "prmeml", "PrimaryEmail")')
    expect(clientFields).not.toContain("primaryEmail")
    expect(writer).toContain('"SELECT prmeml FROM dbo.actpay WHERE _idnum = @id"')
    expect(writer).toContain("BuildVendorPrimaryEmailTestXml")
  })

  it("requires the explicit HPS Test switch and restores both probed values", () => {
    expect(entrypoint).toContain('"--contact-email-map-test"')
    expect(writer).toContain("SAGE_CONTACT_TEST_WRITES_ENABLED")
    expect(writer).toContain("ContactTestCompany")
    expect(writer).toContain("HPS Test vendor primary email did not restore")
    expect(writer).toContain("HPS Test email side effect did not restore")
    expect(harness).toContain("& $installed --contact-email-map-test")
    expect(harness).toContain("production_writer_restored=$restored")
  })
})

describe("HPS Test child-contact add probe", () => {
  it("validates add and delete XML before swapping the production writer", () => {
    expect(entrypoint).toContain('"--contact-child-add-test"')
    expect(writer).toContain('BuildTestChildXml("client_person", 1, "Compass QA", null)')
    expect(writer).toContain('BuildTestChildXml("vendor_person", 1, null, 2)')
    expect(harness).toContain("& $candidate --contact-schema-test")
    expect(harness).toContain("& $installed --contact-child-add-test")
  })

  it("deletes only a new child of the exact test parent and verifies siblings", () => {
    expect(writer).toContain('before.ContainsKey(added.sageRecordId)')
    expect(writer).toContain('TestChildRowsPreserved(before, afterAdd)')
    expect(writer).toContain('TestChildRowsPreserved(before, restored)')
    expect(writer).toContain('More than one new HPS Test child; no delete attempted.')
    expect(writer).toContain('New HPS Test child did not match this probe marker; no delete attempted.')
  })
})

describe("production contact Add boundary", () => {
  it("keeps contact polling sequential and disabled unless explicitly enabled", () => {
    expect(entrypoint).toContain('Environment.GetEnvironmentVariable("SAGE_CONTACT_BRIDGE_ENABLED")')
    expect(entrypoint.indexOf("PollOnce();")).toBeLessThan(entrypoint.indexOf("RunContactBridge() != 0"))
    expect(writer).toContain('Environment.GetEnvironmentVariable("SAGE_CONTACT_CREATES_ENABLED")')
    expect(writer).toContain('Environment.GetEnvironmentVariable("SAGE_CONTACT_WRITES_ENABLED")')
    const transport = writer.split("private static string SendContact(string method, string target, string body)")[1] ?? ""
    expect(transport).toContain('Environment.GetEnvironmentVariable("SAGE_CONTACT_CREATES_ENABLED")')
    expect(transport).toContain('Environment.GetEnvironmentVariable("SAGE_CONTACT_WRITES_ENABLED")')
    expect(transport.indexOf('Environment.GetEnvironmentVariable("SAGE_CONTACT_CREATES_ENABLED")'))
      .toBeLessThan(transport.indexOf('request.Headers["x-compass-contact-bridge-version"] = "2"'))
  })

  it("marks an API Add attempted before submission and reads back the new child", () => {
    const creation = writer.split("private static void ProcessContactCreate(ContactTask task)")[1]
      ?.split("private static void PostContactCreateResult")[0] ?? ""
    expect(creation).not.toBe("")
    expect(creation).toContain("attempted = true; // An API timeout does not prove that Sage rolled back the Add.")
    expect(creation.indexOf("using (new ApiSession(")).toBeLessThan(creation.indexOf("attempted = true;"))
    expect(creation.indexOf("attempted = true;")).toBeLessThan(creation.indexOf("Submit(xml,"))
    expect(creation).toContain("ReadContactChildRows(TargetCompany, task.kind, task.parentSageRecordId)")
    expect(creation).toContain("TestChildRowsPreserved(before, after)")
    expect(creation).toContain("QueryContact(TargetCompany, added)")
  })
})
