import { feedbackStatusLabel } from "@/lib/jarvis/feedback-lifecycle"

type FeedbackTimelineItem = Readonly<{
  status: string
  title: string
  createdAt: string
}>

type FeedbackTimelineEvent = Readonly<{
  eventType: string
  payload: string
  result: string | null
  createdAt: string
  completedAt: string | null
}>

export type FeedbackTimelineEntry = Readonly<{
  id: string
  status: string
  label: string
  message: string
  occurredAt: string
}>

function recordFromJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : null
  } catch {
    return null
  }
}

function recordString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function timelineLabel(status: string, notificationKind: string | null): string {
  if (notificationKind === "delivery_graph_created") {
    return "Engineering work set up"
  }
  if (notificationKind === "delivery_graph_failed") {
    return "Engineering work retrying"
  }
  return feedbackStatusLabel(status)
}

export function feedbackTimeline(
  item: FeedbackTimelineItem,
  events: readonly FeedbackTimelineEvent[],
): readonly FeedbackTimelineEntry[] {
  const entries: FeedbackTimelineEntry[] = [
    {
      id: `submitted:${item.createdAt}`,
      status: "new",
      label: "Submitted",
      message: `“${item.title}” was received by the Compass Feedback Desk.`,
      occurredAt: item.createdAt,
    },
  ]

  for (const event of events) {
    if (event.eventType !== "feedback.status_updated") continue
    const data = recordFromJson(event.result) ?? recordFromJson(event.payload)
    const status = recordString(data, "status")
    if (!status) continue
    const notificationKind = recordString(data, "notificationKind")
    const message =
      recordString(data, "message") ??
      `Request status changed to ${feedbackStatusLabel(status)}.`
    const occurredAt =
      recordString(data, "updatedAt") ??
      event.completedAt ??
      event.createdAt

    entries.push({
      id: `${event.eventType}:${occurredAt}:${status}`,
      status,
      label: timelineLabel(status, notificationKind),
      message,
      occurredAt,
    })
  }

  return entries
}
