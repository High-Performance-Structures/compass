import { cache } from "react"
import { withAuth } from "@workos-inc/authkit-nextjs"
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
import { and, desc, eq, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { DEMO_USER } from "@/lib/demo"
import { insertProjectMember, updateProjectMembers } from "@/lib/domain/project/store"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import {
  isExternalProjectRole,
} from "@/lib/user-roles"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import { recordActivityEvent } from "@/lib/activity-log"
import { ensureInternalContactForStaff } from "@/lib/internal-contact-provisioning"
import { externalOrganizationRole as normalizedExternalProjectRole } from "@/lib/domain/identity/rules"
import {
  ensureExternalOrganizationMembership,
  insertOrganizationMember,
  insertUser,
  markProjectAccessInvitationAccepted,
  markProjectAccessInvitationExpired,
  updateUser,
} from "@/lib/domain/identity/store"

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

function normalizedEmailAddress(email: string): string {
  return email.trim().toLowerCase()
}

function pendingInvitationsQuery(
  db: ReturnType<typeof getDb>,
  normalizedEmail: string
) {
  return db
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
}

type PendingInvitation = Awaited<
  ReturnType<typeof pendingInvitationsQuery>
>[number]

function organizationMembershipsQuery(
  db: ReturnType<typeof getDb>,
  userId: string
) {
  return db
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
    .where(eq(organizationMembers.userId, userId))
}

function firstProjectMembershipQuery(
  db: ReturnType<typeof getDb>,
  userId: string
) {
  return db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
    .limit(1)
}

/** Looks up and claims an account's pending invitations (sign-in callbacks). */
async function claimInvitationsForAccount(
  db: ReturnType<typeof getDb>,
  account: {
    readonly id: string
    readonly email: string
    readonly phone: string | null
    readonly address: string | null
  },
  now: string
): Promise<{ readonly organizationId: string; readonly role: string } | null> {
  const email = normalizedEmailAddress(account.email)
  if (!email) return null
  const invitations = await pendingInvitationsQuery(db, email)
  return claimProjectAccessInvitations(db, account, invitations, now)
}

async function claimProjectAccessInvitations(
  db: ReturnType<typeof getDb>,
  currentIdentity: {
    readonly id: string
    readonly phone: string | null
    readonly address: string | null
  },
  invitations: readonly PendingInvitation[],
  now: string
): Promise<{ readonly organizationId: string; readonly role: string } | null> {
  // Nearly every request has nothing pending; skip all further work.
  if (invitations.length === 0) return null
  const userId = currentIdentity.id

  const identityInvitation = invitations.find(
    (invitation) =>
      (!invitation.workosExpiresAt || invitation.workosExpiresAt > now) &&
      (invitation.contactPhone || invitation.contactAddress)
  )
  if (
    identityInvitation &&
    ((!currentIdentity.phone && identityInvitation.contactPhone) ||
      (!currentIdentity.address && identityInvitation.contactAddress))
  ) {
    await updateUser(db, userId, {
      phone: currentIdentity.phone ?? identityInvitation.contactPhone,
      address: currentIdentity.address ?? identityInvitation.contactAddress,
      updatedAt: now,
    })
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
      await markProjectAccessInvitationExpired(db, invitation.id, now)
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
      await ensureExternalOrganizationMembership(db, {
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
      await insertProjectMember(db, {
        id: crypto.randomUUID(),
        projectId: invitation.projectId,
        userId,
        role: assignedRole,
        assignedAt: now,
      })
    } else {
      await updateProjectMembers(db, eq(projectMembers.id, projectMembership.id), { role: assignedRole })
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

    await markProjectAccessInvitationAccepted(db, invitation.id, userId, now)
    claimedInvitation ??= {
      organizationId: invitation.organizationId,
      role: assignedRole,
    }
  }

  return claimedInvitation
}

const LAST_LOGIN_WRITE_INTERVAL_MS = 15 * 60 * 1000

export function lastLoginIsStale(lastLoginAt: string | null, now: string): boolean {
  if (!lastLoginAt) return true
  const previous = Date.parse(lastLoginAt)
  return (
    !Number.isFinite(previous) ||
    Date.parse(now) - previous >= LAST_LOGIN_WRITE_INTERVAL_MS
  )
}

/**
 * Layouts, pages, and their helpers each resolve the current user, often
 * several times per request. Memoize per request; the key includes the
 * cookies that select the active organization or demo session so switching
 * either within a request never returns a stale identity.
 */
const loadCurrentUserForRequest = cache(
  (cookieKey: string): Promise<AuthUser | null> => {
    void cookieKey // Only distinguishes cache entries.
    return loadCurrentUser()
  }
)

export async function getCurrentUser(): Promise<AuthUser | null> {
  let activeOrg: string | null = null
  let demoSession: string | null = null
  try {
    const cookieStore = await cookies()
    activeOrg = cookieStore.get("compass-active-org")?.value ?? null
    demoSession = cookieStore.get("compass-demo")?.value ?? null
  } catch {
    // cookies() may throw in non-request contexts
  }
  return loadCurrentUserForRequest(JSON.stringify([activeOrg, demoSession]))
}

async function loadCurrentUser(): Promise<AuthUser | null> {
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

    // No anonymous demo session once WorkOS is configured: a demo cookie
    // must never stand in for a real sign-in.
    if (!session || !session.user) return null

    const workosUser = session.user

    const { env } = await getCloudflareContext()
    if (!env?.DB) return null

    const db = getDb(env.DB)

    // Every signed-in request needs these four reads; send them in one D1
    // round trip instead of one after another. They are keyed on the
    // WorkOS id and email, which match the Compass account for every
    // established user. First sign-ins and reconciled accounts re-read
    // whatever the prefetch could not cover below.
    const workosEmail = normalizedEmailAddress(workosUser.email)
    const [
      userRows,
      prefetchedInvitations,
      prefetchedMemberships,
      prefetchedProjectMemberships,
    ] = await db.batch([
      db.select().from(users).where(eq(users.id, workosUser.id)).limit(1),
      pendingInvitationsQuery(db, workosEmail),
      organizationMembershipsQuery(db, workosUser.id),
      firstProjectMembershipQuery(db, workosUser.id),
    ])

    let activatedPendingAccount = false
    let dbUser: User | undefined = userRows[0]
    const foundByWorkosId = dbUser !== undefined

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
        emailMatch.lastLoginAt === null &&
        !emailMatch.id.startsWith("user_")
      if (emailMatch && (emailMatch.isActive || isPendingPlaceholder)) {
        await updateUser(db, emailMatch.id, {
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
      await updateUser(db, dbUser.id, {
        avatarUrl: workosUser.profilePictureUrl,
        updatedAt: new Date().toISOString(),
      })
      dbUser = {
        ...dbUser,
        avatarUrl: workosUser.profilePictureUrl,
      }
    }

    // update last login timestamp
    const now = new Date().toISOString()
    const accountEmail = normalizedEmailAddress(dbUser.email)
    const invitations =
      foundByWorkosId && accountEmail === workosEmail
        ? prefetchedInvitations
        : accountEmail
          ? await pendingInvitationsQuery(db, accountEmail)
          : []
    const claimedInvitation = await claimProjectAccessInvitations(
      db,
      dbUser,
      invitations,
      now
    )
    if (claimedInvitation) {
      await setActiveOrgCookie(claimedInvitation.organizationId)
    }
    // Recording activity on every request added a D1 write to each render.
    if (lastLoginIsStale(dbUser.lastLoginAt, now)) {
      await updateUser(db, dbUser.id, { lastLoginAt: now })
    }

    // A claimed invitation or a newly found/created account can change
    // memberships after the prefetch, so read them again in that case.
    const membershipsAreCurrent = foundByWorkosId && !claimedInvitation
    const [orgMemberships, projectMemberships] = membershipsAreCurrent
      ? [prefetchedMemberships, prefetchedProjectMemberships]
      : await db.batch([
          organizationMembershipsQuery(db, dbUser.id),
          firstProjectMembershipQuery(db, dbUser.id),
        ])

    if (activatedPendingAccount) {
      for (const membership of orgMemberships) {
        if (membership.orgType !== "internal") continue
        await ensureInternalContactForStaff(db, {
          organizationId: membership.orgId,
          userId: dbUser.id,
          role: membership.memberRole,
          name: dbUser.displayName ?? dbUser.email,
          email: dbUser.email,
          phone: dbUser.phone,
        })
      }
    }

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

    const projectMembership = projectMemberships[0]
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
  const now = new Date().toISOString()
  const normalizedEmail = workosUser.email.trim().toLowerCase()

  // Check if user already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, workosUser.id))
    .get()

  if (existing) {
    // Existing vendors may receive another project invitation between sign-ins.
    // Claim it in the single auth callback request so the first redirected page
    // does not race multiple server-component auth reads to provision access.
    const now = new Date().toISOString()
    const claimedInvitation = await claimInvitationsForAccount(
      db,
      existing,
      now
    )
    if (claimedInvitation) {
      await setActiveOrgCookie(claimedInvitation.organizationId)
    }
    return existing
  }

  // Imported and invited accounts may predate their WorkOS user ID. Preserve
  // the local primary key (and every membership that references it), then
  // reconcile the authenticated identity by normalized email.
  const emailMatch = await db
    .select()
    .from(users)
    .where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
    .get()
  if (emailMatch) {
    const isPendingPlaceholder =
      !emailMatch.isActive &&
      emailMatch.lastLoginAt === null &&
      !emailMatch.id.startsWith("user_")
    if (!emailMatch.isActive && !isPendingPlaceholder) {
      throw new Error(
        "This Compass account is inactive. Ask an administrator to restore access."
      )
    }

    const workosDisplayName = [workosUser.firstName, workosUser.lastName]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ")
    const reconciledUser: User = {
      ...emailMatch,
      email: normalizedEmail,
      firstName: workosUser.firstName ?? emailMatch.firstName,
      lastName: workosUser.lastName ?? emailMatch.lastName,
      displayName: workosDisplayName || emailMatch.displayName,
      avatarUrl: workosUser.profilePictureUrl ?? emailMatch.avatarUrl,
      isActive: true,
      lastLoginAt: now,
      updatedAt: now,
    }
    await updateUser(db, emailMatch.id, {
      email: reconciledUser.email,
      firstName: reconciledUser.firstName,
      lastName: reconciledUser.lastName,
      displayName: reconciledUser.displayName,
      avatarUrl: reconciledUser.avatarUrl,
      isActive: reconciledUser.isActive,
      lastLoginAt: reconciledUser.lastLoginAt,
      updatedAt: reconciledUser.updatedAt,
    })

    const claimedInvitation = await claimInvitationsForAccount(
      db,
      reconciledUser,
      now
    )
    if (claimedInvitation) {
      await setActiveOrgCookie(claimedInvitation.organizationId)
    }
    return reconciledUser
  }

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

  const newUser: typeof users.$inferInsert = {
    id: workosUser.id,
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

  await insertUser(db, newUser)

  const claimedInvitation = await claimInvitationsForAccount(
    db,
    { id: workosUser.id, email: workosUser.email, phone: null, address: null },
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
  await insertOrganizationMember(db, {
    id: crypto.randomUUID(),
    organizationId: personalOrgId,
    userId: workosUser.id,
    role: "admin",
    joinedAt: now,
  })

  await setActiveOrgCookie(personalOrgId)

  return newUser as User
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}
