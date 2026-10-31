/**
 * Who a schedule item is assigned to, cleaned up, and where the same crew or
 * company is booked on two jobs at once.
 *
 * "Assigned to" is free text, much of it imported: several names in one field
 * ("Daniel Vogel, High Performance Structures, Inc., Wesley Jones"), the same
 * company spelled several ways ("HPHigh Performance Structures, Inc."), and
 * initials with no names behind them ("DVHPMVWJ+1"). Each name is turned into a
 * party with a stable key so the variations match.
 */

export type ScheduleParty = {
  /** Matching key: lower case, no punctuation or company suffixes. */
  readonly key: string
  /** How the party is shown. */
  readonly label: string
}

export type ScheduleConflictSettings = {
  /** Names never treated as a conflict (e.g. a company with several crews). */
  readonly ignoredParties: readonly string[]
  /** Extra spellings of a name: `from` is treated as `to`. */
  readonly aliases: readonly { readonly from: string; readonly to: string }[]
}

export const NO_CONFLICT_SETTINGS: ScheduleConflictSettings = { ignoredParties: [], aliases: [] }

const COMPANY_SUFFIXES = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "pllc", "lp", "llp"])

/** A comma-separated piece that belongs to the name before it ("Inc.", "LLC"). */
function isSuffixPiece(piece: string): boolean {
  return COMPANY_SUFFIXES.has(piece.toLowerCase().replace(/[^a-z]/g, ""))
}

/**
 * Strips initials glued to the front of a name by an import: "HPHigh
 * Performance Structures" → "High Performance Structures", but only when the
 * initials are the first letters of the words that follow.
 */
function stripGluedInitials(name: string): string {
  const match = /^([A-Z]{2,})([A-Z][a-z].*)$/.exec(name)
  if (!match?.[1] || !match[2]) return name
  const initials = match[1]
  const rest = match[2]
  const leading = rest
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
  return leading.startsWith(initials) ? rest : name
}

function partyKey(name: string): string {
  return stripGluedInitials(name.trim())
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !COMPANY_SUFFIXES.has(word))
    .join(" ")
}

/** True for a bare initials code with no name behind it, e.g. "DVHPMVWJ+1". */
function isInitialsOnly(name: string): boolean {
  return /^[A-Z]{2,}(\s*\+\s*\d+)?$/.test(name.replace(/\s+/g, ""))
}

function aliasMap(settings: ScheduleConflictSettings): ReadonlyMap<string, string> {
  return new Map(
    settings.aliases.flatMap((alias) => {
      const from = partyKey(alias.from)
      const to = alias.to.trim()
      return from && to ? [[from, to] as const] : []
    }),
  )
}

/** The parties named in an item's "Assigned to", cleaned up and de-duplicated. */
export function scheduleParties(
  assignedTo: string | null,
  settings: ScheduleConflictSettings = NO_CONFLICT_SETTINGS,
  aliases: ReadonlyMap<string, string> = aliasMap(settings),
): readonly ScheduleParty[] {
  if (!assignedTo?.trim()) return []
  const pieces: string[] = []
  for (const raw of assignedTo.split(/[,;\n]/)) {
    const piece = raw.trim()
    if (!piece) continue
    const previous = pieces.at(-1)
    if (previous !== undefined && isSuffixPiece(piece)) pieces[pieces.length - 1] = `${previous}, ${piece}`
    else pieces.push(piece)
  }
  const parties = new Map<string, ScheduleParty>()
  for (const piece of pieces) {
    if (isInitialsOnly(piece)) continue
    const alias = aliases.get(partyKey(piece))
    const label = (alias ?? stripGluedInitials(piece)).trim()
    const key = partyKey(label)
    if (key && !parties.has(key)) parties.set(key, { key, label })
  }
  return [...parties.values()]
}

export type ScheduleConflictTask = {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly startDate: string
  readonly endDateCalculated: string
  readonly status: string
  readonly assignedTo: string | null
}

export type ScheduleConflict = {
  readonly party: string
  readonly otherTaskId: string
  readonly otherProjectId: string
  readonly otherTitle: string
  /** First and last day both items are scheduled. */
  readonly from: string
  readonly to: string
}

/**
 * Items whose crew or company is also booked on another job over the same
 * days. Finished items and ignored names don't count; two items on the same
 * job never conflict.
 */
export function findScheduleConflicts(
  tasks: readonly ScheduleConflictTask[],
  settings: ScheduleConflictSettings = NO_CONFLICT_SETTINGS,
): ReadonlyMap<string, readonly ScheduleConflict[]> {
  const aliases = aliasMap(settings)
  const ignored = new Set(settings.ignoredParties.map((name) => partyKey(aliases.get(partyKey(name)) ?? name)))
  const byParty = new Map<string, { label: string; tasks: ScheduleConflictTask[] }>()
  for (const task of tasks) {
    if (task.status === "COMPLETE") continue
    for (const party of scheduleParties(task.assignedTo, settings, aliases)) {
      if (ignored.has(party.key)) continue
      const entry = byParty.get(party.key) ?? { label: party.label, tasks: [] }
      entry.tasks.push(task)
      byParty.set(party.key, entry)
    }
  }

  const conflicts = new Map<string, ScheduleConflict[]>()
  const add = (task: ScheduleConflictTask, other: ScheduleConflictTask, party: string): void => {
    const list = conflicts.get(task.id) ?? []
    list.push({
      party,
      otherTaskId: other.id,
      otherProjectId: other.projectId,
      otherTitle: other.title,
      from: task.startDate > other.startDate ? task.startDate : other.startDate,
      to: task.endDateCalculated < other.endDateCalculated ? task.endDateCalculated : other.endDateCalculated,
    })
    conflicts.set(task.id, list)
  }
  for (const { label, tasks: partyTasks } of byParty.values()) {
    const sorted = partyTasks.toSorted((a, b) => a.startDate.localeCompare(b.startDate))
    for (let i = 0; i < sorted.length; i += 1) {
      const task = sorted[i]
      if (!task) continue
      for (let j = i + 1; j < sorted.length; j += 1) {
        const other = sorted[j]
        if (!other || other.startDate > task.endDateCalculated) break
        if (other.projectId === task.projectId || other.endDateCalculated < task.startDate) continue
        add(task, other, label)
        add(other, task, label)
      }
    }
  }
  return conflicts
}

/** "Kent Glass LLC is also on H-215-660 (Window install) Oct 14–Oct 16." */
export function conflictSummary(
  conflict: ScheduleConflict,
  projectLabel: (projectId: string) => string,
): string {
  const range = conflict.from === conflict.to ? shortDay(conflict.from) : `${shortDay(conflict.from)}–${shortDay(conflict.to)}`
  return `${conflict.party} is also on ${projectLabel(conflict.otherProjectId)} (${conflict.otherTitle}) ${range}.`
}

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export type WorkloadDay = {
  readonly date: string
  /** Items scheduled that day, across every job shown. */
  readonly active: number
  /** How many of them are in a conflict that day. */
  readonly conflicted: number
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** Items active on each day from `from` for `days` days, and how many conflict. */
export function scheduleWorkload(
  tasks: readonly Pick<ScheduleConflictTask, "id" | "startDate" | "endDateCalculated" | "status">[],
  conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>,
  from: string,
  days: number,
): readonly WorkloadDay[] {
  const result: WorkloadDay[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset)
    let active = 0
    let conflicted = 0
    for (const task of tasks) {
      if (task.status === "COMPLETE" || task.startDate > date || task.endDateCalculated < date) continue
      active += 1
      if ((conflicts.get(task.id) ?? []).some((conflict) => conflict.from <= date && conflict.to >= date)) conflicted += 1
    }
    result.push({ date, active, conflicted })
  }
  return result
}

/** The crew a "By crew" grouping files an item under: its first party, or "Unassigned". */
export function primaryParty(
  assignedTo: string | null,
  settings: ScheduleConflictSettings = NO_CONFLICT_SETTINGS,
): ScheduleParty {
  return scheduleParties(assignedTo, settings)[0] ?? { key: "", label: "Unassigned" }
}
