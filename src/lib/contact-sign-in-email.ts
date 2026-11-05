/**
 * Staff may edit everything about a person who has accepted a Compass
 * invitation except the email they sign in with (owner decision 2026-11-04).
 * Dependency-free so client components can show the same note.
 */
export const SIGN_IN_EMAIL_LOCK = "This is their Compass sign-in email; they change it themselves."

/** True when the email differs, ignoring case and surrounding spaces. */
export function contactEmailChanged(
  currentEmail: string | null | undefined,
  nextEmail: string | null | undefined
): boolean {
  return (currentEmail?.trim().toLowerCase() ?? "") !== (nextEmail?.trim().toLowerCase() ?? "")
}
