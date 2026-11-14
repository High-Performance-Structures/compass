import { cache } from "react"
import { withAuth } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext, getUnguardedCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import type { User } from "@/db/schema"
import { cookies } from "next/headers"
import { DEVELOPER_MODE_COOKIE, developerModeFromCookie } from "@/lib/developer-mode"
import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import { resolveViewAs, viewAsSecret, type ViewAsResolution } from "@/lib/view-as/session"
import { DEMO_USER } from "@/lib/demo"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import { recordActivityEvent } from "@/lib/activity-log"
import { ensureInternalContactForStaff } from "@/lib/internal-contact-provisioning"
import { organizationMembershipsQuery } from "@/lib/domain/identity/reads"
import { resolveSessionRole } from "@/lib/domain/identity/session-role"
import { projectRolesForUserQuery } from "@/lib/domain/project/member-role"
import {
  accountByEmail,
  accountById,
  accountByIdQuery,
  claimInvitationsForAccount,
  claimProjectAccessInvitations,
  normalizedEmailAddress,
  pendingInvitationsQuery,
} from "@/lib/domain/identity/accounts"
import {
  insertOrganization,
  insertOrganizationMember,
  insertUser,
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
  /**
   * Set only while an admin is using developer View as: the admin's company.
   * Project access and project lists stay inside it, so a person who is also
   * on another company's jobs never shows that company's work.
   */
  readonly viewAsCompanyId?: string
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

/** The organization the person last switched to, if the cookie is readable. */
async function preferredOrganizationId(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    return cookieStore.get("compass-active-org")?.value ?? null
  } catch {
    return null
  }
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
const loadSignedInUserForRequest = cache(
  (cookieKey: string, viewing: boolean): Promise<AuthUser | null> => {
    void cookieKey // Only distinguishes cache entries.
    return loadSignedInUser(viewing)
  }
)

/** The cookies that change who the current user is, as one cache key. */
async function identityCookies(): Promise<{ readonly key: string; readonly viewAs: string | null; readonly developerMode: string | undefined }> {
  let activeOrg: string | null = null
  let demoSession: string | null = null
  let viewAs: string | null = null
  let developerMode: string | undefined
  try {
    const cookieStore = await cookies()
    activeOrg = cookieStore.get("compass-active-org")?.value ?? null
    demoSession = cookieStore.get("compass-demo")?.value ?? null
    viewAs = cookieStore.get(VIEW_AS_COOKIE)?.value || null
    developerMode = cookieStore.get(DEVELOPER_MODE_COOKIE)?.value
  } catch {
    // cookies() may throw in non-request contexts
  }
  return { key: JSON.stringify([activeOrg, demoSession, viewAs, developerMode]), viewAs, developerMode }
}

/**
 * The person really signed in, ignoring View as. Only the View as module and
 * its top bar need this; everything else calls getCurrentUser().
 */
export async function getSignedInUser(): Promise<AuthUser | null> {
  const identity = await identityCookies()
  return loadSignedInUserForRequest(identity.key, identity.viewAs !== null)
}

const resolveViewAsForRequest = cache(
  async (cookieKey: string, token: string, developerMode: string | undefined): Promise<ViewAsResolution> => {
    const admin = await loadSignedInUserForRequest(cookieKey, true)
    const { env } = await getCloudflareContext()
    return resolveViewAs({
      token,
      secret: viewAsSecret(env),
      admin,
      db: getDb(env.DB),
      developerModeEnabled: developerModeFromCookie(developerMode, true),
    })
  }
)

/** This request's View as session: none, active (with both people), or no longer valid. */
export async function getViewAsState(): Promise<ViewAsResolution> {
  const identity = await identityCookies()
  if (!identity.viewAs) return { kind: "none" }
  return resolveViewAsForRequest(identity.key, identity.viewAs, identity.developerMode)
}

/**
 * The current user. During View as this is the viewed person (read only,
 * re-checked each request); a View as session that is no longer allowed
 * yields no user rather than falling back to the admin, because the
 * request's database is read only until the admin exits.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const identity = await identityCookies()
  if (!identity.viewAs) return loadSignedInUserForRequest(identity.key, false)
  const viewAs = await resolveViewAsForRequest(identity.key, identity.viewAs, identity.developerMode)
  return viewAs.kind === "active" ? viewAs.target : null
}

/**
 * Sign-in housekeeping (last login, invitation claims) writes to the admin's
 * own account, so it uses the writable bindings even during View as.
 */
async function loadSignedInUser(viewing: boolean): Promise<AuthUser | null> {
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

    const { env } = await (viewing ? getUnguardedCloudflareContext() : getCloudflareContext())
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
      accountByIdQuery(db, workosUser.id),
      pendingInvitationsQuery(db, workosEmail),
      organizationMembershipsQuery(db, workosUser.id),
      projectRolesForUserQuery(db, workosUser.id),
    ])

    let activatedPendingAccount = false
    let dbUser: User | undefined = userRows[0]
    const foundByWorkosId = dbUser !== undefined

    if (!dbUser) {
      const emailMatch = await accountByEmail(db, workosUser.email)
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
        dbUser = await accountById(db, emailMatch.id)
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
          projectRolesForUserQuery(db, dbUser.id),
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

    const { role: effectiveRole, activeOrg } = resolveSessionRole({
      orgMemberships,
      preferredOrgId: await preferredOrganizationId(),
      projectRoles: projectMemberships.map((membership) => membership.role),
      accountRole: dbUser.role,
    })

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
  const normalizedEmail = normalizedEmailAddress(workosUser.email)

  // Check if user already exists
  const existing = await accountById(db, workosUser.id)

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
  const emailMatch = await accountByEmail(db, normalizedEmail)
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

  const newUser: Parameters<typeof insertUser>[1] = {
    id: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName ?? null,
    lastName: workosUser.lastName ?? null,
    displayName:
      workosUser.firstName && workosUser.lastName
        ? `${workosUser.firstName} ${workosUser.lastName}`
        : workosUser.email.split("@")[0],
    avatarUrl: workosUser.profilePictureUrl ?? null,
    // Every new account starts as "guest", the least access. The working
    // role comes from the person's company or project membership
    // (resolveSessionRole); someone becomes staff only when an admin adds them
    // to the company as staff. "office" here once left invited owners and
    // vendors whose WorkOS link had expired holding a staff fallback role.
    role: "guest",
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

  await insertOrganization(db, {
    id: personalOrgId,
    name: `${workosUser.firstName ?? "User"}'s Workspace`,
    slug: personalSlug,
    type: "personal",
    logoUrl: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

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
