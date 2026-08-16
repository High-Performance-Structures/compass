import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { organizations } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isInternalStaffRole } from "@/lib/user-roles"

const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 5000

type StaffBoardPostInput = {
  readonly title: string
  readonly body: string
}

type StaffBoardValidationResult =
  | { readonly success: true; readonly data: StaffBoardPostInput }
  | { readonly success: false; readonly error: string }

export function canAccessStaffBoard(
  role: string | null | undefined,
  isActive: boolean,
  organizationType: string | null | undefined
): boolean {
  if (
    !isActive ||
    organizationType !== "internal" ||
    role === null ||
    role === undefined
  ) {
    return false
  }
  return isInternalStaffRole(role)
}

export async function hasActiveStaffBoardOrganization(
  user: AuthUser
): Promise<boolean> {
  if (!canAccessStaffBoard(user.role, user.isActive, user.organizationType)) {
    return false
  }
  if (!user.organizationId) return false

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const organizationsFound = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, user.organizationId),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .limit(1)
  return organizationsFound.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function validateStaffBoardPost(
  input: unknown
): StaffBoardValidationResult {
  if (!isRecord(input)) {
    return { success: false, error: "Add a title and message." }
  }
  const candidate = input
  const title = typeof candidate.title === "string" ? candidate.title.trim() : ""
  const body = typeof candidate.body === "string" ? candidate.body.trim() : ""

  if (title.length === 0) return { success: false, error: "Add a title." }
  if (body.length === 0) return { success: false, error: "Add a message." }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      success: false,
      error: `Titles must be ${MAX_TITLE_LENGTH} characters or fewer.`,
    }
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      success: false,
      error: `Messages must be ${MAX_BODY_LENGTH.toLocaleString()} characters or fewer.`,
    }
  }

  return { success: true, data: { title, body } }
}
