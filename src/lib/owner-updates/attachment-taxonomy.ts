export type OwnerUpdateAttachmentKind = "photo" | "document"

export function ownerUpdateAttachmentKind(
  attachmentId: string,
  selectedPhotoIds: ReadonlySet<string>,
  selectedDocumentIds: ReadonlySet<string>
): OwnerUpdateAttachmentKind | null {
  const isPhoto = selectedPhotoIds.has(attachmentId)
  const isDocument = selectedDocumentIds.has(attachmentId)
  if (isPhoto === isDocument) return null
  return isPhoto ? "photo" : "document"
}
