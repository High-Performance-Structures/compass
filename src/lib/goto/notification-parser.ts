type GotoAttachment = {
  readonly attachmentId: string
  readonly name: string
  readonly contentType: string
  readonly size: number | null
}

export type GotoInboundMessage = {
  readonly eventId: string
  readonly accountKey: string
  readonly messageId: string
  readonly conversationId: string | null
  readonly ownerTouchpoint: string
  readonly senderPhone: string
  readonly body: string
  readonly receivedAt: string
  readonly attachments: readonly GotoAttachment[]
}

export type GotoParseResult =
  | { readonly kind: "validation" }
  | { readonly kind: "ignored" }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "inbound"; readonly message: GotoInboundMessage }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function attachmentItems(value: unknown): readonly GotoAttachment[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.flatMap((item): readonly GotoAttachment[] => {
    if (!isRecord(item)) return []
    const attachmentId = stringValue(item.attachmentId)
    if (!attachmentId) return []
    const size = typeof item.size === "number" && item.size >= 0 ? item.size : null
    return [{
      attachmentId,
      name: stringValue(item.name) ?? `text-attachment-${attachmentId}`,
      contentType: stringValue(item.contentType) ?? "application/octet-stream",
      size,
    }]
  })
}

export function parseGotoInboundNotification(value: unknown): GotoParseResult {
  if (value === null || value === undefined) return { kind: "validation" }
  if (!isRecord(value)) return { kind: "invalid", error: "Invalid webhook body" }
  const type = stringValue(value.type)
  if (type !== "INBOUND_MESSAGE") return { kind: "ignored" }
  const content = value.content
  if (!isRecord(content) || !isRecord(content.payload)) {
    return { kind: "invalid", error: "Missing GoTo notification payload" }
  }
  const payload = content.payload
  if (stringValue(payload.channel)?.toUpperCase() !== "SMS") {
    return { kind: "ignored" }
  }
  const eventId = stringValue(value.id)
  const accountKey = stringValue(content.accountKey)
  const messageId = stringValue(payload.messageId)
  const ownerTouchpoint = stringValue(payload.ownerTouchpoint)
  const senderPhone = stringValue(payload.authorTouchpoint)
  if (!eventId || !accountKey || !messageId || !ownerTouchpoint || !senderPhone) {
    return { kind: "invalid", error: "GoTo SMS notification is incomplete" }
  }
  return {
    kind: "inbound",
    message: {
      eventId,
      accountKey,
      messageId,
      conversationId: stringValue(payload.conversationId),
      ownerTouchpoint,
      senderPhone,
      body: stringValue(payload.body) ?? "",
      receivedAt:
        stringValue(payload.timestamp) ??
        stringValue(value.timestamp) ??
        new Date().toISOString(),
      attachments: attachmentItems(payload.attachments),
    },
  }
}
