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
  it("keeps the unverified vendor mapping outside the production field allowlist", () => {
    const vendorFields = writer.split("private static readonly ContactField[] VendorCompanyFields = {")[1]
      ?.split("};")[0]
    expect(vendorFields).toBeDefined()
    expect(vendorFields).not.toContain("primaryEmail")
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
