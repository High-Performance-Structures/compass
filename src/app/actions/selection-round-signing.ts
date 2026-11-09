"use server"

import { revalidatePath } from "next/cache"

import { recordActivityEvent } from "@/lib/activity-log"
import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { staffSelectionContext } from "@/lib/domain/selections/access"
import { loadRoundSigningView, prepareRoundSignature, type RoundSigner, type RoundSigningView } from "@/lib/domain/selections/round-signing"

/*
 * Owner signatures for selections rounds. Staff read the round document and
 * send it through Foxit e-sign (see src/lib/domain/selections/round-signing).
 * Foxit emails the signers, as for estimates and change orders; Compass logs
 * Activity here and announces the signed, declined or cancelled outcome from
 * the Foxit webhook.
 */

export async function getRoundSigning(projectId: string, roundKey: string): Promise<ActionResult<RoundSigningView>> {
  try {
    const { db, organizationId } = await staffSelectionContext(projectId, "read")
    const view = await loadRoundSigningView(db, projectId, organizationId, roundKey)
    return view ? { success: true, data: view } : actionFailure("Round not found.")
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load the round."))
  }
}

/**
 * Prepares the round for the owner's signature and returns Foxit's sending
 * session. Signers are emails chosen from the job's owner contacts.
 */
export async function sendRoundForSignature(
  projectId: string,
  roundKey: string,
  signerEmails: readonly string[],
): Promise<ActionResult<{ readonly embeddedSessionUrl: string }>> {
  try {
    const context = await staffSelectionContext(projectId, "update")
    const { db, env, organizationId, user } = context
    const view = await loadRoundSigningView(db, projectId, organizationId, roundKey)
    if (!view) return actionFailure("Round not found.")
    const wanted = new Set(signerEmails.map((email) => email.trim().toLocaleLowerCase()))
    const signers: RoundSigner[] = view.ownerContacts.filter((contact) => wanted.has(contact.email.toLocaleLowerCase()))
    if (signers.length !== wanted.size) return actionFailure("Signers must be the job's owner contacts with an email address.")
    const name = user.displayName?.trim() || user.email
    const prepared = await prepareRoundSignature({ db, env, projectId, organizationId, roundKey, signers, actor: { ...user, name } })
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "email",
      action: "selections_round_signature_prepared",
      entityType: "selection_round_signature",
      entityId: prepared.signatureId,
      summary: `${view.roundName} selections prepared for signature by ${signers.map((signer) => signer.name).join(", ")}.`,
      metadata: { roundKey, signers: signers.map((signer) => signer.email) },
    })
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    return { success: true, data: { embeddedSessionUrl: prepared.embeddedSessionUrl } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to prepare the signature."))
  }
}
