"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { setDevelopmentAccount } from "@/lib/domain/identity/development-accounts"
import { canManageUserAccess } from "@/lib/permissions"
import { orgContext } from "@/lib/server/action-context"

const input = z.object({
  userId: z.string().trim().min(1).max(200),
  developmentAccount: z.boolean(),
})

/**
 * An admin tags (or untags) a company member as a development account in
 * Settings → Team: someone who builds Compass rather than works for the
 * company. Their role and access stay as they are; they leave staff pickers,
 * staff counts and Sage employee linking. The change is logged to Activity.
 */
export async function setUserDevelopmentAccount(
  raw: z.input<typeof input>,
): Promise<ActionResult<{ readonly name: string }>> {
  try {
    const parsed = input.safeParse(raw)
    if (!parsed.success) return actionFailure("Invalid input")
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccess(user)) return actionFailure("Only admins can change development accounts")

    const result = await setDevelopmentAccount(db, { organizationId, ...parsed.data })
    if (!result.success) return result
    if (result.changed) {
      await recordActivityEvent({
        db, organizationId, actor: user,
        category: "account",
        action: parsed.data.developmentAccount ? "user.development_account_set" : "user.development_account_cleared",
        entityType: "user",
        entityId: parsed.data.userId,
        summary: parsed.data.developmentAccount
          ? `Marked ${result.name} as a development account (role and access unchanged).`
          : `Cleared the development account tag from ${result.name}.`,
      })
      revalidatePath("/dashboard/settings")
      revalidatePath("/dashboard/contacts")
    }
    return { success: true, data: { name: result.name } }
  } catch (error) {
    console.error("Failed to change development account", error)
    return actionFailure("Could not update this account.")
  }
}
