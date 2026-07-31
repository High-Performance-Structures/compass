import type { FeedbackDeskKind } from "@/lib/jarvis/feedback-desk"

type ConversationMessage = Readonly<{
  role: "user" | "assistant"
  content: string
}>

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : null
}

function conversationFromPayload(payload: string): readonly ConversationMessage[] {
  try {
    const parsed: unknown = JSON.parse(payload)
    const messages = objectValue(parsed)?.messages
    if (!Array.isArray(messages)) return []
    const conversation: ConversationMessage[] = []
    for (const value of messages) {
      const message = objectValue(value)
      const role = message?.role
      const content = message?.content
      if (
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim().length > 0
      ) {
        conversation.push({ role, content: content.trim() })
      }
    }
    return conversation
  } catch {
    return []
  }
}

export function explicitlyRequestsCompassFeedback(message: string): boolean {
  const value = message.toLowerCase()
  return [
    /\b(?:bug|issue|problem|broken)\b/,
    /\b(?:fails?|failed|error)\s+(?:to|when|while|message)\b/,
    /\b(?:unable to|can['’]?t|cannot)\s+(?:upload|create|open|save|send|edit|delete|view|see|use|submit)\b/,
    /\b(?:not working|doesn['’]?t work|isn['’]?t working)\b/,
    /\b(?:incorrect|incomplete|missing|empty)\b/,
    /\b(?:feature request|enhancement|feedback|suggestion|suggest)\b/,
    /(?:^|[.!?]\s+)(?:please\s+|also\s+)?(?:add|fix|improve|remove|rename)\b/,
    /\b(?:i|we)\s+(?:want|need|would like)\b/,
    /\bshould\s+(?:be|have|show|allow|include|use|work)\b/,
    /\b(?:can|could|would)\s+you\s+(?:add|change|fix|improve|remove|rename|update)\b/,
  ].some((pattern) => pattern.test(value))
}

export function askedToFileFeedback(message: string): boolean {
  const value = message.toLowerCase().replace(/\s+/g, " ")
  const asksToFile =
    /\b(?:would|do) you (?:like|want) me to (?:file|submit|report|record)\b/.test(value) ||
    /\bshould i (?:file|submit|report|record)\b/.test(value) ||
    /\b(?:file|submit|report|record) (?:this|it|that|both|these|the request|the requests)\b/.test(value)
  return asksToFile &&
    ["feedback", "request", "issue", "bug", "file"].some((word) =>
      value.includes(word),
    )
}

function confirmsFiling(message: string): boolean {
  const value = message.trim().toLowerCase()
  const shortConfirmation = /^(?:(?:yes|yep|yeah)(?:,\s*please)?(?:,?\s+(?:file|submit|report)\s+it)?|please\s+do|go\s+ahead|file\s+it|submit\s+it|report\s+it|do\s+it)[.!]?$/.test(value)
  const explicitConfirmation =
    /^(?:yes|yep|yeah|please\s+do|go\s+ahead|file|submit|report|do\s+it)\b/.test(value) &&
    (/\b(?:file|submit|report|record)\b/.test(value) || value.includes("feedback desk"))
  return shortConfirmation || explicitConfirmation
}

export function confirmedFeedbackReportFromPayload(payload: string): string | null {
  const conversation = conversationFromPayload(payload)
  if (conversation.length < 3) return null
  const latest = conversation.at(-1)
  const previous = conversation.at(-2)
  const report = conversation.at(-3)
  if (
    latest?.role !== "user" ||
    previous?.role !== "assistant" ||
    report?.role !== "user" ||
    !confirmsFiling(latest.content) ||
    !askedToFileFeedback(previous.content) ||
    !explicitlyRequestsCompassFeedback(report.content)
  ) {
    return null
  }
  return report.content
}

export function feedbackCandidateFromReport(report: string): Readonly<{
  kind: FeedbackDeskKind
  title: string
  description: string
}> {
  const normalized = report.replace(/\s+/g, " ").trim()
  const lowered = normalized.toLowerCase()
  let kind: FeedbackDeskKind = "general"
  if (/\b(?:bug|issue|problem|broken|error|fails?|failed|unable to|not working|doesn['’]?t work|isn['’]?t working|incorrect|incomplete|missing|empty)\b/.test(lowered)) {
    kind = "bug"
  } else if (/\b(?:feature request|enhancement|would like|please add|should (?:be|have|show|allow|include|use))\b/.test(lowered)) {
    kind = "feature"
  } else if (normalized.endsWith("?")) {
    kind = "question"
  }
  return {
    kind,
    title:
      normalized.length > 160
        ? `${normalized.slice(0, 157).trimEnd()}...`
        : normalized,
    description: report.trim(),
  }
}
