"use server"

import { revalidatePath } from "next/cache"

import { recordActivityEvent } from "@/lib/activity-log"
import {
  isImportedShareAudience,
  planImportedThreadShare,
  shareImportedThread,
  type ImportedSharePerson,
} from "@/lib/domain/conversations/imported-sharing"
import { orgContext } from "@/lib/server/action-context"

/*
 * Staff open a staff-only imported (Buildertrend) conversation to its owner or
 * vendor audience once its people are confirmed. Projects marked staff-only
 * (legal hold) refuse. No notification or email is sent.
 */

type ShareResult =
  | { readonly success: true; readonly people: readonly ImportedSharePerson[] }
  | { readonly success: false; readonly error: string }

/** Who would get access; shown in the confirm dialog. */
export async function previewImportedConversationShare(channelId: string, audience: string): Promise<ShareResult> {
  if (!isImportedShareAudience(audience)) return { success: false, error: "Choose owner or vendor." }
  const context = await orgContext()
  if (!context.success) return { success: false, error: context.error }
  const { db, organizationId, user } = context.data
  const plan = await planImportedThreadShare({ db, channelId, organizationId, actorRole: user.role, audience })
  return plan.ok ? { success: true, people: plan.people } : { success: false, error: plan.error }
}

export async function shareImportedConversation(channelId: string, audience: string): Promise<ShareResult> {
  if (!isImportedShareAudience(audience)) return { success: false, error: "Choose owner or vendor." }
  const context = await orgContext({ mutation: true })
  if (!context.success) return { success: false, error: context.error }
  const { db, organizationId, user } = context.data
  const result = await shareImportedThread({ db, channelId, organizationId, actorRole: user.role, audience, now: new Date().toISOString() })
  if (!result.ok) return { success: false, error: result.error }
  await recordActivityEvent({
    db,
    organizationId,
    projectId: result.projectId,
    actor: user,
    category: "conversation",
    action: "conversation.imported_shared",
    entityType: "channel",
    entityId: result.channelId,
    summary: `Shared imported conversation ${result.channelName} with ${audience === "clients" ? "the owner" : "the vendor"}.`,
    metadata: { audience, people: result.people.length },
  })
  revalidatePath(`/dashboard/conversations/${channelId}`)
  return { success: true, people: result.people }
}
