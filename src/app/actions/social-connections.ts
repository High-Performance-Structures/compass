"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  socialAccounts,
  socialConnectionDrafts,
} from "@/db/schema-social"
import { requireAuth } from "@/lib/auth"
import { decrypt, encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { can } from "@/lib/permissions"
import { getSocialConfig, socialTokenSalt } from "@/lib/social/config"
import type { MetaPageCandidate } from "@/lib/social/meta"
import { requiredMetaScopes } from "@/lib/social/meta"
import {
  socialDepartment,
  socialPlatform,
  type SocialAccountSummary,
} from "@/lib/social/types"
import { isInternalStaffRole } from "@/lib/user-roles"

type ConnectionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type MetaCandidateSummary = {
  readonly pageId: string
  readonly pageName: string
  readonly instagramUsername: string | null
}

type MetaDraftResult =
  | {
      readonly success: true
      readonly draftId: string
      readonly department: string
      readonly candidates: readonly MetaCandidateSummary[]
    }
  | { readonly success: false; readonly error: string }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function parseMetaCandidates(value: string): readonly MetaPageCandidate[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    const candidates: MetaPageCandidate[] = []
    for (const item of parsed) {
      if (!isRecord(item)) continue
      const pageId = stringOrNull(item.pageId)
      const pageName = stringOrNull(item.pageName)
      const pageAccessToken = stringOrNull(item.pageAccessToken)
      if (!pageId || !pageName || !pageAccessToken) continue
      candidates.push({
        pageId,
        pageName,
        pageAccessToken,
        instagramAccountId: stringOrNull(item.instagramAccountId),
        instagramUsername: stringOrNull(item.instagramUsername),
      })
    }
    return candidates
  } catch {
    return []
  }
}

async function connectionContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly organizationId: string
  readonly config: ReturnType<typeof getSocialConfig>
}> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role) || !can(user, "organization", "update")) {
    throw new Error("Only organization administrators can manage social accounts.")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return {
    db: getDb(env.DB),
    user,
    organizationId,
    config: getSocialConfig(env),
  }
}

export async function getSocialAccounts(): Promise<readonly SocialAccountSummary[]> {
  try {
    const { db, organizationId } = await connectionContext()
    const rows = await db.select({
      id: socialAccounts.id,
      department: socialAccounts.department,
      platform: socialAccounts.platform,
      accountName: socialAccounts.accountName,
      status: socialAccounts.status,
      connectedAt: socialAccounts.connectedAt,
      lastPublishedAt: socialAccounts.lastPublishedAt,
      lastError: socialAccounts.lastError,
    }).from(socialAccounts).where(
      eq(socialAccounts.organizationId, organizationId),
    )
    return rows.flatMap((row) => {
      const department = socialDepartment(row.department)
      const platform = socialPlatform(row.platform)
      return department && platform ? [{ ...row, department, platform }] : []
    })
  } catch {
    return []
  }
}

export async function getPendingMetaConnection(
  draftId: string,
): Promise<MetaDraftResult> {
  try {
    const { db, user, organizationId, config } = await connectionContext()
    const draft = await db.select().from(socialConnectionDrafts).where(and(
      eq(socialConnectionDrafts.id, draftId),
      eq(socialConnectionDrafts.organizationId, organizationId),
      eq(socialConnectionDrafts.userId, user.id),
    )).get()
    if (!draft || draft.expiresAt <= new Date().toISOString()) {
      return { success: false, error: "This Meta connection selection has expired." }
    }
    const candidates = parseMetaCandidates(await decrypt(
      draft.candidatesEncrypted,
      config.tokenEncryptionKey,
      `compass-social-draft:${draft.id}`,
    ))
    return {
      success: true,
      draftId: draft.id,
      department: draft.department,
      candidates: candidates.map((candidate) => ({
        pageId: candidate.pageId,
        pageName: candidate.pageName,
        instagramUsername: candidate.instagramUsername,
      })),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to load Meta Pages.",
    }
  }
}

export async function finalizeMetaConnection(input: {
  readonly draftId: string
  readonly pageId: string
}): Promise<ConnectionResult> {
  try {
    const { db, user, organizationId, config } = await connectionContext()
    const draft = await db.select().from(socialConnectionDrafts).where(and(
      eq(socialConnectionDrafts.id, input.draftId),
      eq(socialConnectionDrafts.organizationId, organizationId),
      eq(socialConnectionDrafts.userId, user.id),
    )).get()
    const department = socialDepartment(draft?.department ?? "")
    if (!draft || !department || draft.expiresAt <= new Date().toISOString()) {
      return { success: false, error: "This Meta connection selection has expired." }
    }
    const candidates = parseMetaCandidates(await decrypt(
      draft.candidatesEncrypted,
      config.tokenEncryptionKey,
      `compass-social-draft:${draft.id}`,
    ))
    const candidate = candidates.find((item) => item.pageId === input.pageId)
    if (!candidate) return { success: false, error: "Choose a valid Facebook Page." }

    const now = new Date().toISOString()
    const scopes = requiredMetaScopes().join(" ")
    const platforms = candidate.instagramAccountId
      ? ["facebook", "instagram"]
      : ["facebook"]
    for (const platform of platforms) {
      const externalAccountId = platform === "instagram"
        ? candidate.instagramAccountId
        : candidate.pageId
      if (!externalAccountId) continue
      const salt = socialTokenSalt({ organizationId, department, platform })
      const existing = await db.select().from(socialAccounts).where(and(
        eq(socialAccounts.organizationId, organizationId),
        eq(socialAccounts.department, department),
        eq(socialAccounts.platform, platform),
      )).get()
      await db.insert(socialAccounts).values({
        id: existing?.id ?? crypto.randomUUID(),
        organizationId,
        department,
        platform,
        externalAccountId,
        parentExternalAccountId: platform === "instagram" ? candidate.pageId : null,
        accountName: platform === "instagram"
          ? `@${candidate.instagramUsername ?? candidate.pageName}`
          : candidate.pageName,
        accessTokenEncrypted: await encrypt(
          candidate.pageAccessToken,
          config.tokenEncryptionKey,
          salt,
        ),
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        grantedScopes: scopes,
        status: "connected",
        connectedBy: user.id,
        connectedAt: now,
        lastPublishedAt: existing?.lastPublishedAt ?? null,
        lastError: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          socialAccounts.organizationId,
          socialAccounts.department,
          socialAccounts.platform,
        ],
        set: {
          externalAccountId,
          parentExternalAccountId: platform === "instagram" ? candidate.pageId : null,
          accountName: platform === "instagram"
            ? `@${candidate.instagramUsername ?? candidate.pageName}`
            : candidate.pageName,
          accessTokenEncrypted: await encrypt(
            candidate.pageAccessToken,
            config.tokenEncryptionKey,
            salt,
          ),
          grantedScopes: scopes,
          status: "connected",
          connectedBy: user.id,
          connectedAt: now,
          lastError: null,
          updatedAt: now,
        },
      }).run()
    }
    await db.delete(socialConnectionDrafts).where(
      eq(socialConnectionDrafts.id, draft.id),
    ).run()
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to connect Meta accounts.",
    }
  }
}

export async function disconnectSocialAccount(accountId: string): Promise<ConnectionResult> {
  try {
    const { db, organizationId, config } = await connectionContext()
    const account = await db.select().from(socialAccounts).where(and(
      eq(socialAccounts.id, accountId),
      eq(socialAccounts.organizationId, organizationId),
    )).get()
    if (!account) return { success: false, error: "Social account not found." }
    const now = new Date().toISOString()
    await db.update(socialAccounts).set({
      accessTokenEncrypted: await encrypt(
        "disconnected",
        config.tokenEncryptionKey,
        socialTokenSalt({
          organizationId,
          department: account.department,
          platform: account.platform,
        }),
      ),
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      status: "disconnected",
      lastError: null,
      updatedAt: now,
    }).where(eq(socialAccounts.id, account.id)).run()
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to disconnect social account.",
    }
  }
}
