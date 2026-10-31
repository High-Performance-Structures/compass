import type { InternalDutySettings } from "@/lib/feature-settings/registry"
import type { RecurringDutyView } from "@/lib/internal-duties/recurring-data"

export const WORKSPACE_KINDS = ["office", "executive", "field"] as const

export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number]

export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return WORKSPACE_KINDS.some((kind) => kind === value)
}

/** What each kind of internal workspace is for, as people pick it. */
export const WORKSPACE_KIND_LABELS: Readonly<Record<WorkspaceKind, string>> = {
  office: "Office (duty log)",
  executive: "Owner's office",
  field: "Field crew or yard",
}

export type DutyOption = { readonly code: string; readonly label: string }

/** Active duties for one kind of workspace, in the order Settings lists them. */
export function dutiesFor(settings: InternalDutySettings, kind: WorkspaceKind): readonly DutyOption[] {
  // The owner's office logs the same administrative duties as the office.
  const workspace = kind === "executive" ? "office" : kind
  return settings.duties.filter((duty) => duty.active && duty.workspace === workspace).map(({ code, label }) => ({ code, label }))
}

/** Whether Field Mode offers a duty: field duties unless switched off, office duties only when switched on. */
export function dutyOnPhones(duty: { readonly workspace: "office" | "field"; readonly active: boolean; readonly onPhones?: boolean }): boolean {
  return duty.active && (duty.onPhones ?? duty.workspace === "field")
}

export function dutyDisplay(code: string, label: string): string {
  return `${code} ${label}`
}

/** Hours to the quarter hour; null when left blank. */
export function parseHours(value: string): { readonly ok: true; readonly hours: number | null } | { readonly ok: false; readonly error: string } {
  const clean = value.trim()
  if (!clean) return { ok: true, hours: null }
  const hours = Number(clean)
  if (!Number.isFinite(hours) || hours <= 0) return { ok: false, error: "Enter hours greater than zero, or leave hours blank." }
  if (hours > 24) return { ok: false, error: "One entry can't be more than 24 hours." }
  return { ok: true, hours: Math.round(hours * 4) / 4 }
}

export type DutySummaryRow = { readonly code: string; readonly label: string; readonly hours: number; readonly entries: number }

/** Hours by duty for entries in one month (YYYY-MM), largest first. */
export function monthSummary(
  entries: readonly { readonly entryDate: string; readonly dutyCode: string; readonly dutyLabel: string; readonly hours: number | null }[],
  month: string,
): readonly DutySummaryRow[] {
  const rows = new Map<string, { code: string; label: string; hours: number; entries: number }>()
  for (const entry of entries) {
    if (!entry.entryDate.startsWith(month)) continue
    const row = rows.get(entry.dutyCode) ?? { code: entry.dutyCode, label: entry.dutyLabel, hours: 0, entries: 0 }
    row.hours += entry.hours ?? 0
    row.entries += 1
    rows.set(entry.dutyCode, row)
  }
  return [...rows.values()].sort((a, b) => b.hours - a.hours || b.entries - a.entries)
}

/** Daily logs that no duty entry has categorized yet. */
export function uncategorizedLogs<T extends { readonly id: string }>(
  logs: readonly T[],
  categorizedLogIds: ReadonlySet<string>,
): readonly T[] {
  return logs.filter((log) => !categorizedLogIds.has(log.id))
}

export type InternalWorkspaceSummary = {
  readonly projectId: string
  readonly workspaceKind: WorkspaceKind
  /** Monday of the current week, YYYY-MM-DD. */
  readonly weekStart: string
  readonly weekHours: number
  readonly byDuty: readonly DutySummaryRow[]
  readonly byPerson: readonly { readonly name: string; readonly hours: number; readonly entries: number }[]
  /** Daily logs written before the duty log that still need a duty. */
  readonly waitingLogs: number
  readonly canEdit: boolean
  /** Recurring duties behind, due soon, or not started yet. */
  readonly attention: readonly RecurringDutyView[]
}
