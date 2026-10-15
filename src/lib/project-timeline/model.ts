/**
 * A project's timeline: daily logs, to-dos, client contact, office time,
 * machine hours and schedule changes in one feed, newest first.
 */

export const PROJECT_TIMELINE_KINDS = ["log", "todo", "contact", "duty", "machine", "schedule"] as const

export type ProjectTimelineKind = (typeof PROJECT_TIMELINE_KINDS)[number]

export const PROJECT_TIMELINE_KIND_LABELS: { readonly [K in ProjectTimelineKind]: string } = {
  log: "Daily logs",
  todo: "To-dos",
  contact: "Client contact",
  duty: "Office time",
  machine: "Machines",
  schedule: "Schedule changes",
}

/** The short tag on each row. */
export const PROJECT_TIMELINE_ITEM_LABELS: { readonly [K in ProjectTimelineKind]: string } = {
  log: "Daily log",
  todo: "To-do",
  contact: "Client contact",
  duty: "Office time",
  machine: "Machine",
  schedule: "Schedule",
}

export type ProjectTimelineItem = {
  readonly id: string
  readonly kind: ProjectTimelineKind
  /** The day it belongs to (YYYY-MM-DD, company time). */
  readonly date: string
  /** For ordering within a day. */
  readonly at: string
  readonly title: string
  readonly body: string | null
  readonly meta: string | null
  readonly href: string | null
  readonly hrefLabel: string | null
  /** A daily log shared in owner updates. */
  readonly ownerVisible: boolean
  /** A to-do that's blocked, so the row can say so. */
  readonly blocked: boolean
}

export type ProjectTimelineDay = {
  readonly date: string
  readonly items: readonly ProjectTimelineItem[]
}

/** Hours on each cost code over the period, from daily log lines. */
export type ProjectTimelineCodeHours = {
  readonly code: string
  readonly label: string
  readonly hours: number
}

export type ProjectTimeline = {
  readonly from: string
  readonly to: string
  readonly kinds: readonly ProjectTimelineKind[]
  readonly days: readonly ProjectTimelineDay[]
  readonly codeHours: readonly ProjectTimelineCodeHours[]
  /** Hours on lines tied to a to-do, and the rest. */
  readonly todoHours: number
  readonly otherHours: number
}

/** Groups items by day, newest day and newest item first. */
export function timelineDays(items: readonly ProjectTimelineItem[]): readonly ProjectTimelineDay[] {
  const byDate = new Map<string, ProjectTimelineItem[]>()
  for (const item of items) {
    const list = byDate.get(item.date) ?? []
    list.push(item)
    byDate.set(item.date, list)
  }
  const order: { readonly [K in ProjectTimelineKind]: number } = { log: 0, contact: 1, todo: 2, schedule: 3, machine: 4, duty: 5 }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      items: list.toSorted((a, b) => order[a.kind] - order[b.kind] || b.at.localeCompare(a.at)),
    }))
}

/** Days before `date` (YYYY-MM-DD), as a date key. */
export function shiftDateKey(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
  return shifted.toISOString().slice(0, 10)
}

export function hoursText(hours: number): string {
  return `${hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} h`
}

/** Items of the chosen kinds; "all" keeps everything. */
export function filterTimeline(days: readonly ProjectTimelineDay[], kind: ProjectTimelineKind | "all"): readonly ProjectTimelineDay[] {
  if (kind === "all") return days
  return days
    .map((day) => ({ ...day, items: day.items.filter((item) => item.kind === kind) }))
    .filter((day) => day.items.length > 0)
}
