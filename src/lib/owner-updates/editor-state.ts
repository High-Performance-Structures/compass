export type OwnerUpdateEditorStatusKind =
  | "idle"
  | "saving"
  | "reconciling"
  | "saved"
  | "error"

export type OwnerUpdateVersion = {
  readonly revision: number
  readonly updatedAt: string
}

export function isOwnerUpdateEditorLocked(
  status: OwnerUpdateEditorStatusKind
): boolean {
  return status === "saving" || status === "reconciling"
}

export function isOwnerUpdateReconciled(
  expected: OwnerUpdateVersion,
  actual: OwnerUpdateVersion
): boolean {
  return (
    expected.revision === actual.revision &&
    expected.updatedAt === actual.updatedAt
  )
}
