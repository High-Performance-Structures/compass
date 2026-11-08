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

const estimate = script("Sage.100.Contractor.CompassEstimateWriter.cs")

describe("Sage estimate writer source boundary", () => {
  it("only adds a proposal and budget, never modifies or deletes one", () => {
    expect(estimate).toContain('EstimateOperation = "add_job_proposal_lines"')
    expect(estimate).toContain('EstimateRequestXml("ProposalAddRq"')
    expect(estimate).toContain('EstimateRequestXml("BudgetAddRq"')
    expect(estimate).not.toMatch(/ProposalModRq|ProposalDelRq|BudgetModRq|BudgetDelRq|INSERT |UPDATE |DELETE /)
  })

  it("sets the proposal up by cost code, not bid item", () => {
    const build = estimate.slice(estimate.indexOf("private static string BuildProposalAddXml"))
    expect(build.indexOf('AppendElement(body, "ProposalBasis", "1")')).toBeGreaterThan(-1)
    expect(build.indexOf('AppendElement(body, "ProposalBasis", "1")')).toBeLessThan(build.indexOf("<ProposalLineAdd>"))
  })

  it("puts the whole proposal amount in Other", () => {
    expect(estimate).toContain('AppendElement(body, "OtherAmount", line.otherAmount)')
    expect(estimate).not.toMatch(/ProposedMaterialAmount|SubcontractAmount/)
  })

  it("tags taxable proposal lines in UserDefined1 and Memo, after the amount as the schema orders them", () => {
    const proposal = estimate.slice(estimate.indexOf("private static string BuildProposalAddXml"), estimate.indexOf("private static string BuildBudgetAddXml"))
    expect(proposal.indexOf('"OtherAmount"')).toBeLessThan(proposal.indexOf('"UserDefined1"'))
    expect(proposal.indexOf('"UserDefined1"')).toBeLessThan(proposal.indexOf('"Memo"'))
    const budget = estimate.slice(estimate.indexOf("private static string BuildBudgetAddXml"))
    expect(budget).not.toContain("UserDefined1")
  })

  it("is off unless its own switch is on, and refuses a second proposal or budget before writing", () => {
    expect(estimate).toContain('EstimateSwitch("SAGE_ESTIMATE_WRITES_ENABLED")')
    expect(estimate).toContain('EstimateSwitch("SAGE_ESTIMATE_DRY_RUN")')
    const process = estimate.slice(estimate.indexOf("private static void ProcessEstimate"))
    expect(process.indexOf("Sage already has a proposal for job")).toBeLessThan(process.indexOf("submit Sage proposal add"))
    expect(process.indexOf("Sage already has a budget for job")).toBeLessThan(process.indexOf("submit Sage proposal add"))
    expect(process.indexOf("if (dryRun)")).toBeLessThan(process.indexOf("submit Sage proposal add"))
  })

  it("reports every claimed export even when the Sage session fails to open or close", () => {
    const run = estimate.slice(estimate.indexOf("private static void RunEstimates()"))
    expect(run).toContain("Exception sessionError = null;")
    expect(run.indexOf("catch (Exception error)\n            {\n                sessionError = error;")).toBeGreaterThan(-1)
    expect(run.indexOf("The Sage API session could not be opened; nothing was sent.")).toBeLessThan(run.indexOf("Send(\"POST\", EstimateResultsTarget"))
    expect(estimate).toContain('"Sage estimate run failed: " + error.ToString()')
  })

  it("runs change orders, estimates and AR invoices in their own process (one Sage API session per process)", () => {
    expect(writer).toContain("private static void RunStageInChildProcess(string flag, string label)")
    for (const [source, flag, direct] of [
      [script("Sage.100.Contractor.CompassChangeOrderWriter.cs"), "--change-order-run", "RunChangeOrders();"],
      [estimate, "--estimate-run", "RunEstimates();"],
      [script("Sage.100.Contractor.CompassArInvoiceWriter.cs"), "--ar-invoice-run", "RunArInvoices();"],
    ] as const) {
      const after = source.slice(source.indexOf("AfterWriterRun()"), source.indexOf("Only()"))
      expect(after).toContain(`RunStageInChildProcess("${flag}"`)
      expect(after).not.toContain(direct)
    }
  })

  it("runs from the installed writer after change orders", () => {
    expect(writer.indexOf("RunChangeOrdersAfterWriterRun();")).toBeLessThan(writer.indexOf("RunEstimatesAfterWriterRun();"))
    expect(writer).toContain('"--estimate-diagnose"')
    expect(script("install_sage_client_project_writer.ps1")).toContain("$estimateSource")
    expect(script("repair_sage_client_project_writer.ps1")).toContain("$estimateSource")
  })
})

const arInvoice = script("Sage.100.Contractor.CompassArInvoiceWriter.cs")

describe("Sage AR invoice writer source boundary", () => {
  it("only adds an AR invoice, never modifies, voids or deletes one", () => {
    expect(arInvoice).toContain('"add_ar_invoice"')
    expect(arInvoice).toContain("<ARInvoiceAddRq requestID=")
    expect(arInvoice).not.toMatch(/ARInvoiceModRq|ARInvoiceDelRq|ARInvoiceVoid|INSERT |UPDATE |DELETE /)
  })

  it("sends a credit as quantity -1 at a positive unit price", () => {
    expect(arInvoice).toContain('AppendElement(body, "Quantity", amount < 0 ? "-1" : "1")')
    expect(arInvoice).toContain('AppendElement(body, "UnitPrice", Positive(amount))')
  })

  it("is off unless its own switch is on, and checks Sage's invoice numbers before writing", () => {
    expect(arInvoice).toContain('ArInvoiceSwitch("SAGE_AR_INVOICE_WRITES_ENABLED")')
    expect(arInvoice).toContain('ArInvoiceSwitch("SAGE_AR_INVOICE_DRY_RUN")')
    const process = arInvoice.slice(arInvoice.indexOf("private static void ProcessArInvoice"))
    expect(process.indexOf("Sage already has invoice")).toBeLessThan(process.indexOf("submit Sage AR invoice add"))
    expect(process.indexOf("if (dryRun)")).toBeLessThan(process.indexOf("submit Sage AR invoice add"))
  })

  it("runs from the installed writer after estimates", () => {
    expect(writer.indexOf("RunEstimatesAfterWriterRun();")).toBeLessThan(writer.indexOf("RunArInvoicesAfterWriterRun();"))
    expect(writer).toContain('"--ar-invoice-diagnose"')
    expect(script("install_sage_client_project_writer.ps1")).toContain("$arInvoiceSource")
    expect(script("repair_sage_client_project_writer.ps1")).toContain("$arInvoiceSource")
  })
})
