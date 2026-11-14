/*
 * Google domain-wide delegation during View as. The service account can act
 * as any Workspace user; acting as the viewed person would open their own My
 * Drive (and their mailbox), which View as must not show, just as it never
 * shows their Gmail or Google Calendar. So while viewing, a delegated token
 * for the viewed person's own Google identity is refused. Compass-owned
 * identities (the correspondence Drive user, the Jarvis mailbox, shared
 * drives reached through them) are unaffected.
 *
 * Called from createServiceAccountJWT (src/lib/google/auth/service-account.ts),
 * the one place every delegated Drive, Sheets and Gmail token starts.
 */
import { isViewAsRequest } from "@/lib/view-as/request"
import { ViewAsReadOnlyError } from "@/lib/view-as/write-guard"

function normalized(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase()
  return value ? value : null
}

/** Pure rule, for tests: may a token be minted for `subject` while viewing these identities? */
export function isViewedPersonSubject(subject: string, viewed: { readonly email: string; readonly googleEmail: string | null }): boolean {
  const target = normalized(subject)
  return target !== null && (target === normalized(viewed.email) || target === normalized(viewed.googleEmail))
}

export async function assertDelegationAllowed(subject: string): Promise<void> {
  if (!(await isViewAsRequest())) return
  // Loaded on use: auth reaches Google code, so a static import would cycle.
  const { getViewAsState } = await import("@/lib/auth")
  const state = await getViewAsState()
  // A session that is no longer valid gets no delegated access at all.
  if (state.kind !== "active") throw new ViewAsReadOnlyError("Google access")
  if (isViewedPersonSubject(subject, state.target)) {
    throw new ViewAsReadOnlyError("the person's own Google Drive and mailbox are not shown")
  }
}
