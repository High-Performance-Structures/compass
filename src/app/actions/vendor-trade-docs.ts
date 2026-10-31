"use server"

import { and, desc, eq, isNull, isNotNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { vendors } from "@/db/schema"
import { vendorTradeDocuments } from "@/db/schema-trade-docs"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateVendorById } from "@/lib/domain/contacts/store"
import type { AuthUser } from "@/lib/auth"
import { tradeDocAccess, type TradeDocAccess } from "@/lib/trade-docs/access"
import { ensureVendorTradeDocsFolder } from "@/lib/trade-docs/drive"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import { isTradeDocBillMode, type TradeDocBillMode } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs, type TradeDocOnFile, type TradeDocSummary } from "@/lib/trade-docs/status"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type VendorTradeDocsView = {
  readonly vendor: {
    readonly id: string
    readonly name: string
    readonly category: string
    readonly billMode: TradeDocBillMode | null
    readonly folderUrl: string | null
  }
  readonly summary: TradeDocSummary
  /** Older documents replaced by newer ones, newest first. */
  readonly history: readonly TradeDocOnFile[]
  readonly certificateChecks: readonly string[]
  readonly billModeDefault: TradeDocBillMode
  readonly canEdit: boolean
}

export type VendorTradeDocStatus = {
  readonly label: string
  readonly requiredCount: number
  readonly goodCount: number
  readonly owedCount: number
  readonly expiringCount: number
}

export type RecordTradeDocInput = {
  readonly docType: string
  readonly kind: "document" | "waiver"
  /** The Drive file just uploaded to the vendor's folder, if any. */
  readonly driveFileId: string | null
  readonly effectiveOn: string | null
  readonly expiresOn: string | null
  readonly checks: readonly string[]
  readonly notes: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function cleanDate(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return DATE.test(trimmed) ? trimmed : null
}

function actorName(user: AuthUser): string {
  return (user.displayName ?? user.email).slice(0, 200)
}

async function requestOrigin(): Promise<string | undefined> {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  if (!host) return undefined
  return `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}`
}

type Access = TradeDocAccess

async function loadVendor(access: Access, vendorId: string) {
  const vendor = await access.db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      tradeDocsFolderId: vendors.tradeDocsFolderId,
      tradeDocsBillMode: vendors.tradeDocsBillMode,
    })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, access.organizationId)))
    .get()
  if (!vendor) throw new Error("Vendor not found.")
  return vendor
}

function revalidateVendors(): void {
  revalidatePath("/dashboard/contacts")
}

/** One vendor's trade docs: what's required, what's on file, and the history. */
export async function getVendorTradeDocs(vendorId: string): Promise<Result<VendorTradeDocsView>> {
  try {
    const access = await tradeDocAccess(false)
    const vendor = await loadVendor(access, vendorId)
    const rows = await access.db
      .select()
      .from(vendorTradeDocuments)
      .where(eq(vendorTradeDocuments.vendorId, vendor.id))
      .orderBy(desc(vendorTradeDocuments.createdAt))
    const current = rows.filter((row) => row.supersededAt === null).map(toTradeDocOnFile)
    const history = rows.filter((row) => row.supersededAt !== null).map(toTradeDocOnFile)
    return {
      success: true,
      data: {
        vendor: {
          id: vendor.id,
          name: vendor.name,
          category: vendor.category,
          billMode: isTradeDocBillMode(vendor.tradeDocsBillMode) ? vendor.tradeDocsBillMode : null,
          folderUrl: vendor.tradeDocsFolderId ? `https://drive.google.com/drive/folders/${vendor.tradeDocsFolderId}` : null,
        },
        summary: summarizeTradeDocs({ docTypes: access.settings.docTypes, vendorCategory: vendor.category, docs: current, today: today() }),
        history,
        certificateChecks: access.settings.certificateChecks,
        billModeDefault: access.settings.billModeDefault,
        canEdit: access.canEdit,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the trade docs.") }
  }
}

/** Trade doc standing for every vendor in the directory, for the vendors table. */
export async function getVendorTradeDocStatuses(): Promise<Result<Readonly<Record<string, VendorTradeDocStatus>>>> {
  try {
    const access = await tradeDocAccess(false)
    const [vendorRows, docRows] = await Promise.all([
      access.db
        .select({ id: vendors.id, category: vendors.category })
        .from(vendors)
        .where(and(eq(vendors.organizationId, access.organizationId), eq(vendors.directoryStatus, "active"))),
      access.db
        .select()
        .from(vendorTradeDocuments)
        .where(and(eq(vendorTradeDocuments.organizationId, access.organizationId), isNull(vendorTradeDocuments.supersededAt))),
    ])
    const docsByVendor = new Map<string, TradeDocOnFile[]>()
    for (const row of docRows) {
      const list = docsByVendor.get(row.vendorId) ?? []
      list.push(toTradeDocOnFile(row))
      docsByVendor.set(row.vendorId, list)
    }
    const date = today()
    const statuses: Record<string, VendorTradeDocStatus> = {}
    for (const vendor of vendorRows) {
      const summary = summarizeTradeDocs({ docTypes: access.settings.docTypes, vendorCategory: vendor.category, docs: docsByVendor.get(vendor.id) ?? [], today: date })
      if (summary.requiredCount === 0 && summary.lines.length === 0) continue
      statuses[vendor.id] = {
        label: summary.requiredCount === 0 ? "On file" : `${summary.goodCount} of ${summary.requiredCount}`,
        requiredCount: summary.requiredCount,
        goodCount: summary.goodCount,
        owedCount: summary.owed.length,
        expiringCount: summary.expiringCount,
      }
    }
    return { success: true, data: statuses }
  } catch (error) {
    return { success: false, error: message(error, "Could not load trade doc status.") }
  }
}

/** Starts a browser upload into the vendor's trade docs folder in Drive. */
export async function startVendorTradeDocUpload(
  vendorId: string,
  fileName: string,
  mimeType: string,
): Promise<Result<{ readonly uploadUrl: string }>> {
  try {
    const access = await tradeDocAccess(true)
    const vendor = await loadVendor(access, vendorId)
    const drive = await ensureVendorTradeDocsFolder({
      db: access.db,
      environment: access.env,
      organizationId: access.organizationId,
      user: access.user,
      vendor,
      rootFolderId: access.settings.driveFolderId,
    })
    const uploadUrl = await drive.client.initiateResumableUpload(drive.userEmail, {
      name: fileName.trim().slice(0, 200) || "Trade document",
      mimeType: mimeType || "application/octet-stream",
      parentId: drive.folderId,
      driveId: drive.driveId ?? undefined,
      browserOrigin: await requestOrigin(),
    })
    return { success: true, data: { uploadUrl } }
  } catch (error) {
    return { success: false, error: message(error, "Could not start the upload.") }
  }
}

/**
 * Records a document received from a vendor. It replaces the vendor's current
 * document of that type, which stays in the history.
 */
export async function recordVendorTradeDoc(vendorId: string, input: RecordTradeDocInput): Promise<Result<{ readonly id: string }>> {
  try {
    const access = await tradeDocAccess(true)
    const vendor = await loadVendor(access, vendorId)
    const type = access.settings.docTypes.find((item) => item.id === input.docType)
    if (!type) return { success: false, error: "Choose a document type." }
    if (input.kind === "waiver" && !type.waiverLabel) return { success: false, error: `${type.label} has no accepted alternative.` }
    if (input.kind === "document" && !input.driveFileId) return { success: false, error: "Upload the document first." }

    let file: { readonly id: string; readonly name: string; readonly webUrl: string | null } | null = null
    if (input.driveFileId) {
      // Only accept files in this vendor's own folder, so a record can't point elsewhere.
      const drive = await ensureVendorTradeDocsFolder({
        db: access.db,
        environment: access.env,
        organizationId: access.organizationId,
        user: access.user,
        vendor,
        rootFolderId: access.settings.driveFolderId,
      })
      const driveFile = await drive.client.getFile(drive.userEmail, input.driveFileId)
      if (!driveFile.parents?.includes(drive.folderId)) {
        return { success: false, error: "That file isn't in this vendor's trade docs folder." }
      }
      file = { id: driveFile.id, name: driveFile.name, webUrl: driveFile.webViewLink ?? null }
    }

    const checks = input.checks.filter((check) => access.settings.certificateChecks.includes(check))
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await access.db.batch([
      access.db
        .update(vendorTradeDocuments)
        .set({ supersededAt: now, updatedAt: now })
        .where(and(eq(vendorTradeDocuments.vendorId, vendor.id), eq(vendorTradeDocuments.docType, type.id), isNull(vendorTradeDocuments.supersededAt))),
      access.db.insert(vendorTradeDocuments).values({
        id,
        organizationId: access.organizationId,
        vendorId: vendor.id,
        docType: type.id,
        kind: input.kind,
        driveFileId: file?.id ?? null,
        fileName: file?.name ?? null,
        webUrl: file?.webUrl ?? null,
        effectiveOn: cleanDate(input.effectiveOn),
        expiresOn: type.expires ? cleanDate(input.expiresOn) : null,
        checksJson: checks.length > 0 ? JSON.stringify(checks) : null,
        notes: input.notes?.trim().slice(0, 1000) || null,
        source: "upload",
        createdBy: access.user.id,
        createdByName: actorName(access.user),
        createdAt: now,
        updatedAt: now,
      }),
    ])
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      actor: access.user,
      category: "file",
      action: "trade_doc.recorded",
      entityType: "vendor",
      entityId: vendor.id,
      summary: `${input.kind === "waiver" ? `${type.label} alternative` : type.label} recorded for ${vendor.name}`,
      metadata: { documentId: id, docType: type.id },
    })
    revalidateVendors()
    return { success: true, data: { id } }
  } catch (error) {
    return { success: false, error: message(error, "Could not record the document.") }
  }
}

/** Corrects the dates, certificate checks or notes on a document. */
export async function updateVendorTradeDoc(
  documentId: string,
  input: { readonly effectiveOn: string | null; readonly expiresOn: string | null; readonly checks: readonly string[]; readonly notes: string | null },
): Promise<Result<null>> {
  try {
    const access = await tradeDocAccess(true)
    const row = await access.db
      .select()
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.id, documentId), eq(vendorTradeDocuments.organizationId, access.organizationId)))
      .get()
    if (!row) return { success: false, error: "Document not found." }
    const type = access.settings.docTypes.find((item) => item.id === row.docType)
    const checks = input.checks.filter((check) => access.settings.certificateChecks.includes(check))
    await access.db
      .update(vendorTradeDocuments)
      .set({
        effectiveOn: cleanDate(input.effectiveOn),
        expiresOn: type?.expires === false ? null : cleanDate(input.expiresOn),
        checksJson: checks.length > 0 ? JSON.stringify(checks) : null,
        notes: input.notes?.trim().slice(0, 1000) || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(vendorTradeDocuments.id, row.id))
      .run()
    revalidateVendors()
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not save the document.") }
  }
}

/**
 * Removes a document record (the file stays in Drive). When it was the
 * current one, the newest older document of that type becomes current again.
 */
export async function deleteVendorTradeDoc(documentId: string): Promise<Result<null>> {
  try {
    const access = await tradeDocAccess(true)
    const row = await access.db
      .select()
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.id, documentId), eq(vendorTradeDocuments.organizationId, access.organizationId)))
      .get()
    if (!row) return { success: false, error: "Document not found." }
    const previous = row.supersededAt === null
      ? await access.db
          .select({ id: vendorTradeDocuments.id })
          .from(vendorTradeDocuments)
          .where(and(
            eq(vendorTradeDocuments.vendorId, row.vendorId),
            eq(vendorTradeDocuments.docType, row.docType),
            isNotNull(vendorTradeDocuments.supersededAt),
          ))
          .orderBy(desc(vendorTradeDocuments.createdAt))
          .get()
      : null
    const now = new Date().toISOString()
    const remove = access.db.delete(vendorTradeDocuments).where(eq(vendorTradeDocuments.id, row.id))
    if (previous) {
      await access.db.batch([
        remove,
        access.db.update(vendorTradeDocuments).set({ supersededAt: null, updatedAt: now }).where(eq(vendorTradeDocuments.id, previous.id)),
      ])
    } else {
      await remove.run()
    }
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      actor: access.user,
      category: "file",
      action: "trade_doc.removed",
      entityType: "vendor",
      entityId: row.vendorId,
      summary: `Removed ${row.fileName ?? "a trade document"} from the vendor's trade docs`,
      metadata: { documentId: row.id, docType: row.docType, driveFileId: row.driveFileId },
    })
    revalidateVendors()
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not remove the document.") }
  }
}

/** Flag or hold this vendor's bills while docs are missing; null uses the company default. */
export async function setVendorTradeDocBillMode(vendorId: string, mode: TradeDocBillMode | null): Promise<Result<null>> {
  try {
    const access = await tradeDocAccess(true)
    const vendor = await loadVendor(access, vendorId)
    if (mode !== null && !isTradeDocBillMode(mode)) return { success: false, error: "Choose flag, hold or nothing." }
    await updateVendorById(access.db, {
      vendorId: vendor.id,
      values: { tradeDocsBillMode: mode, updatedAt: new Date().toISOString() },
    })
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      actor: access.user,
      category: "file",
      action: "trade_doc.bill_mode",
      entityType: "vendor",
      entityId: vendor.id,
      summary: `Bills for ${vendor.name} while docs are missing: ${mode ?? "company default"}`,
    })
    revalidateVendors()
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not save the bill setting.") }
  }
}
