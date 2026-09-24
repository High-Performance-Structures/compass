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
