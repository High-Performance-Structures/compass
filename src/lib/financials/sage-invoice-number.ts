import { SAGE_INVOICE_NUMBER_MAX_LENGTH } from "@/lib/feature-settings/contract-settings"

/*
 * Invoice numbers Compass suggests for Sage, from the company's formats in
 * Settings > Workflows > Sage export. Pure and client-safe, so the settings
 * form can show an example.
 */

export type SageInvoiceNumber = {
  readonly value: string
  /** Why Sage would refuse the number; null when it's fine. */
  readonly error: string | null
}

/**
 * Fill an invoice number format: {project} the project number, {job} the Sage
 * job number, {n} the document's number and {n:2} that number padded to two
 * digits. Sage accepts up to 20 characters.
 */
export function formatSageInvoiceNumber(
  format: string,
  input: { readonly projectNumber: string | null; readonly sageJobNumber: string | null; readonly number: string }
): SageInvoiceNumber {
  const missing: string[] = []
  const value = format.trim().replaceAll(/\{(project|job|n)(?::(\d))?\}/g, (_token, name: string, width: string | undefined) => {
    if (name === "project") {
      if (!input.projectNumber) missing.push("project number")
      return input.projectNumber ?? ""
    }
    if (name === "job") {
      if (!input.sageJobNumber) missing.push("Sage job number")
      return input.sageJobNumber ?? ""
    }
    return width ? input.number.padStart(Number(width), "0") : input.number
  })
  if (missing.length > 0) return { value, error: `The project has no ${missing.join(" or ")} for the invoice number.` }
  if (value.length > SAGE_INVOICE_NUMBER_MAX_LENGTH) {
    return { value, error: `Sage allows ${SAGE_INVOICE_NUMBER_MAX_LENGTH} characters; this invoice number has ${value.length}.` }
  }
  return { value, error: null }
}
