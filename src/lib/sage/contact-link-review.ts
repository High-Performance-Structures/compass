import type { SageContactKind } from "@/lib/sage/contact-change-proposal"
import type { SageContactEntityIdentity } from "@/lib/sage/contact-entity"

export type SageContactLinkLookup = {
  readonly kind: SageContactKind
  readonly entityId: string
  readonly sageRecordNumber: string
  readonly parentSageRecordId: string | null
}

export type SageContactLinkReadback = SageContactLinkLookup & {
  readonly sageRecordId: string
}

export const SAGE_LINK_CANDIDATE_MAX_AGE_MS = 15 * 60 * 1000

/** A completed lookup can be re-read without discarding its review history. */
export function sageLinkReadbackRefreshReason(input: {
  readonly kind: SageContactKind
  readonly status: string
  readonly completedAt: string | null
  readonly snapshotValid: boolean
  readonly sageIdentityName: string | null | undefined
}, now = Date.now()): "expired" | "invalid_readback" | "missing_employee_name" | null {
  if (input.status !== "awaiting_review") return null
  if (!input.snapshotValid) return "invalid_readback"
  if (input.kind === "employee" && !input.sageIdentityName?.trim()) return "missing_employee_name"
  const completed = input.completedAt ? Date.parse(input.completedAt) : Number.NaN
  return !Number.isFinite(completed) || completed > now ||
    now - completed > SAGE_LINK_CANDIDATE_MAX_AGE_MS ? "expired" : null
}

/** Self-review needs independent Sage name evidence, even when contact fields are blank. */
export function sageEmployeeNamesMatch(compassName: string, sageName: string | null | undefined): boolean {
  const normalized = (value: string): string => value.normalize("NFKC")
    .trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
  return Boolean(sageName?.trim()) && normalized(compassName) === normalized(sageName ?? "")
}

export function sageIdentityLinkReviewError(input: {
  readonly kind: SageContactKind
  readonly requesterIsReviewer: boolean
  readonly selfLinkAllowed: boolean
  readonly compassName: string | null
  readonly sageName: string | null | undefined
  readonly reviewNote: string
}): string | null {
  if (input.kind !== "employee") {
    return input.requesterIsReviewer ? "Self-review is limited to Sage employee identity links." : null
  }
  if (!input.sageName?.trim()) return "The Sage employee name was not returned. Refresh the Sage read-back; if the name is still blank, check the employee record in Sage."
  if (!input.compassName) return "Compass employee was not found."
  if (input.requesterIsReviewer) {
    if (!input.selfLinkAllowed) return "Self-linking requires the individual Sage employee self-review permission."
    return sageEmployeeNamesMatch(input.compassName, input.sageName)
      ? null : "Sage and Compass employee names do not match. A different reviewer must resolve the identity."
  }
  return sageEmployeeNamesMatch(input.compassName, input.sageName) || input.reviewNote.trim()
    ? null : "Sage and Compass employee names differ. Document the reviewed difference before linking."
}

export function sageContactReadClaimError(claim: {
  readonly purpose: string
  readonly kind: string
  readonly sageRecordId: string | null
  readonly sageRecordNumber: string | null
  readonly parentSageRecordId: string | null
}): string | null {
  if (claim.purpose === "refresh") {
    return claim.sageRecordId ? null : "A refresh requires a verified Sage record ID."
  }
  if (claim.purpose !== "link_candidate" || claim.sageRecordId ||
    !claim.sageRecordNumber || !/^[1-9]\d*$/.test(claim.sageRecordNumber) ||
    ((claim.kind === "client_person" || claim.kind === "vendor_person") &&
      !claim.parentSageRecordId)) {
    return "Sage link lookup has no exact number and parent identity."
  }
  return null
}

/** A lookup by number is only a candidate until an independent review. */
export function sageContactLinkCandidateError(
  identity: SageContactEntityIdentity,
  lookup: SageContactLinkLookup,
  readback: SageContactLinkReadback
): string | null {
  if (identity.sageRecordId) return "Directory contact already has a verified Sage ID."
  if (lookup.kind !== readback.kind || lookup.entityId !== readback.entityId ||
    lookup.sageRecordNumber !== readback.sageRecordNumber ||
    lookup.parentSageRecordId !== readback.parentSageRecordId ||
    !readback.sageRecordId.trim()) return "Sage read-back differs from the exact requested identity."
  if (identity.sageRecordNumber && identity.sageRecordNumber !== lookup.sageRecordNumber) {
    return "Directory Sage number changed since lookup."
  }
  if (identity.parentSageRecordId !== lookup.parentSageRecordId) {
    return "Directory Sage parent changed since lookup."
  }
  return null
}
