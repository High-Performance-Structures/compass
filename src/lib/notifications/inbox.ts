/** Fields the bell needs to group items; matches NotificationCenterItem. */
export type InboxItem = {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly href: string
  readonly eventType: string
  readonly sourceType: string
  readonly projectId: string | null
  readonly projectLabel: string | null
  readonly readAt: string | null
  readonly createdAt: string
}

/** One line in the bell: a single item, or a conversation's items stacked. */
export type InboxRow<T extends InboxItem> = {
  readonly key: string
  /** Newest first. */
  readonly items: readonly T[]
  readonly latest: T
  readonly unreadCount: number
}

export type InboxSection<T extends InboxItem> = {
  readonly key: string
  readonly label: string
  readonly rows: readonly InboxRow<T>[]
  readonly unreadCount: number
}

const CONVERSATION_SOURCES = new Set(["message", "project_correspondence"])

/**
 * Messages in the same conversation share a link (the message id in project
 * messages is only a scroll target), so they collapse into one row.
 */
export function conversationKey(item: InboxItem): string | null {
  if (!CONVERSATION_SOURCES.has(item.sourceType)) return null
  const [path, query = ""] = item.href.split("?", 2)
  const params = new URLSearchParams(query)
  params.delete("messageId")
  const rest = params.toString()
  return rest ? `${path}?${rest}` : (path ?? item.href)
}

/**
 * Groups the bell into project sections (projects with unread items first,
 * then by newest activity; items without a project go under "General"), and
 * within each section stacks a conversation's messages into one row.
 * Input is newest first, as the bell loads it.
 */
export function groupInbox<T extends InboxItem>(items: readonly T[]): readonly InboxSection<T>[] {
  const sections = new Map<string, { label: string; rows: Map<string, T[]> }>()
  for (const item of items) {
    const sectionKey = item.projectId ?? "general"
    const section = sections.get(sectionKey) ?? {
      label: item.projectId ? (item.projectLabel ?? "Project") : "General",
      rows: new Map<string, T[]>(),
    }
    sections.set(sectionKey, section)
    const rowKey = conversationKey(item) ?? `item:${item.id}`
    const row = section.rows.get(rowKey) ?? []
    row.push(item)
    section.rows.set(rowKey, row)
  }
  const result = [...sections.entries()].map(([key, section]) => {
    const rows = [...section.rows.entries()].flatMap(([rowKey, rowItems]): InboxRow<T>[] => {
      const latest = rowItems[0]
      if (!latest) return []
      return [{
        key: rowKey,
        items: rowItems,
        latest,
        unreadCount: rowItems.filter((entry) => entry.readAt === null).length,
      }]
    })
    return {
      key,
      label: section.label,
      rows,
      unreadCount: rows.reduce((sum, row) => sum + row.unreadCount, 0),
    }
  })
  const newest = (section: InboxSection<T>): string => section.rows[0]?.latest.createdAt ?? ""
  return result.toSorted((left, right) => {
    if ((left.unreadCount > 0) !== (right.unreadCount > 0)) return left.unreadCount > 0 ? -1 : 1
    return newest(right).localeCompare(newest(left))
  })
}
