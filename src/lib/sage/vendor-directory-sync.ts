import "server-only"

import { recordActivityEvents, type ActivityActor } from "@/lib/activity-log"
import { applySageVendorUpdates, listSageLinkedVendors } from "@/lib/domain/contacts/sage-vendor-store"
import type { SageVendorDirectoryRow } from "@/lib/domain/sage-bridge/store"
import { planSageVendorUpdate, sageVendorUpdateSummary, type SageVendorEntry, type SageVendorUpdate } from "@/lib/domain/sage-bridge/vendor-directory-updates"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { noNewSageHoldCondition, sageHoldsByEntity } from "@/lib/sage/sage-held-fields"
import { requestVendorCertificateSyncs } from "@/lib/sage/vendor-certificates"
import type { Db } from "@/lib/server/action-context"

const SAGE_ACTOR: ActivityActor = { id: null, email: "sage", displayName: "Sage vendor list", firstName: null, lastName: null, role: "system" }

/**
 * After the Sage writer sends Sage's vendor list: linked vendors take Sage's
 * values (see vendor-directory-updates.ts), each change is logged on the
 * vendor's Activity, and a vendor whose category changed has its Sage
 * certificates re-sent, since the documents it must have may have changed.
 * Never fails the caller; the list itself is already stored.
 */
export async function applySageVendorDirectory(
  db: Db,
  organizationId: string,
  entries: readonly SageVendorDirectoryRow[],
  now: string
): Promise<{ readonly updated: number }> {
  try {
    const settings = await readFeatureSettings(db, organizationId, "trade-docs")
    if (!settings.sage.updateVendors) return { updated: 0 }
    // Rows from an older writer carry no details, so they change nothing.
    const byRecord = new Map<string, SageVendorEntry>()
    for (const entry of entries) {
      if (entry.details) byRecord.set(entry.sageRecordId.toLowerCase(), { name: entry.name, email: entry.email, details: entry.details })
    }
    if (byRecord.size === 0) return { updated: 0 }
    const linked = await listSageLinkedVendors(db, organizationId)
    // Categories a Sage type of the same name can land on without a mapping.
    const categories = [...new Set([
      ...linked.map((vendor) => vendor.category),
      ...settings.docTypes.flatMap((type) => type.requiredFor),
    ])]
    // Fields with an unfinished Sage change keep Compass's new value.
    const holds = await sageHoldsByEntity(db, organizationId, "vendor_company")
    const plans: { readonly update: SageVendorUpdate; readonly sageRecordId: string }[] = []
    for (const vendor of linked) {
      const sageRecordId = vendor.sageRecordId
      const entry = sageRecordId ? byRecord.get(sageRecordId.toLowerCase()) : undefined
      if (!sageRecordId || !entry) continue
      const update = planSageVendorUpdate(vendor, entry, settings.sage.vendorTypes, categories, holds.get(vendor.id)?.fields)
      if (update) plans.push({ update, sageRecordId })
    }
    if (plans.length === 0) return { updated: 0 }
    const written = new Set(await applySageVendorUpdates(db, {
      organizationId,
      now,
      updates: plans.map(({ update, sageRecordId }) => ({
        vendorId: update.vendorId, sageRecordId, patch: update.patch,
        // A staff edit landing after the holds were read stops this vendor's update (next list applies the rest).
        guard: noNewSageHoldCondition({
          organizationId, kind: "vendor_company", entityId: update.vendorId,
          seen: holds.get(update.vendorId)?.proposalIds ?? [],
        }),
      })),
    }))
    const applied = plans.filter(({ update }) => written.has(update.vendorId)).map(({ update }) => update)
    await recordActivityEvents(db, applied.map((update) => ({
      organizationId,
      actor: SAGE_ACTOR,
      category: "account",
      action: "vendor.sage_updated",
      entityType: "vendor",
      entityId: update.vendorId,
      summary: sageVendorUpdateSummary(update),
      metadata: Object.fromEntries(update.changes.flatMap((change) => [
        [`${change.field}Before`, change.before ?? ""],
        [`${change.field}After`, change.after],
      ])),
      createdAt: now,
    })))
    const recategorized = applied.filter((update) => update.changes.some((change) => change.field === "category"))
    await requestVendorCertificateSyncs(db, organizationId, recategorized.map((update) => update.vendorId))
    return { updated: applied.length }
  } catch (error) {
    console.error("Could not apply Sage's vendor list to Compass vendors", error)
    return { updated: 0 }
  }
}
