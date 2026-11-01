"use server"

import { and, count, eq, max } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { vendorContacts, vendors } from "@/db/schema"
import { sageVendorCertificateSyncs, sageVendorDirectoryEntries } from "@/db/schema-sage"
import type { ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { sageIdentityLinkStatement } from "@/lib/domain/contacts/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES, type SageVendorCertificateSyncStatus } from "@/lib/domain/sage-bridge/statuses"
import { matchSageVendors, type SageVendorMatch } from "@/lib/domain/sage-bridge/vendor-directory-rules"
import { requestAllVendorCertificateSyncs, requestVendorCertificateSyncs } from "@/lib/sage/vendor-certificates"
import { orgContext, type Db } from "@/lib/server/action-context"

export type SageVendorCertificateOverview = {
  /** When Sage last sent its vendor list; null before the writer has run. */
  readonly directoryCapturedAt: string | null
  readonly sageVendorCount: number
  readonly compassVendorCount: number
  readonly linkedCount: number
  /** Exact one-to-one matches staff can link in one step. */
  readonly matches: readonly SageVendorMatch[]
  readonly syncCounts: Readonly<Record<SageVendorCertificateSyncStatus, number>>
}

async function loadMatches(db: Db, organizationId: string): Promise<{ readonly matches: readonly SageVendorMatch[]; readonly compassVendorCount: number; readonly linkedCount: number; readonly sageVendorCount: number; readonly capturedAt: string | null }> {
  const [vendorRows, contactRows, entries] = await Promise.all([
    db
      .select({ id: vendors.id, name: vendors.name, email: vendors.email, primaryEmail: vendors.primaryEmail, sageVendorId: vendors.sageVendorId })
      .from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"))),
    db
      .select({ vendorId: vendorContacts.vendorId, email: vendorContacts.email })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(eq(vendors.organizationId, organizationId)),
    db.select().from(sageVendorDirectoryEntries).where(eq(sageVendorDirectoryEntries.organizationId, organizationId)),
  ])
  const contactEmails = new Map<string, (string | null)[]>()
  for (const row of contactRows) contactEmails.set(row.vendorId, [...(contactEmails.get(row.vendorId) ?? []), row.email])
  const matches = matchSageVendors(
    vendorRows.map((row) => ({ id: row.id, name: row.name, emails: [row.email, row.primaryEmail, ...(contactEmails.get(row.id) ?? [])], sageRecordId: row.sageVendorId })),
    entries
  )
  const capturedAt = entries.reduce<string | null>((latest, entry) => (latest === null || entry.capturedAt > latest ? entry.capturedAt : latest), null)
  return {
    matches,
    compassVendorCount: vendorRows.length,
    linkedCount: vendorRows.filter((row) => row.sageVendorId).length,
    sageVendorCount: entries.length,
    capturedAt,
  }
}

/** Settings → Trade docs → Sage: how many vendors are linked, ready to link, and synced. */
export async function getSageVendorCertificateOverview(): Promise<ActionResult<SageVendorCertificateOverview>> {
  const ctx = await orgContext({ feature: "vendors" })
  if (!ctx.success) return ctx
  try {
    const [loaded, syncRows] = await Promise.all([
      loadMatches(ctx.data.db, ctx.data.organizationId),
      ctx.data.db
        .select({ status: sageVendorCertificateSyncs.status, total: count(), last: max(sageVendorCertificateSyncs.completedAt) })
        .from(sageVendorCertificateSyncs)
        .where(eq(sageVendorCertificateSyncs.organizationId, ctx.data.organizationId))
        .groupBy(sageVendorCertificateSyncs.status),
    ])
    const syncCounts = Object.fromEntries(SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES.map((status) => [status, syncRows.find((row) => row.status === status)?.total ?? 0]))
    return {
      success: true,
      data: {
        directoryCapturedAt: loaded.capturedAt,
        sageVendorCount: loaded.sageVendorCount,
        compassVendorCount: loaded.compassVendorCount,
        linkedCount: loaded.linkedCount,
        matches: loaded.matches,
        syncCounts: {
          queued: syncCounts.queued ?? 0,
          running: syncCounts.running ?? 0,
          succeeded: syncCounts.succeeded ?? 0,
          failed: syncCounts.failed ?? 0,
        },
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not load the Sage vendor links." }
  }
}

/**
 * Links every exact one-to-one match to its Sage vendor record. The matches
 * are worked out again here, so only links that still hold are made; a
 * vendor someone linked in the meantime is left as it is.
 */
export async function linkSageVendorMatches(): Promise<ActionResult<{ readonly linked: number }>> {
  const ctx = await orgContext({ feature: "vendors", action: "update", mutation: true })
  if (!ctx.success) return ctx
  const { db, env, organizationId, user } = ctx.data
  try {
    const { matches } = await loadMatches(db, organizationId)
    if (matches.length === 0) return { success: true, data: { linked: 0 } }
    const statements = matches.map((match) =>
      sageIdentityLinkStatement(env.DB, "vendor_company", "1 = 1", [match.sageRecordId, match.sageVendorNumber, match.vendorId, organizationId, match.sageVendorNumber])
    )
    const results = await env.DB.batch(statements)
    const linkedIds = matches.filter((_, index) => (results[index]?.meta.changes ?? 0) === 1).map((match) => match.vendorId)
    await recordActivityEvent({
      db,
      organizationId,
      actor: user,
      category: "financial",
      action: "vendor.sage_linked_in_bulk",
      entityType: "vendor",
      summary: `Linked ${linkedIds.length} vendor${linkedIds.length === 1 ? "" : "s"} to their Sage records by exact name or email`,
      metadata: { linked: matches.filter((match) => linkedIds.includes(match.vendorId)).map((match) => ({ vendorId: match.vendorId, sageVendorNumber: match.sageVendorNumber, by: match.by })) },
    })
    await requestVendorCertificateSyncs(db, organizationId, linkedIds)
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { linked: linkedIds.length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not link the vendors." }
  }
}

/** Sends every linked vendor's certificates to Sage again. */
export async function syncAllSageVendorCertificates(): Promise<ActionResult<{ readonly queued: number }>> {
  const ctx = await orgContext({ feature: "vendors", action: "update", mutation: true })
  if (!ctx.success) return ctx
  try {
    const settings = await readFeatureSettings(ctx.data.db, ctx.data.organizationId, "trade-docs")
    if (!settings.sage.enabled) return { success: false, error: "Turn on the Sage certificate sync first." }
    const queued = await requestAllVendorCertificateSyncs(ctx.data.db, ctx.data.organizationId)
    revalidatePath("/dashboard/settings")
    return { success: true, data: { queued } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not queue the vendors." }
  }
}
