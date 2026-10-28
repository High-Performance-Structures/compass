import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { users, vendors } from "@/db/schema"
import { vendorTradeDocLinks, vendorTradeDocuments } from "@/db/schema-trade-docs"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { brandForDepartment, type ProjectBrand } from "@/lib/project-branding"
import { hashQuoteLinkToken, isQuoteLinkTokenShape, quoteLinkIsLive } from "@/lib/rfqs/quote-links"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import { driveFileIdFromInput, type InfoSheetField, type TradeDocSettings, type TradeDocType } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs } from "@/lib/trade-docs/status"
import {
  certificateHolderLines,
  isTradeDocLinkAudience,
  parseRequestedTypes,
  tradeDocLinkItemState,
  type TradeDocLinkAudience,
  type TradeDocLinkItemState,
} from "@/lib/trade-docs/vendor-link"

export type TradeDocLinkContext = {
  readonly db: ReturnType<typeof getDb>
  readonly link: typeof vendorTradeDocLinks.$inferSelect
  readonly audience: TradeDocLinkAudience
  readonly vendor: { readonly id: string; readonly name: string; readonly category: string; readonly tradeDocsFolderId: string | null }
  readonly organizationId: string
  readonly settings: TradeDocSettings
  /** Drive and email act as the staff member who sent the link. */
  readonly sender: { readonly id: string; readonly email: string; readonly googleEmail: string | null; readonly name: string }
  /** Requested document types that are still turned on. */
  readonly types: readonly TradeDocType[]
}

/**
 * Resolves a docs-link token, or null for a wrong, expired or turned-off
 * link, a vendor that's gone, or a sender who no longer works there. Callers
 * show the same "not available" page for all of them.
 */
export async function resolveTradeDocLink(env: CloudflareEnv, token: string, now: Date): Promise<TradeDocLinkContext | null> {
  if (!isQuoteLinkTokenShape(token) || !env?.DB) return null
  const db = getDb(env.DB)
  const tokenHash = await hashQuoteLinkToken(token)
  const link = await db.select().from(vendorTradeDocLinks).where(eq(vendorTradeDocLinks.tokenHash, tokenHash)).get()
  if (!link || !quoteLinkIsLive(link, now) || !isTradeDocLinkAudience(link.audience) || !link.createdBy) return null
  const vendor = await db
    .select({ id: vendors.id, name: vendors.name, category: vendors.category, tradeDocsFolderId: vendors.tradeDocsFolderId, status: vendors.directoryStatus })
    .from(vendors)
    .where(and(eq(vendors.id, link.vendorId), eq(vendors.organizationId, link.organizationId)))
    .get()
  if (!vendor || vendor.status !== "active") return null
  const sender = await db
    .select({ id: users.id, email: users.email, googleEmail: users.googleEmail, displayName: users.displayName, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, link.createdBy))
    .get()
  if (!sender?.isActive) return null
  const settings = await readFeatureSettings(db, link.organizationId, "trade-docs")
  const requested = new Set(parseRequestedTypes(link.requestedJson))
  return {
    db,
    link,
    audience: link.audience,
    vendor: { id: vendor.id, name: vendor.name, category: vendor.category, tradeDocsFolderId: vendor.tradeDocsFolderId },
    organizationId: link.organizationId,
    settings,
    sender: { id: sender.id, email: sender.email, googleEmail: sender.googleEmail, name: sender.displayName ?? link.createdByName },
    types: settings.docTypes.filter((type) => type.active && requested.has(type.id)),
  }
}

export async function tradeDocLinkBrand(context: Pick<TradeDocLinkContext, "db" | "organizationId" | "settings">): Promise<ProjectBrand> {
  // The vendor isn't signed in, so read the company's own profiles.
  const profiles = await readDepartmentProfiles(context.db, context.organizationId)
  return brandForDepartment(context.settings.brandDepartment, profiles)
}

/** The online info sheet, when this link asks for it. */
export function linkInfoSheet(context: TradeDocLinkContext): { readonly type: TradeDocType; readonly fields: readonly InfoSheetField[] } | null {
  if (context.audience !== "vendor") return null
  const typeId = context.settings.infoSheet.docTypeId
  const type = typeId ? context.types.find((item) => item.id === typeId) : undefined
  return type ? { type, fields: context.settings.infoSheet.fields.filter((field) => field.active) } : null
}

export type TradeDocLinkItem = {
  readonly typeId: string
  readonly label: string
  readonly expires: boolean
  readonly state: TradeDocLinkItemState
  readonly waiverLabel: string | null
  readonly hasForm: boolean
  readonly hasWaiverForm: boolean
  /** The info sheet is filled in on the page instead of uploaded. */
  readonly online: boolean
}

/** What a vendor sees on their docs page. */
export type TradeDocLinkView = {
  readonly audience: TradeDocLinkAudience
  readonly companyName: string
  readonly companyContactLines: readonly string[]
  readonly logoSrc: string
  readonly vendorName: string
  readonly senderName: string
  readonly expiresAt: string
  readonly note: string
  readonly certificateHolder: readonly string[]
  readonly items: readonly TradeDocLinkItem[]
  readonly infoSheet: { readonly fields: readonly InfoSheetField[]; readonly certification: string } | null
  readonly uploadsLeft: number
}

export async function tradeDocLinkView(context: TradeDocLinkContext, uploadLimit: number): Promise<TradeDocLinkView> {
  const brand = await tradeDocLinkBrand(context)
  const rows = await context.db
    .select()
    .from(vendorTradeDocuments)
    .where(eq(vendorTradeDocuments.vendorId, context.vendor.id))
    .orderBy(desc(vendorTradeDocuments.createdAt))
  const current = rows.filter((row) => row.supersededAt === null)
  const summary = summarizeTradeDocs({
    docTypes: context.types,
    vendorCategory: context.vendor.category,
    docs: current.map(toTradeDocOnFile),
    today: new Date().toISOString().slice(0, 10),
  })
  // Anything sent through any of this vendor's links since this one was made.
  const received = new Set(
    rows.filter((row) => row.source === "vendor_link" && row.createdAt >= context.link.createdAt).map((row) => row.docType),
  )
  const infoSheet = linkInfoSheet(context)
  const items = context.types.map((type): TradeDocLinkItem => {
    const line = summary.lines.find((item) => item.type.id === type.id)
    return {
      typeId: type.id,
      label: type.label,
      expires: type.expires,
      state: line ? tradeDocLinkItemState(line, received.has(type.id)) : received.has(type.id) ? "received" : "needed",
      waiverLabel: type.waiverLabel,
      hasForm: driveFileIdFromInput(type.formLink) !== null,
      hasWaiverForm: driveFileIdFromInput(type.waiverFormLink) !== null,
      online: infoSheet?.type.id === type.id,
    }
  })
  return {
    audience: context.audience,
    companyName: brand.companyName,
    companyContactLines: brand.contactLines,
    logoSrc: brand.logoSrc,
    vendorName: context.vendor.name,
    senderName: context.sender.name,
    expiresAt: context.link.expiresAt,
    note: context.audience === "vendor" ? context.settings.requestNote : "",
    certificateHolder: certificateHolderLines(context.settings.certificateHolder, brand),
    items,
    infoSheet: infoSheet ? { fields: infoSheet.fields, certification: context.settings.infoSheet.certification } : null,
    uploadsLeft: Math.max(0, uploadLimit - context.link.uploadCount),
  }
}
