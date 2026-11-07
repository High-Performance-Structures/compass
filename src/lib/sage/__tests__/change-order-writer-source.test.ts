import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function script(name: string): string {
  return readFileSync(new URL(`../../../../scripts/${name}`, import.meta.url), "utf8")
}

const source = script("Sage.100.Contractor.CompassChangeOrderWriter.cs")
const writer = script("Sage.100.Contractor.CompassClientProjectWriter.cs")

describe("Sage change order writer source boundary", () => {
  it("only adds prime change orders and never modifies or deletes one", () => {
    expect(source).toContain('"add_prime_change_order"')
    expect(source).toContain("<ChangeOrderAddRq requestID=")
    expect(source).not.toMatch(/ChangeOrderModRq|ChangeOrderDelRq|DeleteRq|VoidRq|INSERT |UPDATE |DELETE /)
  })

  it("is off unless its own switch is on, with a dry run that writes nothing", () => {
    expect(source).toContain('ChangeOrderSwitch("SAGE_CHANGE_ORDER_WRITES_ENABLED")')
    expect(source).toContain('ChangeOrderSwitch("SAGE_CHANGE_ORDER_DRY_RUN")')
    const process = source.slice(source.indexOf("private static ChangeOrderOutcome ProcessChangeOrder"))
    expect(process.indexOf("if (dryRun)")).toBeLessThan(process.indexOf("submit Sage change order add"))
  })

  it("checks Sage for the same change order before adding, and refuses a same-number one with another amount", () => {
    const process = source.slice(source.indexOf("private static ChangeOrderOutcome ProcessChangeOrder"))
    expect(process.indexOf("PrimeChangeOrdersForJob(jobNumber)")).toBeLessThan(process.indexOf("submit Sage change order add"))
    expect(process).toContain("AlreadyInSage = true")
    expect(process).toContain("on this job with approved amount")
    expect(process).toContain("The Sage job ID and number do not identify the same job")
  })

  it("validates the XML and reads the change order back only after Sage commits", () => {
    expect(source).toContain("ValidateXml(xml)")
    const run = source.slice(source.indexOf("private static void RunChangeOrders()"), source.indexOf("private static decimal ParseAmount"))
    expect(run.indexOf("using (new ApiSession(")).toBeLessThan(run.indexOf("FindPrimeChangeOrderByNumber("))
  })

  it("runs from the installed writer after its other work", () => {
    expect(writer).toContain("RunChangeOrdersAfterWriterRun();")
    expect(writer).toContain('"--change-order-diagnose"')
    expect(script("install_sage_client_project_writer.ps1")).toContain("$changeOrderSource")
    expect(script("repair_sage_client_project_writer.ps1")).toContain("$changeOrderSource")
  })
})
