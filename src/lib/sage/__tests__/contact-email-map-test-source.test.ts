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
