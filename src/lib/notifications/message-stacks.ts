/** Kinds of unread items shown as colored tiles on the map's Messages layer. */
export const MESSAGE_KINDS = ["message", "mail", "rfi", "schedule", "other"] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MESSAGE_KIND_LABEL: Readonly<Record<MessageKind, string>> = {
  message: "Messages",
  mail: "Project mail",
  rfi: "RFIs",
  schedule: "Schedule",
  other: "Other",
}

/** Unread item kinds per project id. */
export type MessageStackEntry = MessageKind | {
  readonly kind: MessageKind
  readonly notificationId: string
}
export type MessageStacks = ReadonlyMap<string, readonly MessageStackEntry[]>

type StackItem = {
  readonly sourceType: string
  readonly eventType: string
  readonly projectId: string | null
  readonly readAt: string | null
}

export function messageKind(item: Pick<StackItem, "sourceType" | "eventType">): MessageKind {
  if (item.sourceType === "project_correspondence") return "mail"
  if (item.sourceType === "message" || item.eventType.startsWith("message.") || item.eventType.startsWith("announcement.")) {
    return "message"
  }
  if (item.eventType.startsWith("rfi.") || item.sourceType === "rfi") return "rfi"
  if (item.eventType.startsWith("schedule.")) return "schedule"
  return "other"
}

/** Groups the viewer's unread bell items by project; items without a project are left out. */
export function messageStacksFrom<T extends StackItem>(items: readonly T[]): MessageStacks {
  const stacks = new Map<string, MessageStackEntry[]>()
  for (const item of items) {
    if (item.readAt !== null || item.projectId === null) continue
    const kinds = stacks.get(item.projectId) ?? []
    const kind = messageKind(item)
    kinds.push("id" in item && typeof item.id === "string" ? { kind, notificationId: item.id } : kind)
    stacks.set(item.projectId, kinds)
  }
  return stacks
}

/** Dashboard link that opens the map with the Messages layer on and the job selected. */
export function portfolioMessagesHref(projectId: string): string {
  return `/dashboard?layer=messages&job=${encodeURIComponent(projectId)}#portfolio-title`
}
