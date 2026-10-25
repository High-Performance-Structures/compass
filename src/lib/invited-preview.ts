/**
 * Staff can preview someone invited to a project who hasn't accepted yet.
 * They have no user record, so the preview stands in for them with this id,
 * which no real account can have.
 */
const INVITED_PREVIEW_PREFIX = "invite:"

export function invitedPreviewId(invitationId: string): string {
  return `${INVITED_PREVIEW_PREFIX}${invitationId}`
}

export function isInvitedPreviewId(id: string): boolean {
  return id.startsWith(INVITED_PREVIEW_PREFIX)
}

/** The invitation behind an invited-preview id, or null for a real account. */
export function invitedPreviewInvitationId(id: string): string | null {
  return isInvitedPreviewId(id) ? id.slice(INVITED_PREVIEW_PREFIX.length) : null
}
