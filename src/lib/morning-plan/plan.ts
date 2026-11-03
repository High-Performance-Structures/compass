import { countBusinessDays } from "@/lib/schedule/business-days"
import type { WorkdayExceptionData } from "@/lib/schedule/types"

// Today's plan and weekly workload, computed from plain inputs so the
// dashboard card, the daily digest and the overload warning all agree.

export type PlanScheduleItem = {
  readonly id: string
  readonly title: string
  readonly projectLabel: string
  readonly startDate: string
  readonly endDate: string
  readonly href: string
}

export type PlanTodo = {
  readonly id: string
  readonly title: string
  readonly projectLabel: string
  readonly dueDate: string
  readonly priority: string
  readonly href: string
}

export type PlanMeeting = {
  readonly id: string
  readonly title: string
  readonly projectLabel: string | null
  /** Local HH:MM, or null for an all-day event. */
  readonly startTime: string | null
  readonly href: string
}

export type PlanSection = "overdue" | "today" | "meetings" | "thisWeek"

export type PlanEntry = {
  readonly key: string
  readonly section: PlanSection
  readonly kind: "schedule" | "todo" | "meeting"
  readonly title: string
  readonly projectLabel: string | null
  /** Short plain-language timing, such as "Due today" or "10:30". */
  readonly detail: string
  readonly href: string
}

export type TodaysPlan = {
  readonly today: string
  readonly entries: readonly PlanEntry[]
}

const SECTION_ORDER: readonly PlanSection[] = ["overdue", "today", "meetings", "thisWeek"]

/** Monday and Sunday of the week containing `date` (YYYY-MM-DD). */
export function weekBounds(date: string): { readonly start: string; readonly end: string } {
  const value = new Date(`${date}T12:00:00Z`)
  const mondayOffset = (value.getUTCDay() + 6) % 7
  return { start: shiftDate(date, -mondayOffset), end: shiftDate(date, 6 - mondayOffset) }
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function time12(value: string): string {
  const [hour = 0, minute = 0] = value.split(":").map(Number)
  const suffix = hour >= 12 ? "PM" : "AM"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`
}

/** Overdue first, then due or underway today, today's meetings, then later this week. */
export function buildTodaysPlan(input: {
  readonly today: string
  readonly scheduleItems: readonly PlanScheduleItem[]
  readonly todos: readonly PlanTodo[]
  readonly meetings: readonly PlanMeeting[]
}): TodaysPlan {
  const { today } = input
  const weekEnd = weekBounds(today).end
  const entries: (PlanEntry & { readonly sortKey: string })[] = []

  for (const item of input.scheduleItems) {
    const base = { key: `schedule:${item.id}`, kind: "schedule" as const, title: item.title, projectLabel: item.projectLabel, href: item.href }
    if (item.endDate < today) {
      entries.push({ ...base, section: "overdue", detail: `Was due ${shortDate(item.endDate)}`, sortKey: item.endDate })
    } else if (item.endDate === today) {
      entries.push({ ...base, section: "today", detail: "Due today", sortKey: `0${item.endDate}` })
    } else if (item.startDate <= today) {
      entries.push({ ...base, section: "today", detail: `Underway, due ${shortDate(item.endDate)}`, sortKey: `1${item.endDate}` })
    } else if (item.startDate <= weekEnd) {
      entries.push({ ...base, section: "thisWeek", detail: `Starts ${shortDate(item.startDate)}`, sortKey: item.startDate })
    }
  }

  for (const todo of input.todos) {
    const base = { key: `todo:${todo.id}`, kind: "todo" as const, title: todo.title, projectLabel: todo.projectLabel, href: todo.href }
    if (todo.dueDate < today) {
      entries.push({ ...base, section: "overdue", detail: `To-do, was due ${shortDate(todo.dueDate)}`, sortKey: todo.dueDate })
    } else if (todo.dueDate === today) {
      entries.push({ ...base, section: "today", detail: "To-do, due today", sortKey: `0${todo.dueDate}` })
    } else if (todo.dueDate <= weekEnd) {
      entries.push({ ...base, section: "thisWeek", detail: `To-do, due ${shortDate(todo.dueDate)}`, sortKey: todo.dueDate })
    }
  }

  for (const meeting of input.meetings) {
    entries.push({
      key: `meeting:${meeting.id}`,
      section: "meetings",
      kind: "meeting",
      title: meeting.title,
      projectLabel: meeting.projectLabel,
      detail: meeting.startTime ? time12(meeting.startTime) : "All day",
      href: meeting.href,
      // All-day events first, then by time.
      sortKey: meeting.startTime ?? "",
    })
  }

  entries.sort(
    (left, right) =>
      SECTION_ORDER.indexOf(left.section) - SECTION_ORDER.indexOf(right.section) ||
      left.sortKey.localeCompare(right.sortKey) ||
      left.title.localeCompare(right.title)
  )
  return {
    today,
    entries: entries.map((entry) => ({
      key: entry.key,
      section: entry.section,
      kind: entry.kind,
      title: entry.title,
      projectLabel: entry.projectLabel,
      detail: entry.detail,
      href: entry.href,
    })),
  }
}

type WorkloadCandidate = {
  readonly key: string
  readonly title: string
  readonly projectLabel: string
  readonly href: string
  readonly workdays: number
  readonly reason: string
}

export type WeekLoad = {
  readonly weekStart: string
  readonly weekEnd: string
  readonly availableWorkdays: number
  readonly assignedWorkdays: number
  /** Assigned as a share of available, rounded; null when no workdays are available. */
  readonly percent: number | null
  readonly overloaded: boolean
  /** Items that could move to bring the week back under the threshold. */
  readonly suggestions: readonly WorkloadCandidate[]
}

const PRIORITY_RANK: Readonly<Record<string, number>> = { low: 0, normal: 1, medium: 1, high: 2, urgent: 3 }

/**
 * Compares the week's assigned workdays with the workdays available.
 * Schedule items count the workdays they cover inside the week (two
 * overlapping items count twice); each open to-do due this week counts
 * `todoWorkdays`.
 */
export function measureWeekLoad(input: {
  readonly today: string
  readonly scheduleItems: readonly PlanScheduleItem[]
  readonly todos: readonly PlanTodo[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly thresholdPercent: number
  readonly todoWorkdays: number
}): WeekLoad {
  const { start: weekStart, end: weekEnd } = weekBounds(input.today)
  const availableWorkdays = countBusinessDays(weekStart, weekEnd, input.exceptions)
  const candidates: (WorkloadCandidate & { readonly rank: number; readonly due: string })[] = []

  for (const item of input.scheduleItems) {
    const from = item.startDate > weekStart ? item.startDate : weekStart
    const to = item.endDate < weekEnd ? item.endDate : weekEnd
    if (from > to) continue
    const workdays = countBusinessDays(from, to, input.exceptions)
    if (workdays === 0) continue
    candidates.push({
      key: `schedule:${item.id}`,
      title: item.title,
      projectLabel: item.projectLabel,
      href: item.href,
      workdays,
      reason: `Due ${shortDate(item.endDate)}`,
      rank: 1,
      due: item.endDate,
    })
  }
  for (const todo of input.todos) {
    if (todo.dueDate < weekStart || todo.dueDate > weekEnd || input.todoWorkdays === 0) continue
    candidates.push({
      key: `todo:${todo.id}`,
      title: todo.title,
      projectLabel: todo.projectLabel,
      href: todo.href,
      workdays: input.todoWorkdays,
      reason: `To-do, ${todo.priority} priority, due ${shortDate(todo.dueDate)}`,
      rank: PRIORITY_RANK[todo.priority] ?? 1,
      due: todo.dueDate,
    })
  }

  const assignedWorkdays = round(candidates.reduce((total, item) => total + item.workdays, 0))
  const capacity = (availableWorkdays * input.thresholdPercent) / 100
  const overloaded = availableWorkdays === 0 ? assignedWorkdays > 0 : assignedWorkdays > capacity
  const suggestions: WorkloadCandidate[] = []
  if (overloaded) {
    // Lowest priority first, then the latest due: the work that can most
    // easily wait.
    const ordered = [...candidates].sort((left, right) => left.rank - right.rank || right.due.localeCompare(left.due))
    let remaining = assignedWorkdays
    for (const candidate of ordered) {
      if (remaining <= capacity || suggestions.length >= 3) break
      suggestions.push({
        key: candidate.key,
        title: candidate.title,
        projectLabel: candidate.projectLabel,
        href: candidate.href,
        workdays: candidate.workdays,
        reason: candidate.reason,
      })
      remaining -= candidate.workdays
    }
  }
  return {
    weekStart,
    weekEnd,
    availableWorkdays,
    assignedWorkdays,
    percent: availableWorkdays === 0 ? null : Math.round((assignedWorkdays / availableWorkdays) * 100),
    overloaded,
    suggestions,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** The plan as plain text for the daily email or push. */
export function planDigestText(plan: TodaysPlan, load: WeekLoad | null): string {
  const lines: string[] = []
  const labels: Readonly<Record<PlanSection, string>> = {
    overdue: "Overdue",
    today: "Today",
    meetings: "Meetings",
    thisWeek: "Later this week",
  }
  for (const section of SECTION_ORDER) {
    const entries = plan.entries.filter((entry) => entry.section === section)
    if (entries.length === 0) continue
    lines.push(`${labels[section]}:`)
    for (const entry of entries.slice(0, 8)) {
      lines.push(`- ${entry.projectLabel ? `${entry.projectLabel} · ` : ""}${entry.title} (${entry.detail})`)
    }
    if (entries.length > 8) lines.push(`- and ${entries.length - 8} more`)
  }
  if (lines.length === 0) lines.push("Nothing is assigned to you for today or the rest of this week.")
  if (load?.overloaded) {
    lines.push("", `This week holds ${load.assignedWorkdays} workdays of assigned work for ${load.availableWorkdays} available.`)
  }
  return lines.join("\n")
}
