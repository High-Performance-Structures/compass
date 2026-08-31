"use server"

import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { canUseFieldDesk } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export type CherishRecipientOption = {
  readonly id: string
  readonly name: string
}

type RecipientResult =
  | {
      readonly success: true
      readonly data: readonly CherishRecipientOption[]
    }
  | { readonly success: false; readonly error: string }

export async function getCherishRecipientOptions(): Promise<RecipientResult> {
  try {
    const user = await requireAuth()
    if (!canUseFieldDesk(user)) {
      return {
        success: false,
        error: "Only internal team members can choose CHERISH recipients.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const rows = await getDb(env.DB)
      .select({
        id: users.id,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.firstName), asc(users.email))

    return {
      success: true,
      data: rows.flatMap((row) => {
        if (!isInternalStaffRole(row.role)) return []
        return [{ id: row.id, name: recipientName(row) }]
      }),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load CHERISH recipients.",
    }
  }
}

function recipientName(row: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  const displayName = row.displayName?.trim()
  if (displayName) return displayName

  const fullName = `${row.firstName?.trim() ?? ""} ${row.lastName?.trim() ?? ""}`.trim()
  return fullName || row.email
}
