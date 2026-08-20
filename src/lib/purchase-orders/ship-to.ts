export type PurchaseOrderShipToState = {
  readonly choice: "jobsite" | "pickup" | "other"
  readonly otherAddress: string
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function normalizedComparisonValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function isPickupValue(value: string): boolean {
  return normalizedComparisonValue(value) === "pickup"
}

function isJobsiteValue(value: string): boolean {
  return normalizedComparisonValue(value) === "jobsite"
}

export function initialPurchaseOrderShipToState({
  storedShipTo,
  jobsiteAddress,
}: {
  readonly storedShipTo: string | null
  readonly jobsiteAddress: string | null
}): PurchaseOrderShipToState {
  const savedValue = cleanText(storedShipTo)
  const jobsiteValue = cleanText(jobsiteAddress)

  if (savedValue === null) {
    return jobsiteValue === null
      ? { choice: "pickup", otherAddress: "" }
      : { choice: "jobsite", otherAddress: "" }
  }
  if (isPickupValue(savedValue)) return { choice: "pickup", otherAddress: "" }
  if (jobsiteValue !== null && isJobsiteValue(savedValue)) {
    return { choice: "jobsite", otherAddress: "" }
  }
  if (
    jobsiteValue !== null &&
    normalizedComparisonValue(savedValue) ===
      normalizedComparisonValue(jobsiteValue)
  ) {
    return { choice: "jobsite", otherAddress: "" }
  }
  return { choice: "other", otherAddress: savedValue }
}

export function purchaseOrderShipToValue({
  state,
  jobsiteAddress,
}: {
  readonly state: PurchaseOrderShipToState
  readonly jobsiteAddress: string | null
}): string | null {
  if (state.choice === "jobsite") return cleanText(jobsiteAddress)
  if (state.choice === "pickup") return "Pick-Up"
  return cleanText(state.otherAddress)
}

export function resolvedPurchaseOrderShipTo({
  storedShipTo,
  jobsiteAddress,
}: {
  readonly storedShipTo: string | null
  readonly jobsiteAddress: string | null
}): string | null {
  const savedValue = cleanText(storedShipTo)
  if (savedValue === null) return null
  if (!isJobsiteValue(savedValue)) return savedValue

  // Older imported POs may only say "Jobsite". Resolve that marker at output
  // time so printed and emailed copies contain an actionable street address.
  return cleanText(jobsiteAddress) ?? savedValue
}
