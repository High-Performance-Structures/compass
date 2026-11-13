/*
 * Company names for the selection statuses. The status keys
 * (`owner_review`, `rfq_sent`, ...) never change: automatic moves, the
 * sheet's filter groups and the Buildertrend import all work on the keys.
 * Only the label a person reads can be renamed per company in Settings ›
 * Workflows › Selections › Status names. Every screen that shows a status
 * label goes through `selectionStatusLabel` with the company's resolved
 * labels (read once on the server, then passed down), falling back to the
 * default label. Pure and client-safe.
 */
import {
  PROJECT_SELECTION_STATUSES,
  PROJECT_SELECTION_STATUS_LABELS,
  type ProjectSelectionStatus,
} from "./statuses"

/** A label for every status (company name or default). */
export type SelectionStatusLabels = Readonly<Record<ProjectSelectionStatus, string>>

/** What a company stores: only the statuses it renamed. */
export type SelectionStatusNames = Readonly<Partial<Record<ProjectSelectionStatus, string>>>

export const DEFAULT_SELECTION_STATUS_LABELS: SelectionStatusLabels = PROJECT_SELECTION_STATUS_LABELS

export const SELECTION_STATUS_NAME_MAX_LENGTH = 40

function isProjectSelectionStatus(value: string): value is ProjectSelectionStatus {
  return PROJECT_SELECTION_STATUSES.some((status) => status === value)
}

/** Every status's label: the company's name where it set a non-blank one, else the default. */
export function resolveSelectionStatusLabels(names: SelectionStatusNames | null | undefined): SelectionStatusLabels {
  const resolved: Record<ProjectSelectionStatus, string> = { ...DEFAULT_SELECTION_STATUS_LABELS }
  for (const status of PROJECT_SELECTION_STATUSES) {
    const name = names?.[status]?.trim()
    if (name) resolved[status] = name
  }
  return resolved
}

/** The label to show for a status, falling back to the default label. */
export function selectionStatusLabel(status: ProjectSelectionStatus, labels: SelectionStatusLabels = DEFAULT_SELECTION_STATUS_LABELS): string {
  return labels[status]?.trim() || DEFAULT_SELECTION_STATUS_LABELS[status]
}

/**
 * The label for a status string that may not be a stored status: the owner
 * portal shows "awaiting_owner_approval" for a selection staff marked approved
 * before the owner signed off.
 */
export function selectionProgressLabel(status: string, labels: SelectionStatusLabels = DEFAULT_SELECTION_STATUS_LABELS): string {
  if (isProjectSelectionStatus(status)) return selectionStatusLabel(status, labels)
  if (status === "awaiting_owner_approval") return "Awaiting owner signature"
  const text = status.replaceAll("_", " ")
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/**
 * A selection's status as shown: "Approved" reads "Approved (signed)" only
 * when a signature covers it (a staff-set or older click approval stays
 * plain "Approved").
 */
export function selectionStatusDisplay(status: ProjectSelectionStatus, labels: SelectionStatusLabels | undefined, signed: boolean): string {
  const label = selectionStatusLabel(status, labels)
  return status === "approved" && signed ? `${label} (signed)` : label
}

/** Status picker options in workflow order, with the company's labels. */
export function selectionStatusOptions(
  labels: SelectionStatusLabels = DEFAULT_SELECTION_STATUS_LABELS,
): readonly { readonly value: ProjectSelectionStatus; readonly label: string }[] {
  return PROJECT_SELECTION_STATUSES.map((value) => ({ value, label: selectionStatusLabel(value, labels) }))
}

/**
 * Problems with a set of names, by status: a blank name, one longer than
 * the limit, or a label (after defaults fill the rest) that another status
 * already uses, compared without case. Empty when the names can be saved.
 * `names` here is every status's typed name; leave a status out to keep its
 * default.
 */
export function selectionStatusNameProblems(names: SelectionStatusNames): Readonly<Partial<Record<ProjectSelectionStatus, string>>> {
  const problems: Partial<Record<ProjectSelectionStatus, string>> = {}
  const labels: Record<ProjectSelectionStatus, string> = { ...DEFAULT_SELECTION_STATUS_LABELS }
  for (const status of PROJECT_SELECTION_STATUSES) {
    const typed = names[status]
    if (typed === undefined) continue
    const name = typed.trim()
    if (!name) problems[status] = "Enter a name, or reset it to the default."
    else if (name.length > SELECTION_STATUS_NAME_MAX_LENGTH) problems[status] = `Keep the name to ${SELECTION_STATUS_NAME_MAX_LENGTH} characters.`
    labels[status] = name
  }
  for (const status of PROJECT_SELECTION_STATUSES) {
    if (problems[status] || !labels[status]) continue
    const wanted = labels[status].toLocaleLowerCase()
    const other = PROJECT_SELECTION_STATUSES.find((candidate) => candidate !== status && labels[candidate].toLocaleLowerCase() === wanted)
    if (other) problems[status] = `"${labels[status]}" is already the name of another status. Each status needs its own name.`
  }
  return problems
}
