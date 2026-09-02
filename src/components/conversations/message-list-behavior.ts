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
