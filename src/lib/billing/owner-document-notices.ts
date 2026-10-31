
export type OwnerDocumentKind =
  | "pay-application"
  | "deposit-request"

export function isOwnerDocumentKind(value: unknown): value is OwnerDocumentKind {
  return value === "pay-application" || value === "deposit-request"
}

export type OwnerDocumentFacts = {
  readonly kind: OwnerDocumentKind
  readonly projectName: string
  readonly projectNumber: string | null
  /** "1" for pay application #1, "H-430-1900-DEP-1" for a deposit request. */
  readonly documentNumber: string
  readonly amountCents: number
  /** YYYY-MM-DD */
  readonly dueDate: string | null
  readonly portalUrl: string
  readonly senderName: string
}

export type ProjectEmailPrefill = {
  readonly to: readonly string[]
  readonly subject: string
  readonly body: string
  readonly attachment: { readonly url: string; readonly fileName: string } | null
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** A calendar date as written, without shifting it through a time zone. */
export function ownerNoticeDate(value: string | null): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return null
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : null
}

function projectLabel(facts: OwnerDocumentFacts): string {
  return facts.projectNumber ? `${facts.projectName} (${facts.projectNumber})` : facts.projectName
}

function documentTitle(facts: OwnerDocumentFacts): string {
  return facts.kind === "pay-application" ? `Pay Application #${facts.documentNumber}` : `Deposit Request ${facts.documentNumber}`
}

function requestSentence(facts: OwnerDocumentFacts): string {
  if (facts.kind === "pay-application") {
    return `${documentTitle(facts)} for ${facts.projectName} is ready for your review. The amount due this period is ${money(facts.amountCents)}.`
  }
  const due = ownerNoticeDate(facts.dueDate)
  return `We're requesting a deposit of ${money(facts.amountCents)} for ${facts.projectName}${due ? `, due ${due}` : ""}.`
}

export function ownerDocumentEmail(facts: OwnerDocumentFacts): { readonly subject: string; readonly body: string } {
  const attached = facts.kind === "pay-application" ? "The G702/G703 is attached." : "The deposit request is attached."
  return {
    subject: `${documentTitle(facts)} - ${projectLabel(facts)}`.slice(0, 200),
    body: [
      "Hello,",
      "",
      requestSentence(facts),
      "",
      `${attached} You can also view and print it in your Compass portal:`,
      facts.portalUrl,
      "",
      "Please let us know if you have any questions.",
      "",
      "Thank you,",
      facts.senderName,
    ].join("\n"),
  }
}

export function ownerDocumentNotification(facts: OwnerDocumentFacts): { readonly title: string; readonly body: string } {
  return {
    title: `${documentTitle(facts)} - ${projectLabel(facts)}`.slice(0, 200),
    body: `${requestSentence(facts)} Open it in your Compass portal to view or print it.`,
  }
}
