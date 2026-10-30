import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects, users, vendorContacts, vendors } from "@/db/schema"
import { tradeLetters, vendorTradeDocuments, type TradeLetter } from "@/db/schema-trade-docs"
import type { AuthUser } from "@/lib/auth"
import { loadContractPacketPdfBranding } from "@/lib/contracts/packet-pdf"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { downloadFoxitExecutedEnvelope } from "@/lib/foxit/esign"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { ensureVendorTradeDocsFolder } from "@/lib/trade-docs/drive"
import { matchVendor } from "@/lib/trade-docs/import-match"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import { driveFileIdFromInput, type TradeDocSettings } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs, type TradeDocSummary } from "@/lib/trade-docs/status"
import { buildTradeLetterPdf, type PreparedTradeLetterPdf } from "@/lib/trade-letters/letter-pdf"
import { fillLetterText, joinWithAnd, longDate, parseScope, parseStringList, type TradeLetterKind } from "@/lib/trade-letters/letter"

type Db = ReturnType<typeof getDb>

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document"

export type TradeVendor = {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly tradeDocsFolderId: string | null
  /** Accounting vendor id, for coding a PO to them. */
  readonly sageVendorId: string | null
}

export type TradeVendorResolver = (input: { readonly email: string | null; readonly name: string }) => TradeVendor | null

/**
 * Finds the directory vendor behind a quote: by the RFQ's email first (the
 * vendor's own or one of its contacts), then by company name. Loads the
 * directory once, for checking many quotes.
 */
export async function tradeVendorResolver(db: Db, organizationId: string): Promise<TradeVendorResolver> {
  const [rows, contacts] = await Promise.all([
    db
      .select({ id: vendors.id, name: vendors.name, category: vendors.category, email: vendors.email, primaryEmail: vendors.primaryEmail, tradeDocsFolderId: vendors.tradeDocsFolderId, sageVendorId: vendors.sageVendorId, sageVendorNumber: vendors.sageVendorNumber })
      .from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"))),
    db
      .select({ vendorId: vendorContacts.vendorId, email: vendorContacts.email })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"))),
  ])
  const toVendor = (row: (typeof rows)[number]): TradeVendor => ({ id: row.id, name: row.name, category: row.category, tradeDocsFolderId: row.tradeDocsFolderId, sageVendorId: row.sageVendorId ?? row.sageVendorNumber })
  return (input) => {
    const email = input.email?.trim().toLowerCase() ?? ""
    if (email) {
      const direct = rows.find((row) => row.email?.trim().toLowerCase() === email || row.primaryEmail?.trim().toLowerCase() === email)
      if (direct) return toVendor(direct)
      const contact = contacts.find((row) => row.email?.trim().toLowerCase() === email)
      const byContact = contact ? rows.find((row) => row.id === contact.vendorId) : undefined
      if (byContact) return toVendor(byContact)
    }
    const match = matchVendor(input.name, rows)
    if (!match || match.score < 70) return null
    const found = rows.find((row) => row.id === match.vendor.id)
    return found ? toVendor(found) : null
  }
}

export async function loadTradeVendor(db: Db, organizationId: string, vendorId: string): Promise<TradeVendor | null> {
  const vendor = await db
    .select({ id: vendors.id, name: vendors.name, category: vendors.category, tradeDocsFolderId: vendors.tradeDocsFolderId, sageVendorId: vendors.sageVendorId, sageVendorNumber: vendors.sageVendorNumber })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)))
    .get()
  if (!vendor) return null
  return { id: vendor.id, name: vendor.name, category: vendor.category, tradeDocsFolderId: vendor.tradeDocsFolderId, sageVendorId: vendor.sageVendorId ?? vendor.sageVendorNumber }
}

/** A vendor's trade doc standing today, and their master agreement if one is on file. */
export async function vendorTradeStanding(db: Db, settings: TradeDocSettings, vendor: TradeVendor): Promise<{ readonly summary: TradeDocSummary; readonly agreementSignedOn: string | null }> {
  const rows = await db
    .select()
    .from(vendorTradeDocuments)
    .where(and(eq(vendorTradeDocuments.vendorId, vendor.id), isNull(vendorTradeDocuments.supersededAt)))
  const docs = rows.map(toTradeDocOnFile)
  const summary = summarizeTradeDocs({ docTypes: settings.docTypes, vendorCategory: vendor.category, docs, today: new Date().toISOString().slice(0, 10) })
  const agreementId = settings.letters.agreementDocTypeId
  const agreement = agreementId ? docs.find((doc) => doc.docType === agreementId) : undefined
  return { summary, agreementSignedOn: agreement ? agreement.effectiveOn ?? agreement.createdAt.slice(0, 10) : null }
}

/** The blank master agreement in Drive, when Settings names one. */
export function agreementFormFileId(settings: TradeDocSettings): string | null {
  const id = settings.letters.agreementDocTypeId
  const type = id ? settings.docTypes.find((item) => item.id === id && item.active) : undefined
  return type ? driveFileIdFromInput(type.formLink) : null
}

async function agreementPdfBytes(input: { readonly db: Db; readonly env: CloudflareEnv; readonly organizationId: string; readonly user: Pick<AuthUser, "email" | "googleEmail">; readonly fileId: string }): Promise<ArrayBuffer> {
  const drive = await getOrganizationDriveContext({ db: input.db, environment: input.env, organizationId: input.organizationId, user: input.user })
  const file = await drive.client.getFile(drive.userEmail, input.fileId)
  const response = file.mimeType === GOOGLE_DOC_MIME
    ? await drive.client.exportFile(drive.userEmail, input.fileId, "application/pdf")
    : await drive.client.downloadFile(drive.userEmail, input.fileId)
  if (!response.ok) throw new Error("Could not open the Trade Contractor Agreement in Drive.")
  if (file.mimeType !== GOOGLE_DOC_MIME && file.mimeType !== "application/pdf") {
    throw new Error("The Trade Contractor Agreement in Settings must be a PDF or a Google Doc.")
  }
  return response.arrayBuffer()
}

/** The letter's PDF with its signature fields, exactly as the trade will see it. */
export async function renderTradeLetterPdf(input: {
  readonly db: Db
  readonly env: CloudflareEnv
  readonly letter: TradeLetter
  readonly user: Pick<AuthUser, "email" | "googleEmail">
}): Promise<PreparedTradeLetterPdf> {
  const { db, env, letter } = input
  const project = await db
    .select({ name: projects.name, projectNumber: projects.projectNumber, address: projects.address })
    .from(projects)
    .where(eq(projects.id, letter.projectId))
    .get()
  if (!project) throw new Error("Project not found.")
  const settings = await readFeatureSettings(db, letter.organizationId, "trade-docs")
  const assets = env.ASSETS
  if (!assets) throw new Error("Cloudflare Assets is unavailable for letter branding.")
  const brand = await loadContractPacketPdfBranding({
    assets,
    origin: new URL(env.WORKOS_REDIRECT_URI).origin,
    projectId: letter.projectId,
    projectNumber: project.projectNumber,
    profiles: await readDepartmentProfiles(db, letter.organizationId),
  })
  const vendor = letter.vendorId ? await loadTradeVendor(db, letter.organizationId, letter.vendorId) : null
  const standing = vendor ? await vendorTradeStanding(db, settings, vendor) : null
  const owed = parseStringList(letter.owedJson)
  const projectLabel = [project.projectNumber, project.name].filter(Boolean).join(" ") + (project.address ? `, ${project.address}` : "")
  const kind: TradeLetterKind = letter.kind === "award" ? "award" : "intent"
  const values: Record<string, string> = {
    company: brand.companyName,
    vendor: letter.vendorName,
    project: projectLabel,
    quote: letter.quoteLabel,
    agreement: letter.includesAgreement
      ? "enclosed with this letter"
      : standing?.agreementSignedOn
        ? `signed ${longDate(standing.agreementSignedOn)}`
        : "which we will send you to sign",
    owed: joinWithAnd(owed),
  }
  const letters = settings.letters
  const agreementPdf = letter.includesAgreement && letter.agreementDriveFileId
    ? await agreementPdfBytes({ db, env, organizationId: letter.organizationId, user: input.user, fileId: letter.agreementDriveFileId })
    : null
  return buildTradeLetterPdf({
    kind,
    letterNumber: letter.letterNumber,
    dateLabel: longDate(letter.createdAt),
    brand,
    vendorName: letter.vendorName,
    signerName: letter.signerName,
    heading: `${kind === "award" ? "Award of work" : "Letter of intent"}: ${projectLabel}`,
    paragraphs: [fillLetterText(kind === "award" ? letters.awardText : letters.intentText, values)],
    scope: parseScope(letter.scopeJson),
    totalCents: letter.totalCents,
    owedParagraph: owed.length > 0 && letters.owedText ? fillLetterText(letters.owedText, values) : null,
    closing: letters.closingText ? fillLetterText(letters.closingText, values) : null,
    note: letter.note,
    companySigner: { name: letter.companySignerName, title: letter.companySignerTitle },
    agreementPdf,
  })
}

/**
 * After both sides sign: saves the signed copy in the vendor's Drive folder
 * and, when the agreement rode along, records it as the vendor's signed
 * agreement. Returns the Drive file id, or null when there's no vendor or
 * Drive isn't reachable (the copy stays available from Foxit).
 */
export async function fileSignedTradeLetter(input: { readonly db: Db; readonly env: CloudflareEnv; readonly letter: TradeLetter; readonly now: string }): Promise<string | null> {
  const { db, env, letter } = input
  if (!letter.vendorId || !letter.foxitEnvelopeId) return null
  const vendor = await loadTradeVendor(db, letter.organizationId, letter.vendorId)
  const sender = letter.createdBy
    ? await db.select({ id: users.id, email: users.email, googleEmail: users.googleEmail }).from(users).where(eq(users.id, letter.createdBy)).get()
    : undefined
  if (!vendor || !sender) return null
  const settings = await readFeatureSettings(db, letter.organizationId, "trade-docs")
  const drive = await ensureVendorTradeDocsFolder({
    db,
    environment: env,
    organizationId: letter.organizationId,
    user: sender,
    vendor,
    rootFolderId: settings.driveFolderId,
  })
  const download = await downloadFoxitExecutedEnvelope({
    clientId: env.FOXIT_ESIGN_CLIENT_ID,
    clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
    envelopeId: letter.foxitEnvelopeId,
  })
  if (!download.ok) throw new Error(`Foxit did not return the signed letter (${download.status}).`)
  const bytes = await download.arrayBuffer()
  const label = letter.kind === "award" ? "Award letter" : "Letter of intent"
  const file = await drive.client.uploadFile(drive.userEmail, {
    name: `${letter.letterNumber} ${label} signed ${input.now.slice(0, 10)}.pdf`,
    mimeType: "application/pdf",
    parentId: drive.folderId,
    driveId: drive.driveId ?? undefined,
    data: new Blob([bytes], { type: "application/pdf" }),
  })
  const agreementType = settings.letters.agreementDocTypeId
  if (letter.includesAgreement && agreementType) {
    const current = await db
      .select({ id: vendorTradeDocuments.id })
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.vendorId, vendor.id), eq(vendorTradeDocuments.docType, agreementType), isNull(vendorTradeDocuments.supersededAt)))
    await db.batch([
      db.insert(vendorTradeDocuments).values({
        id: crypto.randomUUID(),
        organizationId: letter.organizationId,
        vendorId: vendor.id,
        docType: agreementType,
        kind: "document",
        driveFileId: file.id,
        fileName: file.name,
        webUrl: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
        effectiveOn: input.now.slice(0, 10),
        expiresOn: null,
        checksJson: null,
        notes: `Signed with ${letter.letterNumber}.`,
        source: "e_sign",
        supersededAt: null,
        createdBy: letter.createdBy,
        createdByName: "Foxit eSign",
        createdAt: input.now,
        updatedAt: input.now,
      }),
      ...current.map((row) =>
        db.update(vendorTradeDocuments).set({ supersededAt: input.now, updatedAt: input.now }).where(eq(vendorTradeDocuments.id, row.id)),
      ),
    ])
  }
  return file.id
}

export async function findTradeLetterByEnvelope(db: Db, envelopeId: string): Promise<TradeLetter | null> {
  const letter = await db.select().from(tradeLetters).where(eq(tradeLetters.foxitEnvelopeId, envelopeId)).get()
  return letter ?? null
}
