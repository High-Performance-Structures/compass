export const SAGE_SYNC_CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1000

type SageSyncClaimRun = {
  readonly status: string
  readonly claimToken: string | null
  readonly claimedAt: string | null
  readonly snapshotId: string | null
}

export type SageSyncClaimValidation =
  | { readonly success: true; readonly terminalReplay: boolean }
  | { readonly success: false; readonly error: string }

export function validateSageSyncClaim(
  run: SageSyncClaimRun,
  suppliedClaimToken: string,
  now = Date.now()
): SageSyncClaimValidation {
  if (run.claimToken !== suppliedClaimToken) {
    return {
      success: false,
      error: "Sage sync claim does not match this run.",
    }
  }
  if (run.status === "failed") {
    return {
      success: false,
      error: "Sage sync run is no longer active.",
    }
  }

  const terminalReplay =
    (run.status === "completed" || run.status === "needs_review") &&
    run.snapshotId !== null
  if (terminalReplay) return { success: true, terminalReplay: true }

  const claimedAt = run.claimedAt ? Date.parse(run.claimedAt) : Number.NaN
  if (
    run.status !== "running" ||
    !Number.isFinite(claimedAt) ||
    claimedAt > now ||
    now - claimedAt > SAGE_SYNC_CLAIM_LEASE_MILLISECONDS
  ) {
    return {
      success: false,
      error: "Sage sync claim is missing or expired.",
    }
  }
  return { success: true, terminalReplay: false }
}
