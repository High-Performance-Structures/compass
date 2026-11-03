/**
 * Everyone assigned to a schedule item. The owner decided on 2026-10-31 that
 * all assignees are equal: there is no lead or helper role.
 *
 * schedule_task_people is the source of truth. schedule_tasks.assigned_to
 * keeps the names joined with ", " and assigned_user_id the first linked
 * account, so readers that only know the single columns keep working.
 */
import type { ScheduleTaskPersonData } from "./types"

/** Most people one schedule item may be assigned to. */
export const MAX_SCHEDULE_ASSIGNEES = 25

/** One assignee as the form sends it: the name and the picked option, if any. */
export type ScheduleAssigneeInput = {
  readonly name: string
  readonly optionId: string | null
}

type AssignedItem = {
  readonly assignedTo: string | null
  readonly assignedUserId?: string | null
  readonly people?: readonly ScheduleTaskPersonData[]
}

/** The joined names stored in schedule_tasks.assigned_to. */
export function joinAssigneeNames(names: readonly string[]): string | null {
  return names.length > 0 ? names.join(", ") : null
}

/** Trimmed assignees in picked order, without blanks or repeated names. */
export function normalizeAssigneeInputs(
  inputs: readonly ScheduleAssigneeInput[]
): ScheduleAssigneeInput[] {
  const seen = new Set<string>()
  const result: ScheduleAssigneeInput[] = []
  for (const input of inputs) {
    const name = input.name.trim().replace(/\s+/g, " ")
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    result.push({ name, optionId: input.optionId?.trim() || null })
  }
  return result
}

/**
 * The people rows, while they still describe assigned_to. A writer that set
 * only assigned_to (an older import, the API) wins over stale rows, and an
 * item with no rows yet shows its single stored name.
 */
function currentPeople(item: AssignedItem): readonly ScheduleTaskPersonData[] | null {
  const people = item.people ?? []
  if (people.length === 0) return null
  return joinAssigneeNames(people.map((person) => person.name)) === item.assignedTo ? people : null
}

/** The names to show for an item, in picked order. */
export function scheduleItemAssigneeNames(item: AssignedItem): readonly string[] {
  const people = currentPeople(item)
  if (people) return people.map((person) => person.name)
  const single = item.assignedTo?.trim()
  return single ? [single] : []
}

/**
 * Every linked Compass account assigned to the item, in picked order and
 * de-duplicated. assigned_user_id is always included: it is the first linked
 * person, or the account an older single-name edit kept.
 */
export function scheduleItemAssigneeUserIds(item: AssignedItem): readonly string[] {
  const people = currentPeople(item) ?? []
  const ids = [...people.map((person) => person.assignedUserId), item.assignedUserId ?? null]
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

/** "Ann Lee", "Ann Lee +2", or the fallback when nobody is assigned. */
export function compactAssigneeLabel(names: readonly string[], fallback = "-"): string {
  const [first, ...rest] = names
  if (first === undefined) return fallback
  return rest.length > 0 ? `${first} +${rest.length}` : first
}

/** The accounts in `next` that `previous` did not have, in `next` order. */
export function addedAssigneeUserIds(
  previous: readonly string[],
  next: readonly string[]
): string[] {
  const before = new Set(previous)
  return next.filter((id) => !before.has(id))
}

/** True when two people lists hold the same people, links and order. */
export function samePeople(
  left: readonly ScheduleTaskPersonData[],
  right: readonly ScheduleTaskPersonData[]
): boolean {
  return (
    left.length === right.length &&
    left.every((person, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        person.name === other.name &&
        person.assignedUserId === other.assignedUserId &&
        person.projectContactId === other.projectContactId
      )
    })
  )
}
