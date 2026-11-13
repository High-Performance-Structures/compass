/**
 * Which writer failures mean "nothing was written to Sage" (issue #1329).
 * Pure: no database access.
 *
 * The installed Sage writer (scripts/Sage.100.Contractor.Compass*Writer.cs,
 * approved by Sage, so it can't change) reports every failure as text. Most
 * stop before anything is sent to Sage and say so ("no write was attempted",
 * a dry run, a check stage); others (a failed submit, a write that doesn't
 * read back) may have left the record in Sage. These closed lists name the
 * first kind exactly as the writer words them; anything else counts as
 * possibly in Sage. writer-outcomes.test.ts fails when the writer's wording
 * changes.
 */

type NoWriteMessage =
  | { readonly kind: "contains"; readonly text: string }
  | { readonly kind: "prefix"; readonly text: string }

/** Wording the writer adds to every check that stops before a write (any writer). */
const NO_WRITE_ANY: readonly NoWriteMessage[] = [
  { kind: "contains", text: "no write was attempted" },
]

/** The AR invoice writer (CompassArInvoiceWriter.cs ProcessArInvoice): checks before "submit Sage AR invoice add". */
export const AR_INVOICE_NO_WRITE_MESSAGES: readonly NoWriteMessage[] = [
  ...NO_WRITE_ANY,
  { kind: "prefix", text: "DRY RUN (nothing written)" },
  { kind: "prefix", text: "Compass requested an unsupported Sage AR invoice operation." },
  // Stages before the submit, as RunStage words their failure ("<stage> failed: ...").
  { kind: "prefix", text: "check Sage job failed:" },
  { kind: "prefix", text: "check Sage cost codes, accounts and tax district failed:" },
  { kind: "prefix", text: "read Sage AR invoices failed:" },
]

/** The client/job writer's company adds (CompassClientProjectWriter.cs Process / ProcessEnsureVendor): checks before a submit. */
export const COMPANY_ADD_NO_WRITE_MESSAGES: readonly NoWriteMessage[] = [
  ...NO_WRITE_ANY,
  { kind: "prefix", text: "Compass payload targets the wrong Sage company." },
  { kind: "prefix", text: "Compass payload is incomplete." },
  { kind: "prefix", text: "Compass requested an unsupported Sage operation." },
  { kind: "prefix", text: "Client status mismatch:" },
  { kind: "prefix", text: "Matched Sage client has status" },
  { kind: "prefix", text: "check Sage for a vendor with this name failed:" },
]

/** True when the writer's failure message is one that wrote nothing (case-insensitive, as SQLite's LIKE). */
export function writerWroteNothing(messages: readonly NoWriteMessage[], message: string | null): boolean {
  if (message === null) return false
  const text = message.toLowerCase()
  return messages.some((rule) => rule.kind === "contains"
    ? text.includes(rule.text.toLowerCase())
    : text.startsWith(rule.text.toLowerCase()))
}

/** The same test as SQL on an `error_message` column (LIKE is case-insensitive for ASCII; the texts have no wildcards). */
export function writerWroteNothingSql(messages: readonly NoWriteMessage[], column = "error_message"): string {
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`
  const clauses = messages.map((rule) => rule.kind === "contains"
    ? `${column} LIKE ${quote(`%${rule.text}%`)}`
    : `${column} LIKE ${quote(`${rule.text}%`)}`)
  return `(${clauses.join(" OR ")})`
}
