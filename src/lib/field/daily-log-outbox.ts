import type {
  FieldOutboxItem,
  FieldQueuedAttachment,
} from "./types"

type DailyLogOutboxItem = Extract<FieldOutboxItem, { readonly kind: "daily_log" }>

type DailyLogOutboxDependencies = {
  readonly createDailyLog: (item: DailyLogOutboxItem) => Promise<string>
  readonly uploadAttachment: (
    item: DailyLogOutboxItem,
    remoteDailyLogId: string,
    attachment: FieldQueuedAttachment
  ) => Promise<void>
  readonly persist: (items: readonly FieldOutboxItem[]) => Promise<void>
}

function replaceItem(
  items: readonly FieldOutboxItem[],
  replacement: DailyLogOutboxItem
): readonly FieldOutboxItem[] {
  return items.map((item) => (item.id === replacement.id ? replacement : item))
}

/**
 * Drains native daily logs while checkpointing the remote ID and each uploaded
 * attachment. A retry therefore resumes instead of duplicating completed work.
 */
export async function drainDailyLogOutbox(
  items: readonly FieldOutboxItem[],
  dependencies: DailyLogOutboxDependencies
): Promise<number> {
  let remaining: readonly FieldOutboxItem[] = [...items]
  const dailyLogs = items.filter(
    (item): item is DailyLogOutboxItem => item.kind === "daily_log"
  )
  let syncedCount = 0

  for (const queuedItem of dailyLogs) {
    let item = queuedItem
    let remoteDailyLogId = item.remoteDailyLogId

    if (remoteDailyLogId === null) {
      remoteDailyLogId = await dependencies.createDailyLog(item)
      item = { ...item, remoteDailyLogId }
      remaining = replaceItem(remaining, item)
      await dependencies.persist(remaining)
    }

    for (const attachment of item.attachments) {
      await dependencies.uploadAttachment(item, remoteDailyLogId, attachment)
      item = {
        ...item,
        attachments: item.attachments.filter(
          (candidate) => candidate.id !== attachment.id
        ),
      }
      remaining = replaceItem(remaining, item)
      await dependencies.persist(remaining)
    }

    remaining = remaining.filter((candidate) => candidate.id !== item.id)
    await dependencies.persist(remaining)
    syncedCount += 1
  }

  return syncedCount
}
