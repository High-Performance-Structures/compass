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
    expect(vendor).toContain('new ExtendedContactField("name", "actpay", "vndnme"')
    expect(vendor).toContain('new ExtendedContactField("email", "actpay", "e_mail"')
    expect(vendor).toContain('new ExtendedContactField("phone", "actpay", "phnnum"')
    expect(client.match(/new ExtendedContactField\(/g)).toHaveLength(1)
    expect(vendor.match(/new ExtendedContactField\(/g)).toHaveLength(3)
    // Client primary email stays out: its Sage binding is unverified.
    expect(client).not.toContain("stmeml")
    expect(client).not.toContain("primaryEmail")
  })

  it("keeps a client company's email and phone on its first Sage contact line", () => {
    // Sage accepts ClientModRq Email1/Phone1 but stores nothing; reccln.e_mail
    // and phnnum stay blank. Email and phone live on clncnt contact lines.
    const line = block("ClientLineFields = {")
    expect(line).toContain('new ContactField("phone", "phnnum", "Phone")')
    expect(line).toContain('new ContactField("email", "e_mail", "Email")')
    expect(line.indexOf('"Phone"')).toBeLessThan(line.indexOf('"Email"'))
    const first = block("private static ClientLine ReadClientFirstLine", "return line;")
    expect(first).toContain('" FROM dbo.clncnt WHERE _idref = @client ORDER BY linnum"')
    expect(first).toContain('"SELECT TOP (1) linnum"')
    const query = block("private static ContactSnapshot QueryContact", "private static string ContactRevision")
    expect(query).toContain("ReadClientFirstLine(connection, snapshot.sageRecordId)")
    expect(query.indexOf("ReadClientFirstLine(")).toBeLessThan(query.indexOf("snapshot.revision = ContactRevision(snapshot);"))
    const append = block("private static void AppendClientLineChanges", "private static void PostContactResult")
    expect(append).toContain('clientLine.LineId > 0 ? "ClientContactMod" : "ClientContactAdd"')
    expect(append).toContain("<ObjectRef><LineID>")
    expect(append).toContain("<ContactName>")
    expect(append).toContain("Sage client contact line is unknown; no write attempted.")
    const target = block("private static ClientLineTarget ClientLineTargetFor", "private static ContactField[] FieldsFor")
    expect(target).toContain("if (line != null) return new ClientLineTarget { LineId = line.Number };")
    expect(writer).not.toContain('"Email1"')
  })

  it("adds the contact line element after every top-level client field", () => {
    const build = block("private static string BuildContactXml", "private static void AppendClientLineChanges")
    expect(build).toContain("if (!IsClientLineField(kind, field.Key)) topLevel.Add(field);")
    expect(build.indexOf("OrderedForSchema(kind, topLevel.ToArray())"))
      .toBeLessThan(build.indexOf("AppendClientLineChanges(body, kind, proposed, clientLine);"))
    const prepare = block("private static PendingContactWrite PrepareContactWrite", "private static PendingContactWrite PrepareContactCreate")
    expect(prepare).toContain("clientLine = ClientLineTargetFor(TargetCompany, before);")
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
    const prepare = block("private static PendingContactWrite PrepareContactWrite", "private static PendingContactWrite PrepareContactCreate")
    const revision = prepare.indexOf("Sage contact changed since the approved snapshot; no write attempted.")
    const beforeValue = prepare.indexOf("Approved before-value differs from Sage; no write attempted.")
    const build = prepare.indexOf("item.Xml = BuildContactXml(")
    expect(revision).toBeGreaterThan(0)
    expect(beforeValue).toBeGreaterThan(revision)
    expect(build).toBeGreaterThan(beforeValue)
    // Preparing never talks to the Sage API; only SubmitContactWrites does.
    expect(prepare).not.toContain("ApiSession")
    expect(prepare).not.toContain("Submit(")
    expect(prepare).toContain("Sage contact identity changed before write.")
    expect(prepare).toContain("Approved proposal contains an unsupported field.")
    // The result Compass applies is a fresh read-back after the write.
    const finish = block("private static void FinishContactWrite", "private static void FinishContactCreate")
    expect(finish).toContain("QueryContact(TargetCompany, task)")
    expect(finish).not.toContain("ApiSession")
  })

  it("sends every write and Add of a poll through one Sage API session", () => {
    // A second ApiSession in one process fails inside IMBXML.EnableRequests
    // with a NullReferenceException; every contact write once failed this way.
    expect(writer.match(/new ApiSession\(Required\("SAGE_API_USER"\), password\)\)/g)).toHaveLength(1)
    const submit = block("private static void SubmitContactWrites", "private static void FinishContactWrite")
    expect(submit.indexOf("using (new ApiSession(")).toBeLessThan(submit.indexOf("item.Attempted = true;"))
    expect(submit.indexOf("item.Attempted = true;")).toBeLessThan(submit.indexOf("Submit(item.Xml, password)"))
    expect(submit).not.toContain("QueryContact(")
    const run = block("private static int RunContactBridge()", "private static void ProcessClientDirectoryRefresh")
    expect(run.indexOf("PrepareContactWrite(write)")).toBeLessThan(run.indexOf("SubmitContactWrites(pending)"))
    expect(run.indexOf("PrepareContactCreate(create)")).toBeLessThan(run.indexOf("SubmitContactWrites(pending)"))
    expect(run.indexOf("SubmitContactWrites(pending)")).toBeLessThan(run.indexOf("FinishContactWrite(item)"))
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
    const schemaTest = block("private static void ValidateContactSchema()", "BuildVendorPrimaryEmailTestXml(")
    expect(schemaTest).toContain("ContactField[] fields = WritableFieldsFor(kind);")
    // Both contact-line forms: change line 1, and add a first line.
    expect(schemaTest).toContain("new ClientLineTarget { LineId = 1 }")
    expect(schemaTest).toContain('new ClientLineTarget { AddName = "Test" }')
  })
})
