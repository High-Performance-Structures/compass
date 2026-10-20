export type EsignDocumentKind = "contract" | "estimate" | "change_order"

export type EsignOutcome = "signed" | "declined" | "cancelled"

function kindLabel(kind: EsignDocumentKind): string {
  if (kind === "contract") return "Contract"
  if (kind === "change_order") return "Change order"
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
      : input.kind === "change_order" && input.changeOrderId
        ? `${project}/change-orders/${encodeURIComponent(input.changeOrderId)}`
        : `${project}/estimate?estimateId=${encodeURIComponent(input.recordId)}`
  const label = kindLabel(input.kind)
  const name = input.title.trim() && input.title.trim() !== input.number ? `${input.number} ${input.title.trim()}` : input.number
  const summary =
    input.outcome === "signed"
      ? `${label} ${name} was signed by the client.`
      : input.outcome === "declined"
        ? `The client declined to sign ${label.toLowerCase()} ${name}.`
        : `The e-signature request for ${label.toLowerCase()} ${name} was cancelled.`
  return {
    eventType: `esign.${input.outcome}`,
    action: `${input.kind}_${input.outcome === "signed" ? "signed" : `signature_${input.outcome}`}`,
    title: `${label} ${input.outcome === "signed" ? "signed" : input.outcome}: ${input.number}`,
    summary,
    href,
  }
}
