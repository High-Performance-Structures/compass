import type {
  OwnerUpdateScheduleSelection,
  OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isoDateFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDaysToIsoDate(value: string, days: number): string {
  if (!ISO_DATE_PATTERN.test(value)) return value
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return isoDateFromUtc(date)
}

export function defaultOwnerUpdatePeriod(updateDate: string): {
  readonly startDate: string
  readonly endDate: string
} {
  return {
    startDate: addDaysToIsoDate(updateDate, -6),
    endDate: updateDate,
  }
}

export function isCompletedScheduleCandidate(
  item: {
    readonly status: string
    readonly percentComplete: number
    readonly endDate: string
  },
  periodStart: string,
  periodEnd: string
): boolean {
  const completed =
    item.percentComplete >= 100 ||
    ["COMPLETE", "COMPLETED", "DONE"].includes(item.status.toUpperCase())
  return (
    completed &&
    item.endDate >= periodStart &&
    item.endDate <= periodEnd
  )
}

export function isLookAheadScheduleCandidate(
  item: {
    readonly status: string
    readonly percentComplete: number
    readonly endDate: string
    readonly startDate: string
  },
  periodEnd: string
): boolean {
  const completed =
    item.percentComplete >= 100 ||
    ["COMPLETE", "COMPLETED", "DONE"].includes(item.status.toUpperCase())
  return !completed && item.endDate >= periodEnd
}

export function ownerUpdateTodoTiming(
  dueDate: string | null,
  periodStart: string,
  periodEnd: string
): "reporting_period" | "upcoming" | null {
  if (dueDate === null) return null
  if (dueDate >= periodStart && dueDate <= periodEnd) {
    return "reporting_period"
  }
  if (dueDate > periodEnd && dueDate <= addDaysToIsoDate(periodEnd, 7)) {
    return "upcoming"
  }
  return null
}

function scheduleLines(
  items: readonly OwnerUpdateScheduleSelection[]
): string {
  if (items.length === 0) return "- None selected"
  return items
    .map(
      (item) =>
        `- ${item.title} (${item.startDate} to ${item.endDate}; ` +
        `${item.percentComplete}% complete)` +
        (item.notes.trim().length > 0 ? ` — ${item.notes.trim()}` : "")
    )
    .join("\n")
}

function todoLines(items: readonly OwnerUpdateTodoSelection[]): string {
  if (items.length === 0) return "- None selected"
  return items
    .map(
      (item) =>
        `- ${item.title} (${item.status}` +
        (item.dueDate ? `; due ${item.dueDate}` : "") +
        (item.assigneeName ? `; ${item.assigneeName}` : "") +
        `)` +
        (item.description.trim().length > 0
          ? ` — ${item.description.trim()}`
          : "") +
        (item.notes.trim().length > 0 ? ` — ${item.notes.trim()}` : "")
    )
    .join("\n")
}

export function buildOwnerUpdateDraftPrompt(input: {
  readonly projectLabel: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly dailyLogs: readonly {
    readonly logDate: string
    readonly workCompleted: string
    readonly issues: string | null
    readonly notes: string | null
  }[]
  readonly attachments: readonly {
    readonly fileName: string
    readonly caption: string | null
    readonly kind: "photo" | "document"
  }[]
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
}): string {
  const logLines =
    input.dailyLogs.length === 0
      ? "- None selected"
      : input.dailyLogs
          .map(
            (log) =>
              `- ${log.logDate}: ${log.workCompleted}` +
              (log.issues ? ` Issues: ${log.issues}` : "") +
              (log.notes ? ` Notes/next: ${log.notes}` : "")
          )
          .join("\n")
  const attachmentLines =
    input.attachments.length === 0
      ? "- None selected"
      : input.attachments
          .map(
            (attachment) =>
              `- ${attachment.kind}: ` +
              `${attachment.caption ?? attachment.fileName}`
          )
          .join("\n")

  return [
    "Draft the concise owner-facing Summary section for a construction project update.",
    "Use only the supplied information. Do not invent facts, dates, completion percentages, commitments, or names.",
    "Write in a clear, confident, professional tone. Avoid internal jargon and avoid mentioning that you are an AI.",
    "Return only the editable summary text, using short paragraphs and no markdown heading.",
    `Project: ${input.projectLabel}`,
    `Reporting period: ${input.periodStart} through ${input.periodEnd}`,
    "",
    "Selected daily logs:",
    logLines,
    "",
    "Selected photos and documents:",
    attachmentLines,
    "",
    "Selected schedule items completed during the period:",
    scheduleLines(input.completedScheduleItems),
    "",
    "Selected schedule items looking ahead:",
    scheduleLines(input.lookAheadScheduleItems),
    "",
    "Selected to-dos:",
    todoLines(input.todos),
  ].join("\n")
}

export function cleanOwnerUpdateDraft(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) return trimmed

  return trimmed
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
}
