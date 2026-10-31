"use server"

import { and, desc, eq } from "drizzle-orm"

import { getEstimateSelectedTrades, type SelectedTrade } from "@/app/actions/estimate-bids"
import { vendors } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { tradeLetters, type TradeLetter } from "@/db/schema-trade-docs"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { estimateAccess, revalidateEstimate } from "@/lib/domain/estimates/access"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { createFoxitPreparedEnvelope } from "@/lib/foxit/esign"
import { arrayBufferBase64 } from "@/lib/trade-letters/base64"
import { orderedCents, remainingTradeCodes, type TradeCode } from "@/lib/trade-letters/orders"
import { loadTradePurchaseOrders, type TradePurchaseOrder } from "@/lib/trade-letters/orders-server"
import {
  isTradeLetterKind,
  isTradeLetterStatus,
  longDate,
  nextTradeLetterSequence,
  parseScope,
  tradeLetterAvailability,
  tradeLetterNumber,
  tradeLetterRoute,
  type TradeLetterKind,
  type TradeLetterRoute,
  type TradeLetterScopeItem,
  type TradeLetterStatus,
} from "@/lib/trade-letters/letter"
import {
  agreementFormFileId,
  loadTradeVendor,
  renderTradeLetterPdf,
  tradeVendorResolver,
  vendorTradeStanding,
  type TradeVendor,
} from "@/lib/trade-letters/server"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type TradeLetterSummary = {
  readonly id: string
  readonly kind: TradeLetterKind
  readonly letterNumber: string
  readonly status: TradeLetterStatus
  readonly totalCents: number
  readonly signerName: string
  readonly signerEmail: string
  readonly includesAgreement: boolean
  readonly createdAt: string
  readonly sentAt: string | null
  readonly signedAt: string | null
  /** Where the signed copy opens: the vendor's Drive folder copy, else Foxit. */
  readonly signedUrl: string | null
  readonly embeddedSessionUrl: string | null
}

type TradeLetterDocs = {
  readonly requiredCount: number
  readonly goodCount: number
  readonly owed: readonly { readonly id: string; readonly label: string }[]
  readonly expiring: readonly string[]
  readonly agreementSignedOn: string | null
}

export type TradeLetterRow = {
  readonly trade: SelectedTrade
  readonly route: TradeLetterRoute
  readonly vendor: { readonly id: string; readonly name: string; readonly category: string; readonly sageVendorId: string | null } | null
  readonly docs: TradeLetterDocs | null
  readonly letters: readonly TradeLetterSummary[]
  /** Supplier POs drawn against this accepted quote (route purchase_order). */
  readonly orders: readonly TradePurchaseOrder[]
  readonly orderedCents: number
  /** The accepted codes, less what's already on POs. */
  readonly leftToOrder: readonly TradeCode[]
}

export type TradeLetterBoard = {
  readonly ownerSigned: boolean
  readonly ownerStatus: string
  readonly rows: readonly TradeLetterRow[]
  readonly agreementFormSet: boolean
  /** The document type that is the master agreement. */
  readonly agreementDocTypeId: string | null
  readonly canEdit: boolean
}

export type TradeLetterInput = {
  readonly rfqId: string
  readonly kind: TradeLetterKind
  readonly vendorId: string | null
  /** Indexes into the trade's accepted codes. */
  readonly codeIndexes: readonly number[]
  readonly signerName: string
  readonly signerEmail: string
  readonly companySignerTitle: string
  readonly note: string
  readonly includeAgreement: boolean
}

export type TradeLetterComposerDefaults = {
  readonly vendorOptions: readonly { readonly id: string; readonly name: string; readonly category: string }[]
  readonly companySignerName: string
  readonly companySignerEmail: string
  readonly companySignerTitle: string
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function shortDate(iso: string): string {
  return longDate(iso.slice(0, 10))
}

function summarize(letter: TradeLetter): TradeLetterSummary {
  const status: TradeLetterStatus = isTradeLetterStatus(letter.status) ? letter.status : "draft"
  return {
    id: letter.id,
    kind: letter.kind === "award" ? "award" : "intent",
    letterNumber: letter.letterNumber,
    status,
    totalCents: letter.totalCents,
    signerName: letter.signerName,
    signerEmail: letter.signerEmail,
    includesAgreement: letter.includesAgreement,
    createdAt: letter.createdAt,
    sentAt: letter.sentAt,
    signedAt: letter.signedAt,
    signedUrl: status !== "signed"
      ? null
      : letter.signedDriveFileId
        ? `https://drive.google.com/file/d/${letter.signedDriveFileId}/view`
        : letter.foxitEnvelopeId
          ? `/api/integrations/foxit/envelopes/${encodeURIComponent(letter.foxitEnvelopeId)}/document`
          : null,
    embeddedSessionUrl: status === "preparing" ? letter.foxitEmbeddedSessionUrl : null,
  }
}

async function staffAccess(projectId: string, write: boolean) {
  const access = await estimateAccess(projectId, write)
  if (!isInternalStaffRole(access.user.role)) throw new Error("Letters to trades are for office staff.")
  if (!access.organizationId) throw new Error("The project organization is required.")
  return { ...access, organizationId: access.organizationId }
}

async function estimateState(db: Awaited<ReturnType<typeof staffAccess>>["db"], projectId: string, estimateId: string): Promise<{ readonly ownerSigned: boolean; readonly ownerStatus: string }> {
  const estimate = await db
    .select({ status: projectEstimates.status, acceptedAt: projectEstimates.acceptedAt, signatureRequestedAt: projectEstimates.signatureRequestedAt })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId)))
    .get()
  if (!estimate) throw new Error("Estimate not found.")
  if (estimate.status === "accepted") {
    return { ownerSigned: true, ownerStatus: estimate.acceptedAt ? `The owner signed ${shortDate(estimate.acceptedAt)}.` : "The owner has signed." }
  }
  if (estimate.status === "signature_pending") {
    return {
      ownerSigned: false,
      ownerStatus: estimate.signatureRequestedAt ? `Sent to the owner for signature ${shortDate(estimate.signatureRequestedAt)}.` : "Out to the owner for signature.",
    }
  }
  return { ownerSigned: false, ownerStatus: "The owner hasn't signed this estimate yet." }
}

/** Selected trades with their trade doc standing and the letters sent to each. */
export async function getTradeLetterBoard(projectId: string, estimateId: string): Promise<Result<TradeLetterBoard>> {
  try {
    const access = await staffAccess(projectId, false)
    const trades = await getEstimateSelectedTrades(projectId, estimateId)
    if (!trades.success) return trades
    const [state, settings, letters] = await Promise.all([
      estimateState(access.db, projectId, estimateId),
      readFeatureSettings(access.db, access.organizationId, "trade-docs"),
      access.db
        .select()
        .from(tradeLetters)
        .where(and(eq(tradeLetters.projectId, projectId), eq(tradeLetters.estimateId, estimateId)))
        .orderBy(desc(tradeLetters.createdAt)),
    ])
    const resolveVendor = await tradeVendorResolver(access.db, access.organizationId)
    const supplierRfqIds = trades.data
      .filter((trade) => tradeLetterRoute({ ownerScope: trade.ownerScope, sageCostTypes: trade.sageCostTypes }) === "purchase_order")
      .map((trade) => trade.rfqId)
    const ordersByRfq = await loadTradePurchaseOrders(access.db, projectId, supplierRfqIds)
    const rows: TradeLetterRow[] = []
    for (const trade of trades.data) {
      const route = tradeLetterRoute({ ownerScope: trade.ownerScope, sageCostTypes: trade.sageCostTypes })
      const tradeLettersForRfq = letters.filter((letter) => letter.rfqOperationId === trade.rfqId)
      const linkedVendorId = tradeLettersForRfq.find((letter) => letter.vendorId)?.vendorId ?? null
      let vendor: TradeVendor | null = null
      if (route !== "none") {
        vendor = linkedVendorId
          ? await loadTradeVendor(access.db, access.organizationId, linkedVendorId)
          : resolveVendor({ email: trade.recipientEmail, name: trade.vendor })
      }
      const standing = vendor ? await vendorTradeStanding(access.db, settings, vendor) : null
      const orders = ordersByRfq.get(trade.rfqId) ?? []
      rows.push({
        trade,
        route,
        vendor: vendor ? { id: vendor.id, name: vendor.name, category: vendor.category, sageVendorId: vendor.sageVendorId } : null,
        docs: standing
          ? {
              requiredCount: standing.summary.requiredCount,
              goodCount: standing.summary.goodCount,
              owed: standing.summary.owed.map((line) => ({ id: line.type.id, label: line.type.label })),
              expiring: standing.summary.lines.filter((line) => line.required && line.state === "expiring").map((line) => line.type.label),
              agreementSignedOn: standing.agreementSignedOn,
            }
          : null,
        letters: tradeLettersForRfq.map(summarize),
        orders,
        orderedCents: orderedCents(orders),
        leftToOrder: remainingTradeCodes(trade.codes, orders),
      })
    }
    return {
      success: true,
      data: { ...state, rows, agreementFormSet: agreementFormFileId(settings) !== null, agreementDocTypeId: settings.letters.agreementDocTypeId, canEdit: access.canEdit },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the letters.") }
  }
}

/** What the letter composer needs: the vendor directory and who signs for the company. */
export async function getTradeLetterComposerDefaults(projectId: string): Promise<Result<TradeLetterComposerDefaults>> {
  try {
    const access = await staffAccess(projectId, true)
    const [rows, settings] = await Promise.all([
      access.db
        .select({ id: vendors.id, name: vendors.name, category: vendors.category })
        .from(vendors)
        .where(and(eq(vendors.organizationId, access.organizationId), eq(vendors.directoryStatus, "active")))
        .orderBy(vendors.name),
      readFeatureSettings(access.db, access.organizationId, "trade-docs"),
    ])
    return {
      success: true,
      data: {
        vendorOptions: rows,
        companySignerName: access.user.displayName ?? access.user.email,
        companySignerEmail: access.user.email,
        companySignerTitle: settings.letters.companySignerTitle,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not open the letter.") }
  }
}

/**
 * Writes a letter for one selected trade as a draft. Saving again over a
 * draft (or one not yet sent from Foxit) replaces it, so staff can fix it
 * before sending.
 */
export async function saveTradeLetter(projectId: string, estimateId: string, input: TradeLetterInput, letterId: string | null): Promise<Result<{ readonly id: string }>> {
  try {
    const access = await staffAccess(projectId, true)
    if (!isTradeLetterKind(input.kind)) return { success: false, error: "Choose the kind of letter." }
    const state = await estimateState(access.db, projectId, estimateId)
    const availability = tradeLetterAvailability(input.kind, state.ownerSigned)
    if (!availability.allowed) return { success: false, error: availability.reason }
    const trades = await getEstimateSelectedTrades(projectId, estimateId)
    if (!trades.success) return trades
    const trade = trades.data.find((item) => item.rfqId === input.rfqId)
    if (!trade) return { success: false, error: "That trade is no longer selected on this estimate." }
    if (tradeLetterRoute({ ownerScope: trade.ownerScope, sageCostTypes: trade.sageCostTypes }) !== "letter") {
      return { success: false, error: "Letters are for subcontracted work. Suppliers get purchase orders, and owner scope is in the owner contract." }
    }
    const indexes = [...new Set(input.codeIndexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < trade.codes.length)
    if (indexes.length === 0) return { success: false, error: "Choose at least one cost code." }
    const scope: TradeLetterScopeItem[] = indexes.map((index) => {
      const code = trade.codes[index]
      return { costCode: code?.costCode ?? null, description: code?.description ?? "", amountCents: code?.amountCents ?? 0 }
    })
    const signerName = input.signerName.trim().slice(0, 120)
    const signerEmail = normalizeRecipientEmail(input.signerEmail)
    if (!signerName) return { success: false, error: "Enter who signs for the trade." }
    if (!isValidRecipientEmail(signerEmail)) return { success: false, error: "Enter a valid email for the trade's signer." }
    const companySignerEmail = normalizeRecipientEmail(access.user.email)
    if (signerEmail === companySignerEmail) return { success: false, error: "The trade's signer needs a different email from yours." }

    const settings = await readFeatureSettings(access.db, access.organizationId, "trade-docs")
    const vendor = input.vendorId
      ? await loadTradeVendor(access.db, access.organizationId, input.vendorId)
      : (await tradeVendorResolver(access.db, access.organizationId))({ email: trade.recipientEmail, name: trade.vendor })
    if (input.vendorId && !vendor) return { success: false, error: "Vendor not found." }
    const standing = vendor ? await vendorTradeStanding(access.db, settings, vendor) : null
    const agreementId = settings.letters.agreementDocTypeId
    const agreementFile = agreementFormFileId(settings)
    // The agreement is signed once per trade; it only rides along when they don't have one.
    const includeAgreement = input.includeAgreement && agreementFile !== null && !standing?.agreementSignedOn
    const owed = (standing?.summary.owed ?? [])
      .filter((line) => !(includeAgreement && line.type.id === agreementId))
      .map((line) => line.type.label)

    const now = new Date().toISOString()
    const quoteLabel = [trade.rfqNumber ?? "your quote", trade.quoteSubmittedAt ? `dated ${shortDate(trade.quoteSubmittedAt)}` : null].filter(Boolean).join(", ")
    const values = {
      vendorId: vendor?.id ?? null,
      vendorName: vendor?.name ?? trade.vendor,
      kind: input.kind,
      scopeJson: JSON.stringify(scope),
      totalCents: scope.reduce((sum, item) => sum + item.amountCents, 0),
      quoteLabel,
      owedJson: JSON.stringify(owed),
      note: input.note.trim().slice(0, 2000) || null,
      includesAgreement: includeAgreement,
      agreementDriveFileId: includeAgreement ? agreementFile : null,
      signerName,
      signerEmail,
      companySignerName: (access.user.displayName ?? access.user.email).slice(0, 120),
      companySignerEmail,
      companySignerTitle: input.companySignerTitle.trim().slice(0, 80) || null,
      updatedAt: now,
    }

    if (letterId) {
      const existing = await access.db
        .select()
        .from(tradeLetters)
        .where(and(eq(tradeLetters.id, letterId), eq(tradeLetters.projectId, projectId)))
        .get()
      if (!existing) return { success: false, error: "Letter not found." }
      if (existing.status !== "draft" && existing.status !== "preparing") {
        return { success: false, error: "This letter has already gone out. Write a new one instead." }
      }
      if (existing.kind !== input.kind) return { success: false, error: "Write a new letter to change its kind." }
      await access.db
        .update(tradeLetters)
        .set({ ...values, status: "draft", foxitEnvelopeId: null, foxitEmbeddedSessionUrl: null })
        .where(eq(tradeLetters.id, existing.id))
        .run()
      revalidateEstimate(projectId)
      return { success: true, data: { id: existing.id } }
    }

    const numbers = await access.db
      .select({ letterNumber: tradeLetters.letterNumber })
      .from(tradeLetters)
      .where(eq(tradeLetters.organizationId, access.organizationId))
    const id = crypto.randomUUID()
    await access.db
      .insert(tradeLetters)
      .values({
        ...values,
        id,
        organizationId: access.organizationId,
        projectId,
        estimateId,
        rfqOperationId: trade.rfqId,
        letterNumber: tradeLetterNumber(input.kind, nextTradeLetterSequence(input.kind, numbers.map((row) => row.letterNumber))),
        status: "draft",
        createdBy: access.user.id,
        createdByName: (access.user.displayName ?? access.user.email).slice(0, 200),
        createdAt: now,
      })
      .run()
    revalidateEstimate(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return { success: false, error: message(error, "Could not save the letter.") }
  }
}

/**
 * Puts the letter in Foxit for e-signature: the trade signs first, then the
 * company. Returns Foxit's sending page, where staff check it and press Send.
 */
export async function prepareTradeLetterSignature(projectId: string, letterId: string): Promise<Result<{ readonly embeddedSessionUrl: string }>> {
  try {
    const access = await staffAccess(projectId, true)
    const { env } = await getCloudflareContext()
    const letter = await access.db
      .select()
      .from(tradeLetters)
      .where(and(eq(tradeLetters.id, letterId), eq(tradeLetters.projectId, projectId)))
      .get()
    if (!letter) return { success: false, error: "Letter not found." }
    if (letter.status !== "draft" && letter.status !== "preparing") {
      return { success: false, error: "This letter has already gone out." }
    }
    const state = await estimateState(access.db, projectId, letter.estimateId)
    const availability = tradeLetterAvailability(letter.kind === "award" ? "award" : "intent", state.ownerSigned)
    if (!availability.allowed) return { success: false, error: availability.reason }
    const clientId = env.FOXIT_ESIGN_CLIENT_ID?.trim()
    const clientSecret = env.FOXIT_ESIGN_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return { success: false, error: "Foxit eSign credentials are not configured for Compass." }

    const prepared = await renderTradeLetterPdf({ db: access.db, env, letter, user: access.user })
    const origin = new URL(env.WORKOS_REDIRECT_URI).origin
    const successUrl = new URL(`/dashboard/projects/${projectId}/estimate`, origin)
    successUrl.searchParams.set("estimateId", letter.estimateId)
    successUrl.searchParams.set("foxit", "sent")
    const errorUrl = new URL(successUrl)
    errorUrl.searchParams.set("foxit", "error")
    const foxit = await createFoxitPreparedEnvelope({
      clientId,
      clientSecret,
      folderName: `${letter.letterNumber} ${letter.vendorName}`.slice(0, 120),
      pdfBase64: arrayBufferBase64(prepared.pdfBytes),
      parties: [
        { name: letter.signerName, email: letter.signerEmail, sequence: 1 },
        { name: letter.companySignerName, email: letter.companySignerEmail, sequence: 2 },
      ],
      fields: prepared.fields,
      successUrl: successUrl.toString(),
      errorUrl: errorUrl.toString(),
      estimateId: letter.estimateId,
      tradeLetterId: letter.id,
      sourceHash: letter.updatedAt,
      signInSequence: true,
    })
    await access.db
      .update(tradeLetters)
      .set({ status: "preparing", foxitEnvelopeId: foxit.envelopeId, foxitEmbeddedSessionUrl: foxit.embeddedSessionUrl, updatedAt: new Date().toISOString() })
      .where(eq(tradeLetters.id, letter.id))
      .run()
    revalidateEstimate(projectId)
    return { success: true, data: { embeddedSessionUrl: foxit.embeddedSessionUrl } }
  } catch (error) {
    return { success: false, error: message(error, "Could not prepare the letter for signature.") }
  }
}

/**
 * Removes a letter. A signed letter stays in the vendor's Drive folder and in
 * Foxit; one out for signature must also be cancelled in Foxit.
 */
export async function deleteTradeLetter(projectId: string, letterId: string): Promise<Result<null>> {
  try {
    const access = await staffAccess(projectId, true)
    const letter = await access.db
      .select()
      .from(tradeLetters)
      .where(and(eq(tradeLetters.id, letterId), eq(tradeLetters.projectId, projectId)))
      .get()
    if (!letter) return { success: false, error: "Letter not found." }
    await access.db.delete(tradeLetters).where(eq(tradeLetters.id, letter.id)).run()
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "financial",
      action: "trade_letter_deleted",
      entityType: "trade_letter",
      entityId: letter.id,
      summary: `${access.user.displayName ?? access.user.email} deleted ${letter.letterNumber} to ${letter.vendorName} (${letter.status}).`,
    })
    revalidateEstimate(projectId)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not delete the letter.") }
  }
}

/** The saved letter for reopening the composer. */
export async function getTradeLetter(projectId: string, letterId: string): Promise<Result<TradeLetterInput & { readonly id: string; readonly status: TradeLetterStatus }>> {
  try {
    const access = await staffAccess(projectId, false)
    const letter = await access.db
      .select()
      .from(tradeLetters)
      .where(and(eq(tradeLetters.id, letterId), eq(tradeLetters.projectId, projectId)))
      .get()
    if (!letter) return { success: false, error: "Letter not found." }
    const trades = await getEstimateSelectedTrades(projectId, letter.estimateId)
    const trade = trades.success ? trades.data.find((item) => item.rfqId === letter.rfqOperationId) : undefined
    const scope = parseScope(letter.scopeJson)
    const codeIndexes = (trade?.codes ?? []).flatMap((code, index) =>
      scope.some((item) => item.costCode === code.costCode && item.description === code.description) ? [index] : [],
    )
    return {
      success: true,
      data: {
        id: letter.id,
        status: isTradeLetterStatus(letter.status) ? letter.status : "draft",
        rfqId: letter.rfqOperationId,
        kind: letter.kind === "award" ? "award" : "intent",
        vendorId: letter.vendorId,
        codeIndexes,
        signerName: letter.signerName,
        signerEmail: letter.signerEmail,
        companySignerTitle: letter.companySignerTitle ?? "",
        note: letter.note ?? "",
        includeAgreement: letter.includesAgreement,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not open the letter.") }
  }
}
