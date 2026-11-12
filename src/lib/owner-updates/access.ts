import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { companiesView } from "@/lib/domain/identity/views"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"

const companies = companiesView()

async function getActiveOrganizationDb(
  user: AuthUser,
  organizationError = "Permission denied: active organization is required"
): Promise<ReturnType<typeof getDb>> {
  if (!user.isActive) {
    throw new Error("Permission denied: active account is required")
  }
  if (!user.organizationId || !user.organizationType) {
    throw new Error("Permission denied: active organization is required")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [organization] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.id, user.organizationId),
        eq(companies.type, user.organizationType),
        eq(companies.isActive, true)
      )
    )
    .limit(1)

  if (!organization) {
    throw new Error(organizationError)
  }

  return db
}

export async function assertOwnerUpdateReadAccess(
  user: AuthUser
): Promise<ReturnType<typeof getDb>> {
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }

  return getActiveOrganizationDb(user)
}

export async function assertOwnerUpdateRouteAccess(
  user: AuthUser
): Promise<ReturnType<typeof getDb>> {
  if (
    !user.isActive ||
    !isInternalStaffRole(user.role) ||
    user.organizationType !== "internal" ||
    !user.organizationId
  ) {
    throw new Error("Permission denied: internal staff access is required")
  }

  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }

  return getActiveOrganizationDb(
    user,
    "Permission denied: active internal organization is required"
  )
}
