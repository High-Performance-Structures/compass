/*
 * Google domain-wide delegation during View as. The service account can act
 * as any Workspace user; acting as the viewed person would open their own My
 * Drive (and their mailbox), which View as must not show, just as it never
 * shows their Gmail or Google Calendar. So while viewing, a delegated token
 * for the viewed person's own Google identity is refused. Compass-owned
 * identities (the correspondence Drive user, the Jarvis mailbox, shared
 * drives reached through them) are unaffected.
 *
 * Called from createServiceAccountJWT (src/lib/google/auth/service-account.ts)
 * and before the Drive token cache. The viewed person's emails come from the
 * verified session (they are recorded in the signed token at start).
 */
import { getViewAsState } from "@/lib/auth"
import { ViewAsReadOnlyError } from "@/lib/view-as/errors"
import { isViewAsRequest } from "@/lib/view-as/request"

/** Pure rule, for tests: is `subject` one of the viewed person's own emails? */
export function isViewedPersonSubject(subject: string, viewedEmails: readonly string[]): boolean {
  const target = subject.trim().toLowerCase()
  return target !== "" && viewedEmails.includes(target)
}

export async function assertDelegationAllowed(subject: string): Promise<void> {
  if (!(await isViewAsRequest())) return
  const state = await getViewAsState()
  // A session that is no longer valid gets no delegated access at all.
  if (state.kind !== "active") throw new ViewAsReadOnlyError("Google access")
  if (isViewedPersonSubject(subject, state.payload.targetEmails)) {
    throw new ViewAsReadOnlyError("the person's own Google Drive and mailbox are not shown")
  }
}
