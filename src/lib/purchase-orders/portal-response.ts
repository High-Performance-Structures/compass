export type PortalPurchaseOrderAcknowledgement = {
  readonly responderUserId: string
  readonly responderName: string
  readonly responderCompany: string | null
  readonly note: string | null
  readonly submittedAt: string
}

export type PortalPurchaseOrderPayload = {
  readonly recipientEmails: readonly string[]
  readonly acknowledgement: PortalPurchaseOrderAcknowledgement | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function textValue(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key]
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase()
}

function parseRecipientEmails(
  payload: Record<string, unknown>
): readonly string[] {
  const multiple = payload.recipientEmails
  if (Array.isArray(multiple)) {
    return Array.from(
      new Set(
        multiple
          .filter((value): value is string => typeof value === "string")
          .map(normalizedEmail)
          .filter((value) => value.length > 0)
      )
    )
  }
  const single = textValue(payload, "recipientEmail")
  return single ? [normalizedEmail(single)] : []
}

function parseAcknowledgement(
  payload: Record<string, unknown>
): PortalPurchaseOrderAcknowledgement | null {
  const raw = payload.vendorAcknowledgement
  if (!isRecord(raw)) return null
  const responderUserId = textValue(raw, "responderUserId")
  const responderName = textValue(raw, "responderName")
  const submittedAt = textValue(raw, "submittedAt")
  if (!responderUserId || !responderName || !submittedAt) return null
  return {
    responderUserId,
    responderName,
    responderCompany: textValue(raw, "responderCompany"),
    note: textValue(raw, "note"),
    submittedAt,
  }
}

export function parsePortalPurchaseOrderPayload(
  value: string | null
): PortalPurchaseOrderPayload {
  const payload = parseRecord(value)
  return {
    recipientEmails: parseRecipientEmails(payload),
    acknowledgement: parseAcknowledgement(payload),
  }
}

function normalizedName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function portalPurchaseOrderMatchesRecipient(input: {
  readonly recipientEmails: readonly string[]
  readonly companyName: string | null
  readonly assigneeName: string | null
  readonly vendorName: string | null
  readonly viewerEmail: string
  readonly viewerCompanyName: string | null
  readonly viewerDisplayName: string
}): boolean {
  if (input.recipientEmails.length > 0) {
    return input.recipientEmails.includes(normalizedEmail(input.viewerEmail))
  }

  const viewerNames = new Set(
    [input.viewerCompanyName, input.viewerDisplayName]
      .map(normalizedName)
      .filter((value) => value.length > 0)
  )
  return [input.companyName, input.assigneeName, input.vendorName]
    .map(normalizedName)
    .some((value) => value.length > 0 && viewerNames.has(value))
}

export function isPortalVisiblePurchaseOrderStatus(status: string): boolean {
  return [
    "sent",
    "ordered",
    "partially_received",
    "received",
    "complete",
    "completed",
    "closed",
  ].includes(status.trim().toLowerCase())
}

export function portalPurchaseOrderCanReceiveResponse(status: string): boolean {
  return ["sent", "ordered", "partially_received"].includes(
    status.trim().toLowerCase()
  )
}

export function withPortalPurchaseOrderRecipients(
  value: string | null,
  recipientEmails: readonly string[]
): string {
  return JSON.stringify({
    ...parseRecord(value),
    recipientEmails: Array.from(
      new Set(
        recipientEmails
          .map(normalizedEmail)
          .filter((email) => email.length > 0)
      )
    ),
  })
}

export function withPortalPurchaseOrderAcknowledgement(
  value: string | null,
  acknowledgement: PortalPurchaseOrderAcknowledgement
): string {
  return JSON.stringify({
    ...parseRecord(value),
    vendorAcknowledgement: acknowledgement,
  })
}
