import { isInternalStaffRole } from "@/lib/user-roles"

export type WorkspacePhotoActor = Readonly<{
  userId: string
  organizationId: string | null
  organizationType: string | null
  role: string
  isActive: boolean
  isDemo: boolean
}>

export type WorkspacePhotoOwner = Readonly<{
  userId: string
  organizationId: string
}>

type WorkspacePhotoAccessInput = Readonly<{
  actor: WorkspacePhotoActor
  photo: WorkspacePhotoOwner
}>

type WorkspacePhotoResolutionInput = Readonly<{
  durablePhoto: string | null
  cachedPhoto: string | null
  allowCache: boolean
}>

export const WORKSPACE_PHOTO_REMOVED = "__hidden__"

export function canManageWorkspacePhoto(
  input: WorkspacePhotoAccessInput
): boolean {
  return (
    !input.actor.isDemo &&
    input.actor.isActive &&
    input.actor.organizationId !== null &&
    input.actor.organizationType === "internal" &&
    isInternalStaffRole(input.actor.role) &&
    input.actor.userId === input.photo.userId &&
    input.actor.organizationId === input.photo.organizationId
  )
}

export function resolveWorkspacePhoto(
  input: WorkspacePhotoResolutionInput
): string | null {
  if (input.durablePhoto === WORKSPACE_PHOTO_REMOVED) return null
  if (input.durablePhoto) return input.durablePhoto
  if (input.allowCache && input.cachedPhoto !== WORKSPACE_PHOTO_REMOVED) {
    return input.cachedPhoto
  }
  return null
}
