import { withAuth, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  users,
  organizations,
  organizationMembers,
  projectAccessInvitations,
  projectContacts,
  projectMembers,
} from "@/db/schema"
import type { User } from "@/db/schema"
import { and, desc, eq, or, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { DEMO_USER } from "@/lib/demo"
import {
  isDemoSessionAllowed,
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import {
  isExternalProjectRole,
} from "@/lib/user-roles"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import { recordActivityEvent } from "@/lib/activity-log"

export type AuthUser = {
  readonly id: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly phone?: string | null
  readonly address?: string | null
  readonly avatarUrl: string | null
  readonly dashboardDeskPhotoUrl?: string | null
  readonly sidebarDeskPhotoUrl?: string | null
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
  dashboardDeskPhoto: string | null
  sidebarDeskPhoto: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  address: string | null
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
    dashboardDeskPhoto: user.dashboardDeskPhotoUrl ?? null,
    sidebarDeskPhoto: user.sidebarDeskPhotoUrl ?? null,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? null,
    address: user.address ?? null,
  }
}

function normalizedExternalProjectRole(role: string): string {
  return role === "owner" ? "client" : role
}

async function ensureExternalOrganizationMembership(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly userId: string
  readonly role: string
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, input.userId),
        eq(organizationMembers.organizationId, input.organizationId)
      )
    )
    .get()
  const role = normalizedExternalProjectRole(input.role)

  if (existing) {
    await input.db
      .update(organizationMembers)
      .set({ role })
      .where(eq(organizationMembers.id, existing.id))
      .run()
    return
  }

  await input.db
    .insert(organizationMembers)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role,
      joinedAt: input.now,
    })
    .run()
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
    // Cookies are not writable from every server-rendering context.
  }
}

async function claimProjectAccessInvitations(
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string,
  now: string
): Promise<{ readonly organizationId: string; readonly role: string } | null> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null

  const invitations = await db
    .select({
      id: projectAccessInvitations.id,
      organizationId: projectAccessInvitations.organizationId,
      projectId: projectAccessInvitations.projectId,
      projectContactId: projectAccessInvitations.projectContactId,
      role: projectAccessInvitations.role,
      invitedBy: projectAccessInvitations.invitedBy,
      workosExpiresAt: projectAccessInvitations.workosExpiresAt,
      contactPhone: projectContacts.phone,
      contactAddress: projectContacts.address,
    })
    .from(projectAccessInvitations)
    .leftJoin(
      projectContacts,
      eq(projectContacts.id, projectAccessInvitations.projectContactId)
    )
    .where(
      and(
        eq(projectAccessInvitations.status, "sent"),
        sql`lower(trim(${projectAccessInvitations.email})) = ${normalizedEmail}`
      )
    )
    .orderBy(desc(projectAccessInvitations.invitedAt))

  const currentIdentity = await db
    .select({ phone: users.phone, address: users.address })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  const identityInvitation = invitations.find(
    (invitation) =>
      (!invitation.workosExpiresAt || invitation.workosExpiresAt > now) &&
      (invitation.contactPhone || invitation.contactAddress)
  )
  if (
    currentIdentity &&
    identityInvitation &&
    ((!currentIdentity.phone && identityInvitation.contactPhone) ||
      (!currentIdentity.address && identityInvitation.contactAddress))
  ) {
    await db
      .update(users)
      .set({
        phone: currentIdentity.phone ?? identityInvitation.contactPhone,
        address: currentIdentity.address ?? identityInvitation.contactAddress,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .run()
  }

  let claimedInvitation: {
    readonly organizationId: string
    readonly role: string
  } | null = null
  for (const invitation of invitations) {
    if (
      invitation.workosExpiresAt &&
      invitation.workosExpiresAt <= now
    ) {
      await db
        .update(projectAccessInvitations)
        .set({ status: "expired", updatedAt: now })
        .where(eq(projectAccessInvitations.id, invitation.id))
        .run()
      continue
    }

    const organizationMembership = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, userId),
          eq(
            organizationMembers.organizationId,
            invitation.organizationId
          )
        )
      )
      .get()
    const preservedOrganizationRole =
      organizationMembership &&
      !isExternalProjectRole(organizationMembership.role)
        ? organizationMembership.role
        : null
    const assignedRole = preservedOrganizationRole ?? invitation.role

    if (
      isExternalProjectRole(invitation.role) &&
      !preservedOrganizationRole
    ) {
      await ensureExternalOrganizationMembership({
        db,
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        now,
      })
    }

    const projectMembership = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, invitation.projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .get()

    if (!projectMembership) {
      await db
        .insert(projectMembers)
        .values({
          id: crypto.randomUUID(),
          projectId: invitation.projectId,
          userId,
          role: assignedRole,
          assignedAt: now,
        })
        .run()
    } else {
      await db
        .update(projectMembers)
        .set({ role: assignedRole })
        .where(eq(projectMembers.id, projectMembership.id))
        .run()
    }

    const audience =
      invitation.role === "owner" || invitation.role === "client"
        ? "owner"
        : invitation.role === "subcontractor" ||
            invitation.role === "supplier"
          ? "sub_vendor"
          : null
    if (audience) {
      await ensureProjectAudienceConversation({
        db,
        projectId: invitation.projectId,
        organizationId: invitation.organizationId,
        audience,
        contactId:
          audience === "owner" ? null : invitation.projectContactId,
        externalUserId: userId,
        createdBy: invitation.invitedBy,
        now,
      })
    }

    await db
      .update(projectAccessInvitations)
      .set({
        status: "accepted",
        acceptedBy: userId,
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(projectAccessInvitations.id, invitation.id))
      .run()
    claimedInvitation ??= {
      organizationId: invitation.organizationId,
      role: assignedRole,
    }
  }

  return claimedInvitation
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) return null

      // check demo cookie when WorkOS isn't available
      try {
        const cookieStore = await cookies()
        const isDemoSession = isDemoSessionAllowed(
          cookieStore.get("compass-demo")?.value
        )
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
        dashboardDeskPhotoUrl: null,
        sidebarDeskPhotoUrl: null,
        role: "admin",
        googleEmail: null,
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        organizationId: "hps-org-001",
        organizationName: "HPS",
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
        const isDemoSession = isDemoSessionAllowed(
          cookieStore.get("compass-demo")?.value
        )
        if (isDemoSession) return DEMO_USER
      } catch {
        // cookies() may throw in non-request contexts
      }
      return null
    }

    // Stale demo cookies are cleared by middleware. Server Components cannot
    // mutate cookies, so real authentication always takes precedence here.

    const workosUser = session.user

    const { env } = await getCloudflareContext()
    if (!env?.DB) return null

    const db = getDb(env.DB)

    // check if user exists in our database
    let activatedPendingAccount = false
    let dbUser = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.id, workosUser.id),
          eq(users.workosUserId, workosUser.id)
        )
      )
      .get()

    if (!dbUser) {
      const emailMatch = await db
        .select()
        .from(users)
        .where(
          sql`lower(trim(${users.email})) = ${workosUser.email
            .trim()
            .toLowerCase()}`
        )
        .get()
      const isPendingPlaceholder =
        emailMatch !== undefined &&
        !emailMatch.isActive &&
        !emailMatch.id.startsWith("user_")
      if (emailMatch && (emailMatch.isActive || isPendingPlaceholder)) {
        await db
          .update(users)
          .set({
            firstName: workosUser.firstName ?? emailMatch.firstName,
            lastName: workosUser.lastName ?? emailMatch.lastName,
            displayName:
              workosUser.firstName && workosUser.lastName
                ? `${workosUser.firstName} ${workosUser.lastName}`
                : emailMatch.displayName,
            avatarUrl: workosUser.profilePictureUrl ?? emailMatch.avatarUrl,
            isActive: isPendingPlaceholder ? true : emailMatch.isActive,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, emailMatch.id))
          .run()
        activatedPendingAccount = isPendingPlaceholder
        dbUser = await db
          .select()
          .from(users)
          .where(eq(users.id, emailMatch.id))
          .get()
      }
    }

    // if user doesn't exist, create them with default role
    if (!dbUser) {
      dbUser = await ensureUserExists(workosUser)
    }

    // Backfill the Google/WorkOS profile image for older accounts while
    // preserving any avatar that was already chosen in Compass.
    if (!dbUser.avatarUrl && workosUser.profilePictureUrl) {
      await db
        .update(users)
        .set({
          avatarUrl: workosUser.profilePictureUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, dbUser.id))
        .run()
      dbUser = {
        ...dbUser,
        avatarUrl: workosUser.profilePictureUrl,
      }
    }

    // update last login timestamp
    const now = new Date().toISOString()
    const claimedInvitation = await claimProjectAccessInvitations(
      db,
      dbUser.id,
      dbUser.email,
      now
    )
    if (claimedInvitation) {
      await setActiveOrgCookie(claimedInvitation.organizationId)
    }
    await db
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, dbUser.id))
      .run()

    // query org memberships
    const orgMemberships = await db
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

    let activeOrg: {
      readonly orgId: string
      readonly orgName: string
      readonly orgType: string
      readonly memberRole: string
    } | null = null

    if (orgMemberships.length > 0) {
      // check for cookie preference
      try {
        const cookieStore = await cookies()
        const preferredOrg = cookieStore.get("compass-active-org")?.value
        const match = orgMemberships.find((m) => m.orgId === preferredOrg)
        activeOrg = match ?? orgMemberships[0]
      } catch {
        activeOrg = orgMemberships[0]
      }
    }

    const projectMembership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.userId, dbUser.id))
      .limit(1)
      .get()
    const hasInternalStaffOrganization = orgMemberships.some(
      (membership) =>
        membership.orgType === "internal" &&
        !isExternalProjectRole(membership.memberRole)
    )
    const effectiveRole =
      !hasInternalStaffOrganization &&
      projectMembership &&
      isExternalProjectRole(projectMembership.role)
        ? normalizedExternalProjectRole(projectMembership.role)
        : activeOrg?.memberRole ?? dbUser.role
    if (
      !hasInternalStaffOrganization &&
      projectMembership &&
      isExternalProjectRole(projectMembership.role)
    ) {
      activeOrg =
        orgMemberships.find(
          (membership) =>
            membership.orgType === "internal" &&
            isExternalProjectRole(membership.memberRole)
        ) ?? activeOrg
    }

    if (activatedPendingAccount && activeOrg) {
      await recordActivityEvent({
        db,
        organizationId: activeOrg.orgId,
        actor: {
          id: dbUser.id,
          email: dbUser.email,
          displayName: dbUser.displayName,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          role: effectiveRole,
        },
        category: "account",
        action: "account.activated",
        entityType: "user",
        entityId: dbUser.id,
        summary: "Activated their Compass account.",
      })
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      displayName: dbUser.displayName,
      phone: dbUser.phone,
      address: dbUser.address,
      avatarUrl: dbUser.avatarUrl,
      dashboardDeskPhotoUrl: dbUser.dashboardDeskPhotoUrl,
      sidebarDeskPhotoUrl: dbUser.sidebarDeskPhotoUrl,
      role: effectiveRole,
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
    .where(
      or(
        eq(users.id, workosUser.id),
        eq(users.workosUserId, workosUser.id)
      )
    )
    .get()

  if (existing) return existing

  const now = new Date().toISOString()
  const pendingInvitation = await db
    .select({
      role: projectAccessInvitations.role,
    })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.status, "sent"),
        sql`lower(trim(${projectAccessInvitations.email})) = ${workosUser.email
          .trim()
          .toLowerCase()}`,
        sql`(${projectAccessInvitations.workosExpiresAt} IS NULL OR ${projectAccessInvitations.workosExpiresAt} > ${now})`
      )
    )
    .orderBy(desc(projectAccessInvitations.invitedAt))
    .limit(1)
    .get()

  const newUser = {
    id: workosUser.id,
    workosUserId: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName ?? null,
    lastName: workosUser.lastName ?? null,
    displayName:
      workosUser.firstName && workosUser.lastName
        ? `${workosUser.firstName} ${workosUser.lastName}`
        : workosUser.email.split("@")[0],
    avatarUrl: workosUser.profilePictureUrl ?? null,
    // Project invitation roles remain project-scoped. The effective role is
    // derived from project_members after authentication.
    role: pendingInvitation ? "guest" : "office",
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(users).values(newUser).run()

  const claimedInvitation = await claimProjectAccessInvitations(
    db,
    workosUser.id,
    workosUser.email,
    now
  )
  if (claimedInvitation) {
    await setActiveOrgCookie(claimedInvitation.organizationId)
    return newUser as User
  }
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
