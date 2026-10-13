/**
 * How estimates work in each department (Settings → Workflows → Estimates).
 *
 * - "single": one contract estimate per job. A new estimate or a duplicate is
 *   the next version; accepting one replaces any earlier accepted estimate and
 *   becomes the contract budget; later changes go through change orders.
 * - "multiple": several estimates at once (bracing, block, …). Each has its
 *   own number (-01, -02) and versions, is accepted on its own, and doesn't
 *   set a contract budget.
 */
export const ESTIMATE_MODES = ["single", "multiple"] as const
export type EstimateMode = (typeof ESTIMATE_MODES)[number]

/** Built-in modes: Nu-Tech sells bracing, block and more separately. */
export const DEFAULT_ESTIMATE_MODES: Readonly<Record<string, EstimateMode>> = { N: "multiple" }

export function estimateModeFor(
  department: string | null,
  configured: Readonly<Record<string, EstimateMode>>,
): EstimateMode {
  if (!department) return "single"
  return configured[department] ?? DEFAULT_ESTIMATE_MODES[department] ?? "single"
}

function suffixOf(estimateNumber: string, prefix: string): number | null {
  if (!estimateNumber.startsWith(`${prefix}-`)) return null
  const rest = estimateNumber.slice(prefix.length + 1)
  return /^\d{2,3}$/.test(rest) ? Number(rest) : null
}

/**
 * The next separate estimate number on a job: the project number with the
 * next two-digit suffix after any already used (N-1003-00-00 → N-1003-00-01).
 */
export function nextEstimateNumber(projectNumber: string | null, existing: readonly string[]): string {
  const prefix = projectNumber ?? "PROJECT"
  const used = existing.map((number) => suffixOf(number, prefix)).filter((value): value is number => value !== null)
  const next = used.length === 0 ? 1 : Math.max(...used) + 1
  return `${prefix}-${String(next).padStart(2, "0")}`
}
