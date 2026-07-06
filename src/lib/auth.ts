import { withAuth, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  users,
  organizations,
  organizationMembers,
  projectContacts,
  projectMembers,
} from "@/db/schema"
import type { User } from "@/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { DEMO_USER } from "@/lib/demo"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

const INTERNAL_ORG_SLUG = "open-range"
const INTERNAL_STAFF_EMAIL_DOMAINS: readonly string[] = [
  "hps-colorado.com",
  "openrangeconstruction.ltd",
]

type OrganizationMembershipRecord = {
  readonly orgId: string
  readonly orgName: string
  readonly orgType: string
  readonly memberRole: string
}

export type AuthUser = {
  readonly id: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly role: string
  readonly googleEmail: string | null
  readonly isActive: boolean
  readonly lastLoginAt: string | null
  readonly organizationId: string | null
  readonly organizationName: string | null
  readonly organizationType: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * User data for sidebar/header display components
 */
export type SidebarUser = Readonly<{
  id: string
  name: string
  email: string
  avatar: string | null
  firstName: string | null
  lastName: string | null
}>

/**
 * Convert AuthUser to SidebarUser for UI components
 */
export function toSidebarUser(user: AuthUser): SidebarUser {
  return {
    id: user.id,
    name: user.displayName ?? user.email.split("@")[0] ?? "User",
    email: user.email,
    avatar: user.avatarUrl,
    firstName: user.firstName,
    lastName: user.lastName,
  }
}

function isInternalStaffEmail(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1] ?? ""
  return INTERNAL_STAFF_EMAIL_DOMAINS.includes(domain)
}

async function setActiveOrgCookie(orgId: string): Promise<void> {
  try {
    const cookieStore = await cookies()
    cookieStore.set("compass-active-org", orgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
  } catch {
    // cookies() may not be writable from every server context
  }
}

async function ensureInternalOrganizationMembership(
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string,
  now: string
): Promise<OrganizationMembershipRecord | null> {
  if (!isInternalStaffEmail(email)) return null

  const existingInternalMembership = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgType: organizations.type,
      memberRole: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId)
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizations.type, "internal")
      )
    )
    .get()

  if (existingInternalMembership) return existingInternalMembership

  const internalOrg = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.type,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.slug, INTERNAL_ORG_SLUG),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .get()

  if (!internalOrg) return null

  await db
    .insert(organizationMembers)
    .values({
      id: crypto.randomUUID(),
      organizationId: internalOrg.id,
      userId,
      role: "office",
      joinedAt: now,
    })
    .run()

  return {
    orgId: internalOrg.id,
    orgName: internalOrg.name,
    orgType: internalOrg.type,
    memberRole: "office",
  }
}

function projectRoleForContactType(contactType: string): string {
  if (contactType === "owner") return "owner"
  if (contactType === "subcontractor") return "subcontractor"
  if (contactType === "supplier") return "supplier"
  return "guest"
}

async function ensureProjectMembershipsFromContacts(
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string,
  now: string
): Promise<void> {
  if (isInternalStaffEmail(email)) return

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return

  const matchingContacts = await db
    .select({
      projectId: projectContacts.projectId,
      contactType: projectContacts.contactType,
    })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.active, true),
        sql`lower(trim(${projectContacts.email})) = ${normalizedEmail}`
      )
    )

  for (const contact of matchingContacts) {
    const existing = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, userId),
          eq(projectMembers.projectId, contact.projectId)
        )
      )
      .get()

    if (existing) continue

    await db
      .insert(projectMembers)
      .values({
        id: crypto.randomUUID(),
        projectId: contact.projectId,
        userId,
        role: projectRoleForContactType(contact.contactType),
        assignedAt: now,
      })
      .run()
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) return null

      // check demo cookie when WorkOS isn't available
      try {
        const cookieStore = await cookies()
        const isDemoSession =
          cookieStore.get("compass-demo")?.value === "true"
        if (isDemoSession) return DEMO_USER
      } catch {
        // cookies() may throw in non-request contexts
      }

      // return mock user for development
      return {
        id: "dev-user-1",
        email: "dev@compass.io",
        firstName: "Dev",
        lastName: "User",
        displayName: "Dev User",
        avatarUrl: null,
        role: "admin",
        googleEmail: null,
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        organizationId: "hps-org-001",
        organizationName: "High Performance Structures Inc.",
        organizationType: "internal",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }

    // WorkOS is configured -- try real auth first
    const session = await withAuth()

    if (!session || !session.user) {
      // no real session; fall back to demo cookie
      try {
        const cookieStore = await cookies()
        const isDemoSession =
          cookieStore.get("compass-demo")?.value === "true"
        if (isDemoSession) return DEMO_USER
      } catch {
        // cookies() may throw in non-request contexts
      }
      return null
    }

    // demo cookie cleanup handled by middleware (can't delete
    // cookies from Server Components -- only actions/routes)

    const workosUser = session.user

    const { env } = await getCloudflareContext()
    if (!env?.DB) return null

    const db = getDb(env.DB)

    // check if user exists in our database
    let dbUser = await db
      .select()
      .from(users)
      .where(eq(users.id, workosUser.id))
      .get()

    // if user doesn't exist, create them with default role
    if (!dbUser) {
      dbUser = await ensureUserExists(workosUser)
    }

    // update last login timestamp
    const now = new Date().toISOString()
    await db
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, workosUser.id))
      .run()

    // query org memberships
    let orgMemberships = await db
      .select({
        orgId: organizations.id,
        orgName: organizations.name,
        orgType: organizations.type,
        memberRole: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .where(eq(organizationMembers.userId, dbUser.id))

    const internalMembership = await ensureInternalOrganizationMembership(
      db,
      dbUser.id,
      dbUser.email,
      now
    )

    await ensureProjectMembershipsFromContacts(
      db,
      dbUser.id,
      dbUser.email,
      now
    )

    if (
      internalMembership &&
      !orgMemberships.some((membership) => membership.orgId === internalMembership.orgId)
    ) {
      orgMemberships = [internalMembership, ...orgMemberships]
    }

    let activeOrg: OrganizationMembershipRecord | null = null

    if (orgMemberships.length > 0) {
      // check for cookie preference
      try {
        const cookieStore = await cookies()
        const preferredOrg = cookieStore.get("compass-active-org")?.value
        const match = orgMemberships.find((m) => m.orgId === preferredOrg)
        const internalOrg = orgMemberships.find(
          (membership) => membership.orgType === "internal"
        )
        activeOrg =
          internalOrg && isInternalStaffEmail(dbUser.email)
            ? match?.orgType === "internal"
              ? match
              : internalOrg
            : match ?? orgMemberships[0]
      } catch {
        activeOrg =
          orgMemberships.find(
            (membership) =>
              membership.orgType === "internal" &&
              isInternalStaffEmail(dbUser.email)
          ) ?? orgMemberships[0]
      }
    }

    const resolvedRole =
      activeOrg?.orgType === "personal"
        ? dbUser.role
        : activeOrg?.memberRole ?? dbUser.role

    return {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: resolvedRole,
      googleEmail: dbUser.googleEmail ?? null,
      isActive: dbUser.isActive,
      lastLoginAt: now,
      organizationId: activeOrg?.orgId ?? null,
      organizationName: activeOrg?.orgName ?? null,
      organizationType: activeOrg?.orgType ?? null,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    }
  } catch (error) {
    console.error("Error getting current user:", error)
    return null
  }
}

export async function ensureUserExists(workosUser: {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
}): Promise<User> {
  const { env } = await getCloudflareContext()
  if (!env?.DB) {
    throw new Error("Database not available")
  }

  const db = getDb(env.DB)

  // Check if user already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, workosUser.id))
    .get()

  if (existing) return existing

  const now = new Date().toISOString()

  const newUser = {
    id: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName ?? null,
    lastName: workosUser.lastName ?? null,
    displayName:
      workosUser.firstName && workosUser.lastName
        ? `${workosUser.firstName} ${workosUser.lastName}`
        : workosUser.email.split("@")[0],
    avatarUrl: workosUser.profilePictureUrl ?? null,
    role: isInternalStaffEmail(workosUser.email) ? "office" : "client",
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(users).values(newUser).run()

  const internalMembership = await ensureInternalOrganizationMembership(
    db,
    workosUser.id,
    workosUser.email,
    now
  )

  if (internalMembership) {
    await setActiveOrgCookie(internalMembership.orgId)
    return newUser as User
  }

  await ensureProjectMembershipsFromContacts(
    db,
    workosUser.id,
    workosUser.email,
    now
  )

  // create personal org
  const personalOrgId = crypto.randomUUID()
  const personalSlug = `${workosUser.id.slice(0, 8)}-personal`

  await db
    .insert(organizations)
    .values({
      id: personalOrgId,
      name: `${workosUser.firstName ?? "User"}'s Workspace`,
      slug: personalSlug,
      type: "personal",
      logoUrl: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  // add user as admin member
  await db
    .insert(organizationMembers)
    .values({
      id: crypto.randomUUID(),
      organizationId: personalOrgId,
      userId: workosUser.id,
      role: "admin",
      joinedAt: now,
    })
    .run()

  await setActiveOrgCookie(personalOrgId)

  return newUser as User
}

export async function handleSignOut() {
  await signOut()
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}

export async function requireEmailVerified(): Promise<AuthUser> {
  const user = await requireAuth()

  if (isWorkOSConfigured()) {
    const session = await withAuth()
    if (session?.user && !session.user.emailVerified) {
      throw new Error("Email not verified")
    }
  }

  return user
}
