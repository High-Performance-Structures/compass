import { isDemoUser } from "@/lib/demo"
import type { AuthUser } from "@/lib/auth"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectAudienceViewer = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly avatarUrl: string | null
  readonly sidebarPhotoUrl: string | null
}

type ProjectAudienceViewerSource = Pick<
  AuthUser,
  | "id"
  | "displayName"
  | "email"
  | "avatarUrl"
  | "role"
  | "isActive"
  | "organizationId"
  | "organizationType"
>

export function toProjectAudienceViewer(
  user: ProjectAudienceViewerSource,
  viewerIsInternal: boolean,
  projectOrganizationId: string
): ProjectAudienceViewer {
  const canShareProfilePhoto =
    viewerIsInternal &&
    user.isActive &&
    user.organizationId === projectOrganizationId &&
    user.organizationType === "internal" &&
    isInternalStaffRole(user.role) &&
    !isDemoUser(user.id)

  return {
    id: user.id,
    name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
    email: user.email,
    avatarUrl: canShareProfilePhoto ? user.avatarUrl : null,
    sidebarPhotoUrl: null,
  }
}
