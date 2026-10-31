/**
 * Pure warranty claim rules: numbering and the lifecycle timestamps a status
 * change sets. No database or network access.
 */

/** `<project number>-W-001`, or `WARRANTY-001` for a job without a number. */
export function warrantyClaimNumber(projectNumber: string | null, existingCount: number): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  return projectNumber ? `${projectNumber}-W-${sequence}` : `WARRANTY-${sequence}`
}

/** The name recorded on a claim event: display name, else email. */
export function warrantyActorName(user: {
  readonly displayName?: string | null
  readonly email: string
}): string {
  return user.displayName?.trim() || user.email
}

export type WarrantyClaimTimestamps = {
  readonly acknowledgedAt: string | null
  readonly workStartedAt: string | null
  readonly resolvedAt: string | null
}

/**
 * Staff status change: leaving "submitted" acknowledges the claim, starting
 * work stamps it once, and resolved/closed keeps the first resolution time.
 * Moving back to submitted or an open status clears those stamps.
 */
export function staffClaimTimestamps(
  status: string,
  existing: WarrantyClaimTimestamps,
  now: string
): WarrantyClaimTimestamps {
  return {
    acknowledgedAt: status !== "submitted" ? existing.acknowledgedAt ?? now : null,
    workStartedAt: status === "in_progress" ? existing.workStartedAt ?? now : existing.workStartedAt,
    resolvedAt: status === "resolved" || status === "closed" ? existing.resolvedAt ?? now : null,
  }
}

/**
 * Vendor status change: any vendor update acknowledges the claim, in progress
 * or resolved means work has started, and only resolved keeps a resolution.
 */
export function vendorClaimTimestamps(
  status: string,
  existing: WarrantyClaimTimestamps,
  now: string
): WarrantyClaimTimestamps {
  return {
    acknowledgedAt: existing.acknowledgedAt ?? now,
    workStartedAt:
      status === "in_progress" || status === "resolved" ? existing.workStartedAt ?? now : existing.workStartedAt,
    resolvedAt: status === "resolved" ? existing.resolvedAt ?? now : null,
  }
}
