/**
 * Machine log rules shared by the browser, Field Mode and the server:
 * checking an entry, pricing machine time, and when a service comes due.
 * Free of path aliases so the native Field Mode bundle can import it.
 */

export const MACHINE_LOG_KINDS = ["hours", "fuel", "maintenance", "repair", "other"] as const
export type MachineLogKind = (typeof MACHINE_LOG_KINDS)[number]

export const MACHINE_LOG_KIND_LABELS: { readonly [K in MachineLogKind]: string } = {
  hours: "Hours",
  fuel: "Fuel",
  maintenance: "Maintenance",
  repair: "Repair",
  other: "Other cost",
}

export const PAID_WITH_OPTIONS = ["Fuel card", "Vendor account", "Shop tank", "Company card", "Cash"] as const

export function isMachineLogKind(value: string): value is MachineLogKind {
  return MACHINE_LOG_KINDS.some((kind) => kind === value)
}

/** An entry as typed: numbers still text, money in dollars. */
export type MachineLogDraft = {
  readonly kind: MachineLogKind
  readonly machineId: string
  readonly entryDate: string
  readonly projectId: string
  readonly operatorName: string
  readonly costCode: string
  readonly runningHours: string
  readonly standbyHours: string
  readonly idleHours: string
  readonly hourMeter: string
  readonly gallons: string
  readonly amount: string
  readonly vendor: string
  readonly paidWith: string
  readonly serviceItemId: string
  readonly shopHours: string
  readonly notes: string
}

/** A checked entry, ready to save. */
export type MachineLogValues = {
  readonly kind: MachineLogKind
  readonly machineId: string
  readonly entryDate: string
  readonly projectId: string | null
  readonly operatorName: string | null
  readonly costCode: string | null
  readonly runningHours: number | null
  readonly standbyHours: number | null
  readonly idleHours: number | null
  readonly hourMeter: number | null
  readonly gallons: number | null
  readonly amountCents: number | null
  readonly vendor: string | null
  readonly paidWith: string | null
  readonly serviceItemId: string | null
  readonly shopHours: number | null
  readonly notes: string | null
}

export type MachineLogErrorKey = keyof MachineLogDraft | "hours"
export type MachineLogError = { readonly key: MachineLogErrorKey; readonly message: string }

export function emptyMachineLogDraft(kind: MachineLogKind, entryDate: string): MachineLogDraft {
  return {
    kind,
    machineId: "",
    entryDate,
    projectId: "",
    operatorName: "",
    costCode: "",
    runningHours: "",
    standbyHours: "",
    idleHours: "",
    hourMeter: "",
    gallons: "",
    amount: "",
    vendor: "",
    paidWith: "",
    serviceItemId: "",
    shopHours: "",
    notes: "",
  }
}

type NumberResult = { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly error: string }

/** A blank, or a number in range; rounded to `step` (0.25 for hours). */
function optionalNumber(value: string, label: string, max: number, step: number): NumberResult {
  const clean = value.trim().replace(/[$,\s]/g, "")
  if (!clean) return { ok: true, value: null }
  const parsed = Number(clean)
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, error: `Enter ${label} as a number.` }
  if (parsed > max) return { ok: false, error: `${capitalize(label)} can't be more than ${max.toLocaleString("en-US")}.` }
  // Round in whole steps, then to cents, so 18.4 stays 18.4 (not 18.400000000000002).
  return { ok: true, value: Math.round(Math.round(parsed / step) * step * 100) / 100 }
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function text(value: string): string | null {
  const clean = value.trim()
  return clean ? clean : null
}

/**
 * Every problem with an entry, in form order, and the cleaned values. What
 * is required depends on the kind: hours need a job and some hours; costs
 * need an amount; maintenance needs the service or a description.
 */
export function validateMachineLog(
  draft: MachineLogDraft,
): { readonly errors: readonly MachineLogError[]; readonly values: MachineLogValues | null } {
  const errors: MachineLogError[] = []
  if (!draft.machineId.trim()) errors.push({ key: "machineId", message: "Choose the machine." })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.entryDate.trim())) errors.push({ key: "entryDate", message: "Choose the date." })

  const number = (key: keyof MachineLogDraft, label: string, max: number, step: number): number | null => {
    const result = optionalNumber(draft[key], label, max, step)
    if (!result.ok) {
      errors.push({ key, message: result.error })
      return null
    }
    return result.value
  }

  const runningHours = number("runningHours", "running hours", 24, 0.25)
  const standbyHours = number("standbyHours", "standby hours", 24, 0.25)
  const idleHours = number("idleHours", "idle hours", 24, 0.25)
  const hourMeter = number("hourMeter", "the hour meter", 1_000_000, 0.1)
  const gallons = number("gallons", "gallons", 10_000, 0.01)
  const amount = number("amount", "the amount", 1_000_000, 0.01)
  const shopHours = number("shopHours", "shop hours", 24, 0.25)

  if (draft.kind === "hours") {
    if (!draft.projectId.trim()) errors.push({ key: "projectId", message: "Choose the job the machine worked on." })
    if (!runningHours && !standbyHours && !idleHours && !errors.some((error) => error.key.endsWith("Hours"))) {
      errors.push({ key: "hours", message: "Enter running, standby or idle hours." })
    }
  } else if (draft.kind === "maintenance" || draft.kind === "repair") {
    if (!draft.serviceItemId.trim() && !draft.notes.trim()) {
      errors.push({ key: "notes", message: draft.kind === "repair" ? "Describe the repair." : "Choose the service or describe what was done." })
    }
    if (amount === null && !shopHours && !errors.some((error) => error.key === "amount" || error.key === "shopHours")) {
      errors.push({ key: "amount", message: "Enter the cost or the shop hours." })
    }
  } else if (amount === null && !errors.some((error) => error.key === "amount")) {
    errors.push({ key: "amount", message: "Enter the total cost." })
  }
  if (draft.kind === "other" && !draft.notes.trim()) errors.push({ key: "notes", message: "Say what the cost was for." })

  if (errors.length > 0) return { errors, values: null }
  const isHours = draft.kind === "hours"
  const isCost = !isHours
  return {
    errors,
    values: {
      kind: draft.kind,
      machineId: draft.machineId.trim(),
      entryDate: draft.entryDate.trim(),
      projectId: text(draft.projectId),
      operatorName: isHours ? text(draft.operatorName) : null,
      costCode: isHours ? text(draft.costCode) : null,
      runningHours: isHours ? runningHours : null,
      standbyHours: isHours ? standbyHours : null,
      idleHours: isHours ? idleHours : null,
      hourMeter,
      gallons: draft.kind === "fuel" ? gallons : null,
      amountCents: isCost && amount !== null ? Math.round(amount * 100) : null,
      vendor: isCost ? text(draft.vendor) : null,
      paidWith: isCost ? text(draft.paidWith) : null,
      serviceItemId: draft.kind === "maintenance" ? text(draft.serviceItemId) : null,
      shopHours: draft.kind === "maintenance" || draft.kind === "repair" ? shopHours : null,
      notes: text(draft.notes),
    },
  }
}

export type MachineRates = {
  readonly runningRateCents: number | null
  readonly standbyRateCents: number | null
  readonly idleRateCents: number | null
}

/** What machine time charges a job: each kind of hour at its rate (unpriced hours count as $0). */
export function machineTimeChargeCents(
  hours: { readonly runningHours: number | null; readonly standbyHours: number | null; readonly idleHours: number | null },
  rates: MachineRates,
): number | null {
  const parts: [number | null, number | null][] = [
    [hours.runningHours, rates.runningRateCents],
    [hours.standbyHours, rates.standbyRateCents],
    [hours.idleHours, rates.idleRateCents],
  ]
  if (parts.every(([quantity, rate]) => !quantity || rate === null)) return null
  return Math.round(parts.reduce((sum, [quantity, rate]) => sum + (quantity ?? 0) * (rate ?? 0), 0))
}

export type ServiceDue = {
  /** Hours until due (negative when overdue); null when not on an hours interval. */
  readonly hoursLeft: number | null
  /** Days until due (negative when overdue); null when not on a days interval. */
  readonly daysLeft: number | null
  readonly state: "ok" | "soon" | "due"
}

/** Within this many hours or days, a service shows as coming up. */
export const SERVICE_SOON_HOURS = 10
export const SERVICE_SOON_DAYS = 7

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

/** When a service comes due, by hours, days, or whichever is sooner. */
export function serviceDue(
  item: { readonly everyHours: number | null; readonly everyDays: number | null; readonly lastDoneHours: number | null; readonly lastDoneOn: string | null },
  hourMeter: number | null,
  today: string,
): ServiceDue {
  const hoursLeft =
    item.everyHours !== null && hourMeter !== null ? (item.lastDoneHours ?? 0) + item.everyHours - hourMeter : null
  const daysLeft = item.everyDays !== null && item.lastDoneOn !== null ? item.everyDays - daysBetween(item.lastDoneOn, today) : null
  const due = (hoursLeft !== null && hoursLeft <= 0) || (daysLeft !== null && daysLeft <= 0)
  const soon = (hoursLeft !== null && hoursLeft <= SERVICE_SOON_HOURS) || (daysLeft !== null && daysLeft <= SERVICE_SOON_DAYS)
  return { hoursLeft, daysLeft, state: due ? "due" : soon ? "soon" : "ok" }
}

/** "Oil change in 3.5 h", "Grease overdue by 2 days". */
export function serviceDueLabel(name: string, due: ServiceDue): string {
  const parts: string[] = []
  if (due.hoursLeft !== null) {
    parts.push(due.hoursLeft <= 0 ? `overdue by ${formatNumber(-due.hoursLeft)} h` : `in ${formatNumber(due.hoursLeft)} h`)
  }
  if (due.daysLeft !== null) {
    parts.push(due.daysLeft <= 0 ? `overdue by ${-due.daysLeft} days` : `in ${due.daysLeft} days`)
  }
  return parts.length > 0 ? `${name} ${parts.join(" or ")}` : name
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}
