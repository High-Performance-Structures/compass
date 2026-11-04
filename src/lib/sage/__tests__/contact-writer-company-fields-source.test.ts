import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/*
 * Company name, email and phone reach Sage only through the contact writer's
 * reviewed Mod request path. These checks pin the writer's guards in source,
 * since the Sage host (SQL and mbxml.xsd) is not available to CI.
 */

const writer = readFileSync(
  new URL("../../../../scripts/Sage.100.Contractor.CompassContactWriter.cs", import.meta.url),
  "utf8"
)

function block(start: string, end = "};"): string {
  const after = writer.split(start)[1]
  expect(after).toBeDefined()
  return after?.split(end)[0] ?? ""
}

describe("Sage contact writer: company name, email and phone", () => {
  it("maps exactly the reported Sage columns", () => {
    const client = block("ClientCompanyExtendedFields = {")
    const vendor = block("VendorCompanyExtendedFields = {")
    expect(client).toContain('new ExtendedContactField("name", "reccln", "clnnme"')
    expect(client).toContain('new ExtendedContactField("email", "reccln", "e_mail"')
    expect(client).toContain('new ExtendedContactField("phone", "reccln", "phnnum"')
    expect(vendor).toContain('new ExtendedContactField("name", "actpay", "vndnme"')
    expect(vendor).toContain('new ExtendedContactField("email", "actpay", "e_mail"')
    expect(vendor).toContain('new ExtendedContactField("phone", "actpay", "phnnum"')
    expect(client.match(/new ExtendedContactField\(/g)).toHaveLength(3)
    expect(vendor.match(/new ExtendedContactField\(/g)).toHaveLength(3)
    // Client primary email stays out: its Sage binding is unverified.
    expect(client).not.toContain("stmeml")
    expect(client).not.toContain("primaryEmail")
  })

  it("never writes Sage tables with SQL; changes go through the Sage API", () => {
    expect(writer).not.toMatch(/\bUPDATE\s+dbo\./i)
    expect(writer).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(writer).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(writer).toContain('"SELECT COL_LENGTH(@table, @column)"')
  })

  it("reads an extended field only when both the column and the API element exist", () => {
    const available = block("private static List<ExtendedContactField> AvailableExtendedFields", "return available;")
    expect(available).toContain("ExtendedXmlElement(kind, field) != null && SageColumnExists(connection, field.Table, field.Sql)")
  })

  it("refuses a write when Sage changed since the approved read, before submitting anything", () => {
    const write = block("private static void ProcessContactTask", "private static void ProcessContactCreate")
    const revision = write.indexOf("Sage contact changed since the approved snapshot; no write attempted.")
    const beforeValue = write.indexOf("Approved before-value differs from Sage; no write attempted.")
    const submit = write.indexOf("Submit(xml")
    const readBack = write.lastIndexOf("QueryContact(TargetCompany, task)")
    expect(revision).toBeGreaterThan(0)
    expect(beforeValue).toBeGreaterThan(revision)
    expect(submit).toBeGreaterThan(beforeValue)
    // The result Compass applies is a fresh read-back after the write.
    expect(readBack).toBeGreaterThan(submit)
    expect(write).toContain("Sage contact identity changed before write.")
    expect(write).toContain("Approved proposal contains an unsupported field.")
  })

  it("sends only the approved changed fields, never clears a name, and never truncates", () => {
    const build = block("private static string BuildContactXml", "private static void PostContactResult")
    expect(build).toContain("ContactField[] allowed = WritableFieldsFor(kind);")
    expect(build).toContain("if (!known || proposed.ContainsKey(change.field))")
    expect(build).toContain("if (proposed.ContainsKey(field.Key)) body.Append('<')")
    expect(build).toContain("A Sage company name cannot be cleared; no write attempted.")
    expect(build).toContain("is longer than Sage allows; no write attempted.")
    expect(build).toContain("ValidateXml(xml);")
  })

  it("validates the extended fields' XML in the schema self-test", () => {
    const schemaTest = block("private static void ValidateContactSchema()", "ValidateContactXml(kind, 1, 1, changes, ContactTestCompany);")
    expect(schemaTest).toContain("ContactField[] fields = WritableFieldsFor(kind);")
  })
})
