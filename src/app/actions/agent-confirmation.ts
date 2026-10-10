"use server"

import { generateAgentToken } from "@/lib/agent/api-auth"
import { callAgentRoute } from "@/lib/agent/in-process-data-source"
import { verifyPendingAction } from "@/lib/agent/pending-actions"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"

/**
 * Carries out an action Jarvis proposed, after the signed-in user presses
 * Confirm in the chat. The token pins the exact action and data and the user
 * it was proposed to; the handler then re-checks that user's permissions as
 * it would for any agent call.
 */
export async function confirmAgentAction(
  confirmationToken: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user || !user.isActive || !user.organizationId) {
    return { success: false, error: "Please sign in again." }
  }

  const { env } = await getCloudflareContext()
  const secret = Reflect.get(env, "AGENT_AUTH_SECRET")
  if (typeof secret !== "string" || secret.length === 0) {
    return { success: false, error: "Jarvis is not configured." }
  }

  const pending = await verifyPendingAction(secret, confirmationToken)
  if (!pending) {
    return {
      success: false,
      error: "This confirmation has expired. Ask Jarvis again.",
    }
  }
  if (
    pending.userId !== user.id ||
    pending.organizationId !== user.organizationId
  ) {
    return {
      success: false,
      error: "This confirmation was for someone else.",
    }
  }

  try {
    const agentToken = await generateAgentToken(
      secret,
      user.id,
      user.organizationId,
      user.role,
      isDemoUser(user.id),
    )
    await callAgentRoute(agentToken, pending.path, pending.body)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "That change failed.",
    }
  }
}
