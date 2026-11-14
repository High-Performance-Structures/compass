/*
 * Resolves a View as session for getCurrentUser() (src/lib/auth.ts). Given
 * the signed cookie and the admin who is really signed in, it re-checks
 * everything on each request and returns the viewed person's identity:
 *
 * 1. the token's signature and expiry (token.ts);
 * 2. it was started by this same signed-in admin, in their current company;
 * 3. the admin may still use View as: role, company setting, developer mode
 *    (policy.ts);
 * 4. the viewed person is still active and part of that company.
 *
 * The identity returned is exactly the one sign-in would give that person,
 * so every page shows their Compass and their permissions, never more. It
 * cannot write anything: the request's bindings are read only (write-guard).
 */
import type { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { isDevAuthFallbackAllowed } from "@/lib/auth-config"
import { isPersonOfCompany, viewAsIdentity } from "@/lib/domain/identity/view-as-people"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { viewAsPermission } from "@/lib/view-as/policy"
import { verifyViewAsToken, type ViewAsTokenPayload } from "@/lib/view-as/token"

export type ViewAsResolution =
  | { readonly kind: "none" }
  | {
      readonly kind: "active"
      readonly payload: ViewAsTokenPayload
      readonly admin: AuthUser
      readonly target: AuthUser
    }
  | { readonly kind: "invalid"; readonly reason: string; readonly payload: ViewAsTokenPayload | null }

/**
 * The server secret View as tokens are signed with. Local development
 * without the secret uses a fixed value only where the dev sign-in fallback
 * is allowed; production without it refuses View as.
 */
export function viewAsSecret(env: unknown): string | null {
  const secret: unknown = typeof env === "object" && env !== null ? Reflect.get(env, "AGENT_AUTH_SECRET") : undefined
  if (typeof secret === "string" && secret.length >= 16) return secret
  return isDevAuthFallbackAllowed() ? "compass-local-view-as-secret" : null
}

type Db = ReturnType<typeof getDb>

/** Whether the viewed person's resolved company is one the admin may see through. */
function companyIsInScope(activeOrg: { readonly orgId: string; readonly orgType: string } | null, adminOrgId: string): boolean {
  if (activeOrg === null) return true
  // A personal workspace holds nothing of another company.
  return activeOrg.orgId === adminOrgId || activeOrg.orgType === "personal"
}

export async function resolveViewAs(input: {
  readonly token: string
  readonly secret: string | null
  readonly admin: AuthUser | null
  readonly db: Db
  readonly developerModeEnabled: boolean
}): Promise<ViewAsResolution> {
  if (!input.secret) return { kind: "invalid", reason: "View as is not configured.", payload: null }
  const payload = await verifyViewAsToken(input.token, input.secret)
  if (!payload) return { kind: "invalid", reason: "This View as session has expired.", payload: null }
  const { admin } = input
  if (!admin || admin.id !== payload.adminId || admin.organizationId !== payload.orgId) {
    return { kind: "invalid", reason: "This View as session belongs to another sign-in.", payload }
  }
  const settings = await readFeatureSettings(input.db, payload.orgId, "view-as")
  const permission = viewAsPermission({ user: admin, settings, developerModeEnabled: input.developerModeEnabled })
  if (!permission.allowed) return { kind: "invalid", reason: permission.reason, payload }
  const target = await viewAsTargetUser(input.db, payload.targetId, payload.orgId)
  if (!target.ok) return { kind: "invalid", reason: target.reason, payload }
  return { kind: "active", payload, admin, target: target.user }
}

/**
 * The person as Compass would sign them in, or why they cannot be viewed.
 * Used when viewing starts and again on every request.
 */
export async function viewAsTargetUser(
  db: Db,
  targetId: string,
  organizationId: string,
): Promise<{ readonly ok: true; readonly user: AuthUser } | { readonly ok: false; readonly reason: string }> {
  if (!(await isPersonOfCompany(db, targetId, organizationId))) {
    return { ok: false, reason: "That person is not part of this company." }
  }
  const identity = await viewAsIdentity(db, targetId, organizationId)
  if (!identity) return { ok: false, reason: "That person's account is not active." }
  const { account, session } = identity
  if (!companyIsInScope(session.activeOrg, organizationId)) {
    return { ok: false, reason: "That person's Compass opens in another company." }
  }
  return {
    ok: true,
    user: {
      id: account.id,
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      displayName: account.displayName,
      phone: account.phone,
      address: account.address,
      avatarUrl: account.avatarUrl,
      dashboardDeskPhotoUrl: account.dashboardDeskPhotoUrl,
      sidebarDeskPhotoUrl: account.sidebarDeskPhotoUrl,
      role: session.role,
      googleEmail: account.googleEmail ?? null,
      isActive: account.isActive,
      lastLoginAt: account.lastLoginAt,
      organizationId: session.activeOrg?.orgId ?? null,
      organizationName: session.activeOrg?.orgName ?? null,
      organizationType: session.activeOrg?.orgType ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      viewAsCompanyId: organizationId,
    },
  }
}
