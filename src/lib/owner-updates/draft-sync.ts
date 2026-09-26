import type { OwnerUpdateDraftEdit } from "@/lib/owner-updates/draft-recovery"

export type OwnerUpdateDraftSyncVersion = {
  readonly revision: number
  readonly updatedAt: string
}

export type OwnerUpdateDraftSyncResult =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "synchronized"
      readonly draft: OwnerUpdateDraftEdit
    }
  | {
      readonly kind: "conflict"
      readonly draft: OwnerUpdateDraftEdit
      readonly message: string
    }

function draftsEqual(
  left: OwnerUpdateDraftEdit,
  right: OwnerUpdateDraftEdit
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function versionsEqual(
  left: OwnerUpdateDraftSyncVersion,
  right: OwnerUpdateDraftSyncVersion
): boolean {
  return left.revision === right.revision && left.updatedAt === right.updatedAt
}

export function synchronizeOwnerUpdateDraft(input: {
  readonly baselineDraft: OwnerUpdateDraftEdit
  readonly localDraft: OwnerUpdateDraftEdit
  readonly serverDraft: OwnerUpdateDraftEdit
  readonly previousServerVersion: OwnerUpdateDraftSyncVersion
  readonly serverVersion: OwnerUpdateDraftSyncVersion
}): OwnerUpdateDraftSyncResult {
  if (versionsEqual(input.previousServerVersion, input.serverVersion)) {
    return { kind: "unchanged" }
  }

  if (draftsEqual(input.localDraft, input.baselineDraft)) {
    return { kind: "synchronized", draft: input.serverDraft }
  }

  if (draftsEqual(input.localDraft, input.serverDraft)) {
    return { kind: "synchronized", draft: input.serverDraft }
  }

  return {
    kind: "conflict",
    draft: input.serverDraft,
    message:
      "This draft changed elsewhere. Your unsaved edits were discarded; review the latest version before saving.",
  }
}
