import "server-only"

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod/v4"

import { vendors } from "@/db/schema"
import { vendorTradeDocuments } from "@/db/schema-trade-docs"
import { chunkD1Values } from "@/lib/d1-query"
import { dayBefore, planSageCertificates } from "@/lib/domain/sage-bridge/certificate-rules"
import { queueVendorCertificateSyncs } from "@/lib/domain/sage-bridge/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import { isTradeDocBillMode } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs } from "@/lib/trade-docs/status"

/**
 * Keeps Sage's vendor certificates in step with the trade docs in Compass.
 * Compass queues a vendor whenever their documents or bill choice change;
 * the Sage writer claims the queue and gets the certificate rows built from
 * the documents at that moment.
 */

const SAGE_VENDOR_CERTIFICATE_OPERATION = "sync_vendor_certificates"

const yesNo = z.enum(["Y", "N"])
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const sageCertificateLineSchema = z.strictObject({
  docTypeId: z.string().min(1).max(40),
  desc: z.string().trim().min(1).max(50),
  matchNames: z.array(z.string().min(1).max(60)).min(1).max(5),
  receivedDate: dateOnly.nullable(),
  expiryDate: dateOnly.nullable(),
  warn: yesNo,
  stopPay: yesNo,
  memo: z.string().max(500),
})

const sageVendorCertificatePayloadSchema = z.strictObject({
  operationType: z.literal(SAGE_VENDOR_CERTIFICATE_OPERATION),
  organizationId: z.string().min(1),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1).max(200),
  sageRecordId: z.guid(),
  sageVendorNumber: z.string().regex(/^[1-9]\d{0,9}$/),
  certificates: z.array(sageCertificateLineSchema).max(30),
})
export type SageVendorCertificatePayload = z.infer<typeof sageVendorCertificatePayloadSchema>

/** Whether the writer on the Sage computer may claim certificate syncs (Compass-side switch). */
export function sageVendorCertificateWritesEnabled(env: object): boolean {
  const value: unknown = Reflect.get(env, "SAGE_VENDOR_CERTIFICATE_WRITES_ENABLED")
  return typeof value === "string" && value.trim().toLowerCase() === "true"
}

/**
 * Queues the given vendors' certificate syncs, if the company syncs to Sage
 * and the vendor is linked to its Sage record. Never fails the caller's
 * save: a problem here is logged and the next change queues the vendor again.
 */
export async function requestVendorCertificateSyncs(db: Db, organizationId: string, vendorIds: readonly string[]): Promise<void> {
  try {
    if (vendorIds.length === 0) return
    const settings = await readFeatureSettings(db, organizationId, "trade-docs")
    if (!settings.sage.enabled) return
    const linked: string[] = []
    for (const ids of chunkD1Values([...new Set(vendorIds)])) {
      const rows = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.organizationId, organizationId), inArray(vendors.id, ids), isNotNull(vendors.sageVendorId), isNotNull(vendors.sageVendorNumber)))
      linked.push(...rows.map((row) => row.id))
    }
    await queueVendorCertificateSyncs(db, organizationId, linked, new Date().toISOString())
  } catch (error) {
    console.error("Could not queue the Sage certificate sync", error)
  }
}

/** Queues every vendor linked to Sage, after the company's Sage settings change. */
export async function requestAllVendorCertificateSyncs(db: Db, organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"), isNotNull(vendors.sageVendorId), isNotNull(vendors.sageVendorNumber)))
  await queueVendorCertificateSyncs(db, organizationId, rows.map((row) => row.id), new Date().toISOString())
  return rows.length
}

/** The certificate rows Sage should have for one vendor today, or why there are none to send. */
export async function buildVendorCertificatePayload(
  db: Db,
  organizationId: string,
  vendorId: string,
  today: string
): Promise<{ readonly success: true; readonly payload: SageVendorCertificatePayload } | { readonly success: false; readonly error: string }> {
  const [vendor, settings, docRows] = await Promise.all([
    db
      .select({
        id: vendors.id,
        name: vendors.name,
        category: vendors.category,
        billMode: vendors.tradeDocsBillMode,
        sageVendorId: vendors.sageVendorId,
        sageVendorNumber: vendors.sageVendorNumber,
      })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
      .get(),
    readFeatureSettings(db, organizationId, "trade-docs"),
    db
      .select()
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.vendorId, vendorId), isNull(vendorTradeDocuments.supersededAt))),
  ])
  if (!vendor) return { success: false, error: "The vendor is no longer in the directory." }
  if (!settings.sage.enabled) return { success: false, error: "Sage certificate sync is turned off in Settings." }
  if (!vendor.sageVendorId || !vendor.sageVendorNumber) return { success: false, error: "The vendor isn't linked to Sage." }
  const summary = summarizeTradeDocs({ docTypes: settings.docTypes, vendorCategory: vendor.category, docs: docRows.map(toTradeDocOnFile), today })
  const certificates = planSageCertificates({
    summary,
    billMode: isTradeDocBillMode(vendor.billMode) ? vendor.billMode : settings.billModeDefault,
    warnOnly: settings.sage.warnOnly,
    sageNames: settings.sage.names,
    missingExpiresOn: dayBefore(today),
  })
  const payload = sageVendorCertificatePayloadSchema.safeParse({
    operationType: SAGE_VENDOR_CERTIFICATE_OPERATION,
    organizationId,
    vendorId: vendor.id,
    vendorName: vendor.name.slice(0, 200),
    sageRecordId: vendor.sageVendorId,
    sageVendorNumber: vendor.sageVendorNumber,
    certificates,
  })
  if (!payload.success) return { success: false, error: "The vendor's certificate rows couldn't be built for Sage." }
  return { success: true, payload: payload.data }
}
