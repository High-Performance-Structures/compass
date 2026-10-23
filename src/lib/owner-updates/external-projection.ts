import { projectAudiencePhotoUrl } from "@/lib/photo-sources"

export type OwnerUpdateExternalPhotoInput = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
}

export type OwnerUpdateExternalPhoto = Omit<
  OwnerUpdateExternalPhotoInput,
  "driveFileId" | "driveUrl" | "thumbnailUrl"
> & {
  readonly driveFileId: null
  readonly driveUrl: null
  readonly thumbnailUrl: string
}

export type OwnerUpdateExternalDocumentInput = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly sourceSystem: string
}

export type OwnerUpdateExternalDocument = Omit<
  OwnerUpdateExternalDocumentInput,
  "driveFileId" | "driveUrl"
> & {
  readonly driveFileId: null
  readonly driveUrl: null
  readonly compassUrl: string
}

export function ownerUpdateExternalPhoto(
  projectId: string,
  photo: OwnerUpdateExternalPhotoInput
): OwnerUpdateExternalPhoto {
  return {
    id: photo.id,
    sourceSystem: photo.sourceSystem,
    fileName: photo.fileName,
    mimeType: photo.mimeType,
    driveFileId: null,
    driveUrl: null,
    thumbnailUrl: projectAudiencePhotoUrl(projectId, photo.id, "owner"),
    caption: photo.caption,
    capturedAt: photo.capturedAt,
    reviewStatus: photo.reviewStatus,
    ownerVisible: photo.ownerVisible,
  }
}

export function ownerUpdateExternalDocument(
  projectId: string,
  document: OwnerUpdateExternalDocumentInput
): OwnerUpdateExternalDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    driveFileId: null,
    driveUrl: null,
    compassUrl: projectAudiencePhotoUrl(projectId, document.id, "owner"),
    caption: document.caption,
    capturedAt: document.capturedAt,
    sourceSystem: document.sourceSystem,
  }
}
