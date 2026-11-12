"use server"

import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
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

    const db = getDb(env.DB)
    const people = peopleView()
    const memberships = membershipsView()
    const rows = await db
      .select({
        id: people.id,
        displayName: people.displayName,
        firstName: people.firstName,
        lastName: people.lastName,
        email: people.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(people.isActive, true),
        ),
      )
      .orderBy(asc(people.displayName), asc(people.firstName), asc(people.email))

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
