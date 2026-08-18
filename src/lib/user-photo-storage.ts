export function dashboardDeskPhotoStorageKey(
  userId: string,
  organizationId: string
): string {
  return `compass-desk-photo:${userId}:${organizationId}:dashboard`
}

export function sidebarDeskPhotoStorageKey(
  userId: string,
  organizationId: string
): string {
  return `compass-desk-photo:${userId}:${organizationId}:sidebar`
}

export const HIDDEN_DESK_PHOTO = "__hidden__"

export const DESK_PHOTO_SLOTS = ["dashboard", "sidebar"] as const
export type DeskPhotoSlot = (typeof DESK_PHOTO_SLOTS)[number]

export function workspacePhotoStateKey(input: {
  readonly userId: string
  readonly organizationId: string | null
  readonly slot: DeskPhotoSlot
  readonly canUseWorkspacePhotos: boolean
  readonly serverPhotoUrl: string | null
}): string {
  return [
    input.userId,
    input.organizationId ?? "none",
    input.slot,
    input.canUseWorkspacePhotos ? "authorized" : "unauthorized",
    input.serverPhotoUrl ?? "none",
  ].join(":")
}

export function authorizedWorkspacePhotoUrl(input: {
  readonly canUseWorkspacePhotos: boolean
  readonly currentScope: string
  readonly loadedScope: string | null
  readonly photoUrl: string | null
}): string | null {
  if (!input.canUseWorkspacePhotos) return null
  return input.loadedScope === input.currentScope ? input.photoUrl : null
}

export function isDeskPhotoSlot(value: string): value is DeskPhotoSlot {
  return value === DESK_PHOTO_SLOTS[0] || value === DESK_PHOTO_SLOTS[1]
}

const DESK_PHOTO_PATH = "/api/users/desk-photo"
const CONTROLLED_URL_ORIGIN = "https://compass.invalid"

export function controlledDeskPhotoUrl(
  slot: DeskPhotoSlot,
  fileId: string
): string {
  const params = new URLSearchParams({ slot, file: fileId })
  return `${DESK_PHOTO_PATH}?${params.toString()}`
}

export function parseControlledDeskPhoto(
  value: string | null,
  slot: DeskPhotoSlot
): { readonly fileId: string } | null {
  if (!value || !value.startsWith("/")) return null

  try {
    const parsed = new URL(value, CONTROLLED_URL_ORIGIN)
    if (
      parsed.origin !== CONTROLLED_URL_ORIGIN ||
      parsed.pathname !== DESK_PHOTO_PATH ||
      parsed.searchParams.get("slot") !== slot
    ) {
      return null
    }

    const fileId = parsed.searchParams.get("file")
    return fileId && /^[A-Za-z0-9_-]+$/.test(fileId) ? { fileId } : null
  } catch {
    return null
  }
}

export function parseImageDataUrl(
  value: string
): {
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp"
  readonly bytes: Uint8Array<ArrayBuffer>
} | null {
  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i
  )
  if (!match) return null

  const mimeType = match[1]?.toLowerCase()
  const encoded = match[2]
  if (
    (mimeType !== "image/jpeg" &&
      mimeType !== "image/png" &&
      mimeType !== "image/webp") ||
    !encoded
  ) {
    return null
  }

  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return { mimeType, bytes }
  } catch {
    return null
  }
}

export function isLegacyDeskPhotoValue(value: string | null): boolean {
  return value !== null && parseImageDataUrl(value) !== null
}
