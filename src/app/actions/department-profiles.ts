"use server"

import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { COMPASS_GMAIL_SEND_SCOPE, getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { isProjectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/** Plain-language reason Google refused to let Compass send as a mailbox. */
function mailboxProblem(message: string, address: string): string {
  if (/Invalid email or User ID/i.test(message)) {
    return `Google doesn't know ${address} as a mailbox in your Workspace. If it is an alias or a group, make it a user mailbox; if it belongs to another email provider, choose a Workspace mailbox instead.`
  }
  if (/unauthorized_client/i.test(message)) {
    return "Compass's Google connection isn't allowed to send email. In the Google Admin console, add the Gmail send scope (https://www.googleapis.com/auth/gmail.send) to Compass's domain-wide delegation."
  }
  if (/not connected/i.test(message)) return message
  return `Google refused: ${message}`
}

/**
 * Check that Compass may send as a department's saved mailbox: asks Google
 * for a send-only token for it. Nothing is sent or read.
 */
export async function checkDepartmentSendingMailbox(department: string): Promise<Result<{ readonly address: string }>> {
  try {
    if (!isProjectDepartment(department)) return { success: false, error: "Unknown department." }
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role)) return { success: false, error: "Available to office staff." }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const address = (await readDepartmentProfiles(db, user.organizationId))[department].senderAddress
    if (!address) return { success: false, error: "Enter and save this department's sending mailbox first." }
    try {
      const access = await getCompassGmailAccessToken({
        env,
        db,
        organizationId: user.organizationId,
        scopes: [COMPASS_GMAIL_SEND_SCOPE],
        sender: address,
      })
      if (!access.success) return { success: false, error: mailboxProblem(access.error, address) }
    } catch (error) {
      return { success: false, error: mailboxProblem(error instanceof Error ? error.message : String(error), address) }
    }
    return { success: true, data: { address } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to check the mailbox." }
  }
}
