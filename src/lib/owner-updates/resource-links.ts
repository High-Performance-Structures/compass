export function ownerUpdateDocumentHref(input: {
  readonly projectId: string
  readonly photoId: string
  readonly viewerIsInternal: boolean
  readonly driveFileId: string | null
  readonly driveUrl: string | null
}): string {
  const path = `/api/projects/${encodeURIComponent(input.projectId)}/photos/${encodeURIComponent(input.photoId)}`
  return input.viewerIsInternal ? path : `${path}?audience=owner`
}
