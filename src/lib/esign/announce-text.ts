export type EsignDocumentKind = "contract" | "estimate" | "change_order" | "trade_letter"

export type EsignOutcome = "signed" | "declined" | "cancelled"

function kindLabel(kind: EsignDocumentKind): string {
  if (kind === "contract") return "Contract"
  if (kind === "change_order") return "Change order"
  if (kind === "trade_letter") return "Letter"
  return "Estimate"
}

export function esignAnnouncementText(input: {
  readonly kind: EsignDocumentKind
  readonly outcome: EsignOutcome
  readonly projectId: string
  readonly recordId: string
  readonly number: string
  readonly title: string
  readonly changeOrderId: string | null
  /** For a trade letter: the estimate it belongs to. */
  readonly estimateId?: string | null
}): {
  readonly eventType: string
  readonly action: string
  readonly title: string
  readonly summary: string
  readonly href: string
} {
  const project = `/dashboard/projects/${encodeURIComponent(input.projectId)}`
  const href =
    input.kind === "contract"
      ? `${project}/contracts`
      : input.kind === "trade_letter"
        ? `${project}/estimate${input.estimateId ? `?estimateId=${encodeURIComponent(input.estimateId)}` : ""}`
      : input.kind === "change_order" && input.changeOrderId
        ? `${project}/change-orders/${encodeURIComponent(input.changeOrderId)}`
        : `${project}/estimate?estimateId=${encodeURIComponent(input.recordId)}`
  const label = kindLabel(input.kind)
  const name = input.title.trim() && input.title.trim() !== input.number ? `${input.number} ${input.title.trim()}` : input.number
  const summary =
    input.outcome === "signed"
      ? input.kind === "trade_letter"
        ? `${label} ${name} was signed by the trade and the company.`
        : `${label} ${name} was signed by the client.`
      : input.outcome === "declined"
        ? `${input.kind === "trade_letter" ? "The trade" : "The client"} declined to sign ${label.toLowerCase()} ${name}.`
        : `The e-signature request for ${label.toLowerCase()} ${name} was cancelled.`
  return {
    eventType: `esign.${input.outcome}`,
    action: `${input.kind}_${input.outcome === "signed" ? "signed" : `signature_${input.outcome}`}`,
    title: `${label} ${input.outcome === "signed" ? "signed" : input.outcome}: ${input.number}`,
    summary,
    href,
  }
}
