"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectRfis, projects } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { isDemoUser } from "@/lib/demo"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectNumberAndName } from "@/lib/project-display-name"
import { rfiEmailText } from "@/lib/rfis/email"
import { requireUserContext } from "@/lib/server/action-context"

export type SendProjectRfiEmailInput = {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly message: string
}

export type SendProjectRfiEmailResult =
  | { readonly success: true; readonly sentTo: number }
  | { readonly success: false; readonly error: string }

function uniqueRecipients(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map(normalizeRecipientEmail))).filter(
    (email) => email.length > 0
  )
}

/**
 * Sends an RFI from Compass. Replies come back onto the RFI through its own
 * tracked address, so nobody has to remember to keep Compass copied.
 */
export async function sendProjectRfiEmail(
  projectId: string,
  rfiId: string,
  input: SendProjectRfiEmailInput
): Promise<SendProjectRfiEmailResult> {
  try {
    const { user, db, env } = await requireUserContext()
    if (isDemoUser(user.id)) return { success: false, error: "The demo is read-only." }
    await requireFeaturePermission(user, "rfis", "update")
    const organizationId = requireOrg(user)

    const to = uniqueRecipients(input.to)
    const toSet = new Set(to)
    const cc = uniqueRecipients(input.cc).filter((email) => !toSet.has(email))
    if (to.length === 0) return { success: false, error: "Choose at least one email recipient." }
    if (to.length + cc.length > 20) return { success: false, error: "Choose no more than 20 recipients." }
    const invalid = [...to, ...cc].find((email) => !isValidRecipientEmail(email))
    if (invalid) return { success: false, error: `${invalid} is not a valid email address.` }
    const subject = input.subject.trim()
    const message = input.message.trim()
    if (!subject || subject.length > 300) return { success: false, error: "Enter a subject." }
    if (message.length > 10_000) return { success: false, error: "The message is too long." }

    const project = await db
      .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!project) return { success: false, error: "Project not found." }
    const rfi = await db
      .select({
        id: projectRfis.id,
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        question: projectRfis.question,
        dueDate: projectRfis.dueDate,
      })
      .from(projectRfis)
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!rfi) return { success: false, error: "RFI not found." }

    const senderName = user.displayName?.trim() || user.email
    const delivery = await sendTrackedEmail({
      env,
      db,
      organizationId,
      projectId,
      kind: "rfi",
      recordId: rfi.id,
      recordLabel: rfi.rfiNumber,
      createdBy: user.id,
      to,
      cc,
      subject,
      replyName: `${senderName} - ${rfi.rfiNumber}`,
      alsoReplyTo: [user.email],
      text: rfiEmailText({
        projectLabel: project.projectNumber ? projectNumberAndName(project, " - ") : project.name,
        rfiNumber: rfi.rfiNumber,
        subject: rfi.subject,
        question: rfi.question,
        dueDate: rfi.dueDate,
        message,
        senderName,
      }),
    })
    if (delivery.status !== "sent") {
      return {
        success: false,
        error: `The RFI email was not sent: ${delivery.error ?? delivery.status}`,
      }
    }

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "email",
      action: "rfi_emailed",
      entityType: "project_rfi",
      entityId: rfi.id,
      summary: `Emailed ${rfi.rfiNumber} ${rfi.subject} to ${[...to, ...cc].join(", ")}.`,
      metadata: { recipients: to.length + cc.length, sentBy: activityActorName(user) },
    })
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    return { success: true, sentTo: to.length + cc.length }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to send the RFI email.",
    }
  }
}
