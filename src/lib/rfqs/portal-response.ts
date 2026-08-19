export type PortalRfqScopeItem = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly notes: string | null
}

export type PortalRfqDocumentLink = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type PortalRfqVendorResponse = {
  readonly decision: "quote" | "decline"
  readonly amount: number | null
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
  readonly responderUserId: string
  readonly responderName: string
  readonly responderCompany: string | null
  readonly submittedAt: string
}

export type PortalRfqPayload = {
  readonly vendorCategory: string | null
  readonly recipientEmail: string | null
  readonly scopeItems: readonly PortalRfqScopeItem[]
  readonly documentLinks: readonly PortalRfqDocumentLink[]
  readonly vendorResponse: PortalRfqVendorResponse | null
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

function textValue(
  value: Record<string, unknown>,
  key: string
): string | null {
  const candidate = value[key]
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null
}

function numberValue(
  value: Record<string, unknown>,
  key: string
): number | null {
  const candidate = value[key]
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null
}

function parseScopeItems(
  value: Record<string, unknown>
): readonly PortalRfqScopeItem[] {
  const items = value.scopeItems
  if (!Array.isArray(items)) return []

  return items.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const description = textValue(item, "description")
    if (!description) return []
    return [
      {
        lineNumber: numberValue(item, "lineNumber") ?? index + 1,
        description,
        phaseCode: textValue(item, "phaseCode"),
        costCode: textValue(item, "costCode"),
        notes: textValue(item, "notes"),
      },
    ]
  })
}

function parseDocumentLinks(
  value: Record<string, unknown>
): readonly PortalRfqDocumentLink[] {
  const links = value.documentLinks
  if (!Array.isArray(links)) return []

  return links.flatMap((link, index) => {
    if (!isRecord(link)) return []
    const url = textValue(link, "url")
    if (!url) return []
    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return []
      }
    } catch {
      return []
    }
    return [
      {
        lineNumber: numberValue(link, "lineNumber") ?? index + 1,
        label: textValue(link, "label") ?? `Document ${index + 1}`,
        url,
        notes: textValue(link, "notes"),
      },
    ]
  })
}

function parseVendorResponse(
  value: Record<string, unknown>
): PortalRfqVendorResponse | null {
  const response = value.vendorResponse
  if (!isRecord(response)) return null
  const decision = textValue(response, "decision")
  const responderUserId = textValue(response, "responderUserId")
  const responderName = textValue(response, "responderName")
  const submittedAt = textValue(response, "submittedAt")
  if (
    (decision !== "quote" && decision !== "decline") ||
    !responderUserId ||
    !responderName ||
    !submittedAt
  ) {
    return null
  }

  return {
    decision,
    amount: numberValue(response, "amount"),
    leadTime: textValue(response, "leadTime"),
    validUntil: textValue(response, "validUntil"),
    notes: textValue(response, "notes"),
    responderUserId,
    responderName,
    responderCompany: textValue(response, "responderCompany"),
    submittedAt,
  }
}

export function parsePortalRfqPayload(value: string | null): PortalRfqPayload {
  const payload = parseRecord(value)
  return {
    vendorCategory: textValue(payload, "vendorCategory"),
    recipientEmail: textValue(payload, "recipientEmail"),
    scopeItems: parseScopeItems(payload),
    documentLinks: parseDocumentLinks(payload),
    vendorResponse: parseVendorResponse(payload),
  }
}

function normalizedName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function portalRfqMatchesRecipient(input: {
  readonly recipientEmail: string | null
  readonly companyName: string | null
  readonly assigneeName: string | null
  readonly viewerEmail: string
  readonly viewerCompanyName: string | null
  readonly viewerDisplayName: string
}): boolean {
  const recipientEmail = input.recipientEmail?.trim().toLowerCase() ?? ""
  if (recipientEmail.length > 0) {
    // An explicit RFQ email is authoritative. Do not fall back to a broad
    // company-name match when the request names a different mailbox.
    return recipientEmail === input.viewerEmail.trim().toLowerCase()
  }

  const viewerNames = new Set(
    [input.viewerCompanyName, input.viewerDisplayName]
      .map(normalizedName)
      .filter((value) => value.length > 0)
  )
  return [input.companyName, input.assigneeName]
    .map(normalizedName)
    .some((value) => value.length > 0 && viewerNames.has(value))
}

export function isPortalVisibleRfqStatus(status: string): boolean {
  return !["draft", "void", "cancelled", "canceled"].includes(
    status.trim().toLowerCase()
  )
}

export function portalRfqCanReceiveResponse(status: string): boolean {
  return ["sent", "response_received"].includes(status.trim().toLowerCase())
}

export function withPortalRfqVendorResponse(
  value: string | null,
  response: PortalRfqVendorResponse
): string {
  return JSON.stringify({
    ...parseRecord(value),
    vendorResponse: response,
  })
}
