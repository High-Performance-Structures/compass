import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function script(name: string): string {
  return readFileSync(new URL(`../../../../scripts/${name}`, import.meta.url), "utf8")
}

const source = script("Sage.100.Contractor.CompassCostCodeRenameWriter.cs")
const writer = script("Sage.100.Contractor.CompassClientProjectWriter.cs")

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  const to = text.indexOf(end, from)
  expect(to).toBeGreaterThan(from)
  return text.slice(from, to)
}

describe("Sage cost code rename writer source boundary", () => {
  it("changes only the cost code description, through the Sage API, never SQL", () => {
    expect(source).toContain("<CostCodeModRq requestID=")
    expect(source).not.toMatch(/INSERT |UPDATE |DELETE |CostCodeAddRq|CostCodeDelRq|DelRq|VoidRq/)
    const build = between(source, "private static string BuildCostCodeRenameXml", "private static Dictionary<long, string> ReadCostCodeDescriptions")
    expect(build).toContain("<ObjectRef><ObjectID>")
    expect(build).toContain("<Desc>")
    expect(build).not.toMatch(/<(Unit|CostDivisionRef|WorkersCompCode1Ref|WorkersCompCode2Ref|WageMaximumAmount|DepartmentRef|Memo)>/)
    expect(build).toContain("ValidateXml(xml)")
  })

  it("refuses out-of-scope numbers and descriptions over 50 characters", () => {
    expect(source).toContain("private const int CostCodeDescriptionMax = 50;")
    const excluded = between(source, "private static string CostCodeRenameExcluded", "private static string CostCodeRenameItemError")
    expect(excluded).toContain("recnum <= 43")
    expect(excluded).toContain("recnum >= 500 && recnum <= 514")
    expect(excluded).toContain("recnum >= 900000000")
    const item = between(source, "private static string CostCodeRenameItemError", "private static string CostCodeRenameStatus")
    expect(item).toContain("CostCodeRenameExcluded(item.recnum)")
    expect(item).toContain("item.proposed.Length > CostCodeDescriptionMax")
  })

  it("renames a row only while Sage still shows the reviewed description", () => {
    const status = between(source, "private static string CostCodeRenameStatus", "private static List<CostCodeRenamePlanRow> PlanCostCodeRenames")
    expect(status).toContain('return "already_renamed"')
    expect(status).toContain('String.Equals(inSage, item.current, StringComparison.Ordinal)) { detail = "would rename"; return "rename"; }')
    expect(status).toContain('"skipped_changed"')
    expect(status).toContain("Sage has no cost code")
  })

  it("is a dry run unless --apply, and --apply refuses any error or skipped row before writing", () => {
    const run = between(source, "private static int RunCostCodeRename(string[] args)", "private static bool RevertCostCodeRenames")
    expect(run).toContain("bool apply = false")
    const session = run.indexOf("using (new ApiSession(")
    expect(run.indexOf("if (!apply)")).toBeLessThan(session)
    expect(run.indexOf('counts["skipped_changed"] > 0')).toBeLessThan(session)
    // The backup is written before the session opens; the read back happens after it closes.
    expect(run.indexOf("WriteCostCodeJson(backupPath")).toBeLessThan(session)
    expect(run.indexOf("ReadCostCodeDescriptions();", session)).toBeGreaterThan(session)
    expect(run).toContain("RevertCostCodeRenames(")
  })

  it("is hand-run from the installed writer and compiled into it", () => {
    expect(writer).toContain('"--rename-cost-codes"')
    expect(writer).toContain("return RunCostCodeRename(args);")
    expect(writer).toContain('"--rename-cost-codes-selftest"')
    expect(writer).not.toContain("RunCostCodeRenameAfterWriterRun")
    expect(script("install_sage_client_project_writer.ps1")).toContain("$costCodeRenameSource")
    expect(script("repair_sage_client_project_writer.ps1")).toContain("$costCodeRenameSource")
  })
})
