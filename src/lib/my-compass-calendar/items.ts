import { scheduleItemTimedWindow, scheduleItemTimeLabel } from "@/lib/schedule/item-time"
import { projectTodoHref, scheduleItemHref } from "@/lib/work-calendar"

/** One event Compass keeps on a person's My Compass calendar; all day unless timed. */
export type MyCompassItem = {
  /** "<source>:<record id>"; stable across syncs. */
  readonly key: string
  readonly summary: string
  readonly description: string
  /** Inclusive first day, YYYY-MM-DD. */
  readonly startDate: string
  /** Exclusive end day, YYYY-MM-DD (Google's all-day convention). */
  readonly endDateExclusive: string
  /** Set for a single-day schedule item with a time. */
  readonly timed?: { readonly startsAt: string; readonly endsAt: string; readonly timeZone: string }
}

export type PersonIdentity = {
  readonly email: string
  readonly googleEmail: string | null
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly otherNames: readonly string[]
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim()
}

/** Every way this person's name or address appears on an assignment. */
export function personAliases(person: PersonIdentity): ReadonlySet<string> {
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ")
  return new Set(
    [person.email, person.googleEmail, person.displayName, fullName, ...person.otherNames]
      .map(normalizeName)
      .filter((alias) => alias.length >= 3)
  )
}

/**
 * Assignments are stored as text, often several names in one field
 * ("Daniel Vogel, High Performance Structures, Inc., Martine Vogel"), so
 * each listed part is compared with the person's names.
 */
export function assignmentIncludes(assignment: string | null, aliases: ReadonlySet<string>): boolean {
  if (!assignment) return false
  const whole = normalizeName(assignment)
  if (aliases.has(whole)) return true
  return assignment
    .split(/[,;/\n]|\s&\s|\sand\s/i)
    .map(normalizeName)
    .some((part) => aliases.has(part))
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function projectPrefix(project: { readonly name: string; readonly projectNumber: string | null }): string {
  return project.projectNumber?.trim() || project.name
}

function link(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`
}

export function scheduleItem(input: {
  readonly baseUrl: string
  readonly task: {
    readonly id: string
    readonly projectId: string
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly phase: string
    readonly isMilestone: boolean
    readonly assignedTo: string | null
    readonly startTime?: string | null
    readonly endTime?: string | null
  }
  readonly project: { readonly name: string; readonly projectNumber: string | null }
  /** Needed for an item with a time; without it the item stays all day. */
  readonly timeZone?: string
}): MyCompassItem {
  const { task, project } = input
  const start = task.isMilestone ? task.endDate : task.startDate
  const end = task.endDate < start ? start : task.endDate
  const window = input.timeZone ? scheduleItemTimedWindow(task) : null
  const timeLabel = scheduleItemTimeLabel(task)
  return {
    key: `schedule:${task.id}`,
    summary: `${projectPrefix(project)} · ${task.isMilestone ? "Milestone: " : ""}${task.title}`,
    description: [
      `${project.projectNumber ? `${project.projectNumber} ` : ""}${project.name}`,
      task.phase ? `Phase: ${task.phase}` : null,
      task.assignedTo ? `Assigned to: ${task.assignedTo}` : null,
      timeLabel && !window ? `Time: ${timeLabel}` : null,
      "",
      `Open in Compass: ${link(input.baseUrl, scheduleItemHref(task.projectId, task.id))}`,
      "",
      "Kept up to date by Compass. Change it in Compass; edits made here are replaced.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    startDate: start,
    endDateExclusive: addDays(end, 1),
    ...(window && input.timeZone ? { timed: { ...window, timeZone: input.timeZone } } : {}),
  }
}

export function todoItem(input: {
  readonly baseUrl: string
  readonly todo: {
    readonly id: string
    readonly projectId: string
    readonly title: string
    readonly dueDate: string
    readonly assigneeName: string | null
  }
  readonly project: { readonly name: string; readonly projectNumber: string | null }
}): MyCompassItem {
  const { todo, project } = input
  return {
    key: `todo:${todo.id}`,
    summary: `${projectPrefix(project)} · To-do: ${todo.title}`,
    description: [
      `${project.projectNumber ? `${project.projectNumber} ` : ""}${project.name}`,
      todo.assigneeName ? `Assigned to: ${todo.assigneeName}` : null,
      "",
      `Open in Compass: ${link(input.baseUrl, projectTodoHref(todo.projectId, todo.id))}`,
      "",
      "Kept up to date by Compass. Change it in Compass; edits made here are replaced.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    startDate: todo.dueDate,
    endDateExclusive: addDays(todo.dueDate, 1),
  }
}

/** Changes whenever anything Google shows for the item changes. */
export async function itemHash(item: MyCompassItem): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify([
      item.summary,
      item.description,
      item.startDate,
      item.endDateExclusive,
      // Left out for all-day items so their existing hashes don't change.
      ...(item.timed ? [item.timed] : []),
    ])
  )
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
