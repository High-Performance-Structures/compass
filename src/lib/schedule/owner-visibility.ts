import { PHASE_LABELS, PHASE_ORDER } from "@/lib/schedule/phase-colors"

export type OwnerScheduleView = "items" | "phases"

export type OwnerScheduleSourceItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly status: string
  readonly phase: string
  readonly assignedTo: string | null
  readonly percentComplete: number
  readonly isMilestone: boolean
  readonly workdays: number
  readonly displayColor: string | null
}

export type OwnerScheduleVisibleItem = OwnerScheduleSourceItem

export function isOwnerScheduleView(
  value: string
): value is OwnerScheduleView {
  return value === "items" || value === "phases"
}

function phaseLabel(phase: string): string {
  const knownPhase = PHASE_ORDER.find((candidate) => candidate === phase)
  if (knownPhase) return PHASE_LABELS[knownPhase]

  return phase
    .split(/[_-]+/)
    .filter(Boolean)
    .map(
      (part) =>
        `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
    )
    .join(" ")
}

function phaseId(phase: string): string {
  const safePhase = phase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `owner-phase-${safePhase || "uncategorized"}`
}

export function summarizeOwnerScheduleByPhase(
  items: readonly OwnerScheduleSourceItem[]
): readonly OwnerScheduleVisibleItem[] {
  const grouped = new Map<string, OwnerScheduleSourceItem[]>()

  for (const item of items) {
    const phase = item.phase.trim() || "uncategorized"
    const existing = grouped.get(phase) ?? []
    existing.push(item)
    grouped.set(phase, existing)
  }

  return [...grouped].map(([phase, phaseItems]) => {
    const totalWeight = phaseItems.reduce(
      (sum, item) => sum + Math.max(1, item.workdays),
      0
    )
    const percentComplete = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          phaseItems.reduce(
            (sum, item) =>
              sum + item.percentComplete * Math.max(1, item.workdays),
            0
          ) / totalWeight
        )
      )
    )
    const allComplete = phaseItems.every(
      (item) =>
        item.status.toUpperCase() === "COMPLETE" ||
        item.percentComplete >= 100
    )
    const hasProgress = phaseItems.some(
      (item) =>
        item.status.toUpperCase() === "IN_PROGRESS" ||
        item.percentComplete > 0
    )

    return {
      id: phaseId(phase),
      title: phaseLabel(phase),
      startDate: phaseItems.reduce(
        (earliest, item) =>
          item.startDate < earliest ? item.startDate : earliest,
        phaseItems[0].startDate
      ),
      endDate: phaseItems.reduce(
        (latest, item) => (item.endDate > latest ? item.endDate : latest),
        phaseItems[0].endDate
      ),
      status: allComplete
        ? "COMPLETE"
        : hasProgress
          ? "IN_PROGRESS"
          : "PENDING",
      phase,
      assignedTo: null,
      percentComplete: allComplete ? 100 : percentComplete,
      isMilestone: false,
      workdays: totalWeight,
      displayColor: phaseItems[0].displayColor,
    }
  }).sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.title.localeCompare(right.title)
  )
}

/** Keep only actionable personal commitments beside a phase overview. */
export function selectOwnScheduleCommitments<T extends {
  readonly viewerCanConfirm: boolean
  readonly assignees: readonly { readonly viewerCanRespond: boolean }[]
}>(items: readonly T[]): readonly T[] {
  return items.filter((item) => item.viewerCanConfirm ||
    item.assignees.some((assignee) => assignee.viewerCanRespond))
}
