"use server"

import { and, desc, eq, inArray, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { customers } from "@/db/schema"
import { sageClientDirectoryEntries, sageClientDirectoryRefreshes } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import { getSageContactBridgeSecret } from "@/lib/sage/bridge-auth"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"

export type SageClientDirectoryRow = {
  readonly sageRecordId: string
  readonly sageClientNumber: string
  readonly name: string
  readonly email: string | null
  readonly capturedAt: string
  readonly claimedBy: { readonly id: string; readonly name: string; readonly verified: boolean } | null
  readonly claimCount: number
}

export type SageClientDirectoryPage = {
  readonly rows: readonly SageClientDirectoryRow[]
  readonly hasMore: boolean
  readonly refreshStatus: string | null
  readonly lastCapturedAt: string | null
  readonly errorMessage: string | null
}

export async function listSageClientDirectory(query: string): Promise<SageClientDirectoryPage> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "sage-contact-review", "read")
  await requireFeaturePermission(user, "customers", "read")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!sageContactOrganizationMatches(env, orgId)) throw new Error("Sage client directory is unavailable for this organization.")
  const db = getDb(env.DB)
  const search = query.trim().slice(0, 100)
  const searchCondition = search ? or(
    sql`instr(lower(${sageClientDirectoryEntries.name}), lower(${search})) > 0`,
    sql`instr(${sageClientDirectoryEntries.sageClientNumber}, ${search}) > 0`
  ) : undefined
  const [entries, latest, snapshot] = await Promise.all([
    db.select({
      sageRecordId: sageClientDirectoryEntries.sageRecordId,
      sageClientNumber: sageClientDirectoryEntries.sageClientNumber,
      name: sageClientDirectoryEntries.name,
      email: sageClientDirectoryEntries.email,
      capturedAt: sageClientDirectoryEntries.capturedAt,
    }).from(sageClientDirectoryEntries)
      .where(and(eq(sageClientDirectoryEntries.organizationId, orgId), searchCondition))
      .orderBy(sageClientDirectoryEntries.name).limit(51),
    db.select().from(sageClientDirectoryRefreshes)
      .where(eq(sageClientDirectoryRefreshes.organizationId, orgId))
      .orderBy(desc(sageClientDirectoryRefreshes.requestedAt)).limit(1).get(),
    db.select({ capturedAt: sql<string | null>`max(${sageClientDirectoryEntries.capturedAt})` })
      .from(sageClientDirectoryEntries)
      .where(eq(sageClientDirectoryEntries.organizationId, orgId)).get(),
  ])
  const numbers = entries.slice(0, 50).map((entry) => entry.sageClientNumber)
  const claims = numbers.length ? await db.select({
    id: customers.id, name: customers.name, sageClientNumber: customers.sageClientNumber,
    sageClientId: customers.sageClientId,
  }).from(customers).where(and(eq(customers.organizationId, orgId), inArray(customers.sageClientNumber, numbers))) : []
  const claimsByNumber = new Map<string, typeof claims>()
  for (const claim of claims) {
    if (!claim.sageClientNumber) continue
    const previous = claimsByNumber.get(claim.sageClientNumber) ?? []
    previous.push(claim)
    claimsByNumber.set(claim.sageClientNumber, previous)
  }
  return {
    rows: entries.slice(0, 50).map((row) => {
      const owners = claimsByNumber.get(row.sageClientNumber) ?? []
      const owner = owners.length === 1 ? owners[0] : null
      return {
        sageRecordId: row.sageRecordId, sageClientNumber: row.sageClientNumber,
        name: row.name, email: row.email, capturedAt: row.capturedAt,
        claimCount: owners.length,
        claimedBy: owner ? { id: owner.id, name: owner.name, verified: owner.sageClientId === row.sageRecordId } : null,
      }
    }),
    hasMore: entries.length > 50,
    refreshStatus: latest?.status ?? null,
    lastCapturedAt: snapshot?.capturedAt ?? null,
    errorMessage: latest?.status === "failed" ? latest.errorMessage : null,
  }
}

export async function requestSageClientDirectoryRefresh(): Promise<
  | { readonly success: true; readonly status: "queued" | "already_pending" }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "sage-contact-review", "read")
    await requireFeaturePermission(user, "customers", "read")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactOrganizationMatches(env, orgId) || !getSageContactBridgeSecret(env)) {
      return { success: false, error: "Sage client directory bridge is not configured." }
    }
    const db = getDb(env.DB)
    const pending = await db.select({ id: sageClientDirectoryRefreshes.id })
      .from(sageClientDirectoryRefreshes).where(and(
        eq(sageClientDirectoryRefreshes.organizationId, orgId),
        or(eq(sageClientDirectoryRefreshes.status, "queued"), eq(sageClientDirectoryRefreshes.status, "running"))
      )).get()
    if (pending) return { success: true, status: "already_pending" }
    const recent = await db.select({ requestedAt: sageClientDirectoryRefreshes.requestedAt })
      .from(sageClientDirectoryRefreshes).where(eq(sageClientDirectoryRefreshes.organizationId, orgId))
      .orderBy(desc(sageClientDirectoryRefreshes.requestedAt)).limit(1).get()
    if (recent && Date.now() - Date.parse(recent.requestedAt) < 60_000) {
      return { success: false, error: "Please wait a minute before requesting another Sage directory refresh." }
    }
    try {
      await db.insert(sageClientDirectoryRefreshes).values({
        id: crypto.randomUUID(), organizationId: orgId, status: "queued",
        requestedByUserId: user.id, requestedAt: new Date().toISOString(),
      })
    } catch {
      const active = await db.select({ id: sageClientDirectoryRefreshes.id })
        .from(sageClientDirectoryRefreshes).where(and(eq(sageClientDirectoryRefreshes.organizationId, orgId),
          or(eq(sageClientDirectoryRefreshes.status, "queued"), eq(sageClientDirectoryRefreshes.status, "running")))).get()
      if (active) return { success: true, status: "already_pending" }
      throw new Error("Could not queue Sage directory refresh.")
    }
    return { success: true, status: "queued" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not request Sage directory refresh." }
  }
}
