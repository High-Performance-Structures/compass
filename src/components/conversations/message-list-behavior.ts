export type ScrollMetrics = {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

type ScrollHeightChange = {
  readonly scrollTop: number
  readonly previousScrollHeight: number
  readonly nextScrollHeight: number
}

type MessageIdentity = {
  readonly id: string
}

type OlderMessagePageInput<Message extends MessageIdentity> = {
  readonly currentMessages: readonly Message[]
  readonly olderMessages: readonly Message[]
  readonly pageSize: number
  readonly maxMessages: number
}

type MessageWindow<Message extends MessageIdentity> = {
  readonly messages: readonly Message[]
  readonly hasMore: boolean
}

export function getMessageAlignmentClass(
  currentUserId: string | null,
  messageUserId: string | null,
): "justify-end" | "justify-start" {
  return currentUserId !== null && messageUserId === currentUserId
    ? "justify-end"
    : "justify-start"
}

export function getNewestScrollTop(
  metrics: Pick<ScrollMetrics, "clientHeight" | "scrollHeight">,
): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight)
}

export function getPreservedScrollTop({
  scrollTop,
  previousScrollHeight,
  nextScrollHeight,
}: ScrollHeightChange): number {
  return scrollTop + Math.max(0, nextScrollHeight - previousScrollHeight)
}

export function isAtNewestEdge(
  { scrollTop, clientHeight, scrollHeight }: ScrollMetrics,
  threshold = 24,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold
}

export function isHistoryRequestCurrent(
  requestId: number,
  currentRequestId: number,
): boolean {
  return requestId === currentRequestId
}

export function isHistoryScrollRestoreCurrent(
  requestId: number,
  currentRequestId: number,
  requestScrollIntentId: number,
  currentScrollIntentId: number,
): boolean {
  return (
    isHistoryRequestCurrent(requestId, currentRequestId) &&
    requestScrollIntentId === currentScrollIntentId
  )
}

export function getHistoryLoadError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unable to load older messages."
}

export function mergeOlderMessagePage<Message extends MessageIdentity>({
  currentMessages,
  olderMessages,
  pageSize,
  maxMessages,
}: OlderMessagePageInput<Message>): MessageWindow<Message> {
  const knownIds = new Set(currentMessages.map((message) => message.id))
  const uniqueOlder: Message[] = []

  for (const message of olderMessages) {
    if (!knownIds.has(message.id)) {
      knownIds.add(message.id)
      uniqueOlder.push(message)
    }
  }

  const combined = [...uniqueOlder, ...currentMessages]
  const trimmedCount = Math.max(0, combined.length - maxMessages)
  const retainedOlderCount = Math.max(0, uniqueOlder.length - trimmedCount)
  const messages = combined.slice(-maxMessages)

  return {
    messages,
    hasMore:
      olderMessages.length >= pageSize &&
      messages.length < maxMessages &&
      retainedOlderCount > 0,
  }
}
