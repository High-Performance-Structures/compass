function parseIdList(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** Why a daily log can't be deleted by this viewer, or null when it can. */
export function dailyLogDeleteBlocker(
  log: {
    readonly id: string
    readonly logDate: string
    readonly authorId: string | null
    readonly reviewStatus: string
    readonly isClientVisible: boolean
  },
  context: {
    readonly viewerId: string
    readonly canDeleteAny: boolean
    readonly canUpdate: boolean
    readonly ownerUpdates: readonly { readonly title: string; readonly sourceDailyLogIds: string | null }[]
  },
): string | null {
  const usedBy = context.ownerUpdates.find((update) => parseIdList(update.sourceDailyLogIds).includes(log.id))
  if (usedBy) return `The ${log.logDate} log is used by the owner update "${usedBy.title}". Remove it from that update first.`
  if (context.canDeleteAny) return null
  const ownUnshared =
    context.canUpdate &&
    log.authorId === context.viewerId &&
    log.reviewStatus !== "approved" &&
    !log.isClientVisible
  if (ownUnshared) return null
  return log.authorId === context.viewerId
    ? `The ${log.logDate} log is approved or shared with the owner. Ask an admin to delete it.`
    : `Only an admin or the person who wrote it can delete the ${log.logDate} log.`
}
