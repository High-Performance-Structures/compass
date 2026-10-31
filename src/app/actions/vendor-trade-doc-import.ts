"use server"

import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { vendors } from "@/db/schema"
import { vendorTradeDocuments } from "@/db/schema-trade-docs"
import { insertTradeDocumentStatement, updateTradeDocumentsStatement } from "@/lib/domain/documents/store"
import { recordActivityEvent } from "@/lib/activity-log"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { tradeDocAccess, type TradeDocAccess } from "@/lib/trade-docs/access"
import { scanTradeDocFolder, type TradeDocFolderScan } from "@/lib/trade-docs/drive-scan"
import { IMPORT_LAYOUTS, proposeImports, type ImportLayout, type ImportProposal, type VendorForMatch } from "@/lib/trade-docs/import-match"
import { driveFolderIdFromInput } from "@/lib/trade-docs/settings"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type TradeDocImportScan = {
  readonly folder: { readonly id: string; readonly name: string }
  readonly proposals: readonly ImportProposal[]
  readonly vendors: readonly (VendorForMatch & { readonly category: string })[]
  readonly fileCount: number
  readonly truncated: boolean
}

export type TradeDocImportItem = {
  readonly fileId: string
  readonly vendorId: string
  readonly docType: string
  readonly kind: "document" | "waiver"
  readonly expiresOn: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** D1 caps statements per batch; two statements per imported document. */
const BATCH_ITEMS = 40

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isLayout(value: string): value is ImportLayout {
  return IMPORT_LAYOUTS.some((layout) => layout === value)
}

async function scanFolder(access: TradeDocAccess, folderInput: string): Promise<TradeDocFolderScan> {
  const folderId = driveFolderIdFromInput(folderInput)
  if (!folderId) throw new Error("Paste the Drive folder's link.")
  const drive = await getOrganizationDriveContext({ db: access.db, environment: access.env, organizationId: access.organizationId, user: access.user })
  return scanTradeDocFolder(drive.client, drive.userEmail, folderId)
}

async function directoryVendors(access: TradeDocAccess) {
  return access.db
    .select({ id: vendors.id, name: vendors.name, category: vendors.category })
    .from(vendors)
    .where(and(eq(vendors.organizationId, access.organizationId), eq(vendors.directoryStatus, "active")))
}

/**
 * Looks through a Drive folder of existing trade docs and proposes which
 * vendor and document each file is. Nothing is recorded until staff import
 * the reviewed list.
 */
export async function scanTradeDocImport(input: {
  readonly folder: string
  readonly layout: string
  readonly defaultDocType: string | null
}): Promise<Result<TradeDocImportScan>> {
  try {
    const access = await tradeDocAccess(true)
    if (!isLayout(input.layout)) return { success: false, error: "Choose how the folder is organized." }
    const [scan, vendorRows, recorded] = await Promise.all([
      scanFolder(access, input.folder),
      directoryVendors(access),
      access.db
        .select({ driveFileId: vendorTradeDocuments.driveFileId })
        .from(vendorTradeDocuments)
        .where(eq(vendorTradeDocuments.organizationId, access.organizationId)),
    ])
    const proposals = proposeImports({
      files: scan.files,
      layout: input.layout,
      defaultDocType: input.defaultDocType,
      vendors: vendorRows,
      docTypes: access.settings.docTypes,
      alreadyRecorded: new Set(recorded.flatMap((row) => (row.driveFileId ? [row.driveFileId] : []))),
    })
    return {
      success: true,
      data: {
        folder: scan.folder,
        proposals,
        vendors: [...vendorRows].sort((a, b) => a.name.localeCompare(b.name)),
        fileCount: scan.files.length,
        truncated: scan.truncated,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not look through that folder.") }
  }
}

/**
 * Records the reviewed documents. Files must still be in the scanned folder.
 * An imported document becomes current unless the vendor already has one of
 * that type that expires later; then it goes into the history.
 */
export async function importTradeDocs(input: {
  readonly folder: string
  readonly items: readonly TradeDocImportItem[]
}): Promise<Result<{ readonly imported: number; readonly skipped: number }>> {
  try {
    const access = await tradeDocAccess(true)
    if (input.items.length === 0) return { success: false, error: "Choose at least one document." }
    if (input.items.length > 2000) return { success: false, error: "Import at most 2,000 documents at a time." }
    const [scan, vendorRows, current] = await Promise.all([
      scanFolder(access, input.folder),
      directoryVendors(access),
      access.db
        .select({
          id: vendorTradeDocuments.id,
          vendorId: vendorTradeDocuments.vendorId,
          docType: vendorTradeDocuments.docType,
          driveFileId: vendorTradeDocuments.driveFileId,
          expiresOn: vendorTradeDocuments.expiresOn,
          supersededAt: vendorTradeDocuments.supersededAt,
        })
        .from(vendorTradeDocuments)
        .where(eq(vendorTradeDocuments.organizationId, access.organizationId)),
    ])
    const files = new Map(scan.files.map((file) => [file.id, file]))
    const vendorIds = new Set(vendorRows.map((vendor) => vendor.id))
    const types = new Map(access.settings.docTypes.map((type) => [type.id, type]))
    const existing = new Set(current.map((row) => `${row.vendorId}:${row.docType}:${row.driveFileId ?? ""}`))
    const currentByGroup = new Map(current.filter((row) => row.supersededAt === null).map((row) => [`${row.vendorId}:${row.docType}`, row]))

    // Newest expiry first, so within one import the latest document ends up current.
    const items = [...input.items].sort((a, b) => (b.expiresOn ?? "").localeCompare(a.expiresOn ?? ""))
    const now = new Date().toISOString()
    const actor = (access.user.displayName ?? access.user.email).slice(0, 200)
    const statements = []
    let skipped = 0
    for (const item of items) {
      const file = files.get(item.fileId)
      const type = types.get(item.docType)
      const key = `${item.vendorId}:${item.docType}:${item.fileId}`
      if (!file || !type || !vendorIds.has(item.vendorId) || existing.has(key) || (item.kind === "waiver" && !type.waiverLabel)) {
        skipped += 1
        continue
      }
      existing.add(key)
      const group = `${item.vendorId}:${item.docType}`
      const expiresOn = type.expires && item.expiresOn && DATE.test(item.expiresOn) ? item.expiresOn : null
      const holder = currentByGroup.get(group)
      const becomesCurrent = !holder || !holder.expiresOn || (expiresOn !== null && expiresOn > holder.expiresOn)
      const id = crypto.randomUUID()
      if (becomesCurrent && holder) {
        statements.push(updateTradeDocumentsStatement(access.db, and(eq(vendorTradeDocuments.id, holder.id), isNull(vendorTradeDocuments.supersededAt)), { supersededAt: now, updatedAt: now }))
      }
      if (becomesCurrent) currentByGroup.set(group, { id, vendorId: item.vendorId, docType: item.docType, driveFileId: file.id, expiresOn, supersededAt: null })
      statements.push(
        insertTradeDocumentStatement(access.db, {
          id,
          organizationId: access.organizationId,
          vendorId: item.vendorId,
          docType: type.id,
          kind: item.kind,
          driveFileId: file.id,
          fileName: file.name,
          webUrl: file.webUrl,
          expiresOn,
          source: "import",
          supersededAt: becomesCurrent ? null : now,
          notes: file.folderPath.length > 0 ? `Brought in from ${scan.folder.name} / ${file.folderPath.join(" / ")}` : `Brought in from ${scan.folder.name}`,
          createdBy: access.user.id,
          createdByName: actor,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }
    for (let start = 0; start < statements.length; start += BATCH_ITEMS * 2) {
      const chunk = statements.slice(start, start + BATCH_ITEMS * 2)
      const [first, ...rest] = chunk
      if (first) await access.db.batch([first, ...rest])
    }
    const imported = items.length - skipped
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      actor: access.user,
      category: "file",
      action: "trade_doc.imported",
      entityType: "vendor",
      summary: `Brought in ${imported} trade document${imported === 1 ? "" : "s"} from ${scan.folder.name}`,
      metadata: { folderId: scan.folder.id, imported, skipped },
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { imported, skipped } }
  } catch (error) {
    return { success: false, error: message(error, "Could not bring in the documents.") }
  }
}
