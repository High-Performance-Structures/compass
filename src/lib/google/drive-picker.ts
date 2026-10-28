export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

export type DrivePickerKind = "file" | "folder"

export type DrivePickerItem = {
  readonly id: string
  readonly name: string
  readonly kind: DrivePickerKind
  readonly mimeType: string
  readonly modifiedAt: string | null
  readonly url: string
}

export type DrivePickerLocation =
  | { readonly kind: "my" }
  | { readonly kind: "shared" }
  | { readonly kind: "folder"; readonly id: string }

export function driveItemUrl(id: string, kind: DrivePickerKind): string {
  return kind === "folder" ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`
}

/** Where a file chosen from the computer is uploaded before it's linked. */
export type DrivePickerDestination =
  | { readonly kind: "my" }
  | { readonly kind: "folder"; readonly id: string; readonly name: string }
  | { readonly kind: "project"; readonly projectId: string; readonly name: string }

/** The Drive id in a pasted link (file, Doc, Sheet, Slides or folder) or a bare id; null otherwise. */
export function driveIdFromInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  const fromPath = trimmed.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d|forms\/d|drive\/(?:u\/\d+\/)?folders|folders)\/([A-Za-z0-9_-]{10,})/)
  if (fromPath?.[1]) return fromPath[1]
  const fromQuery = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (fromQuery?.[1]) return fromQuery[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null
}

/** The new file's id from Drive's response to a finished browser upload. */
export function uploadedFileId(responseText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(responseText)
    return typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string" ? parsed.id : null
  } catch {
    return null
  }
}
