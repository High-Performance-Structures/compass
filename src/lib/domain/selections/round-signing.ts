/**
 * Owner signature for a selections round.
 *
 * The round document (one line per selection: room, photo, chosen choice,
 * supplier link, owner price, over/under the allowance; the round total; the
 * change order or variance for the difference; a signature page) is the
 * print page /print/projects/[id]/selections-round. Sending it renders that
 * page to a PDF and prepares a Foxit envelope, the same way estimates and
 * change orders go out for signature: staff open Foxit's sending session,
 * check it, and press Send; Foxit emails the owner signers. One envelope
 * holds one PDF, so the change order or variance is part of the same
 * document and the owner signs once.
 *
 * When Foxit reports the envelope signed, the webhook calls
 * handleRoundSignatureEvent: the signature is marked signed, its selections
 * move to Approved (by the owner, at the signature time), the change order
 * is executed (or the variance approved) and the contract budget rebuilt,
 * the signed PDF is saved to the job's Drive folder, and staff are told.
 *
 * A selection is locked while its current pick is the one an owner signed
 * for. Changing the pick afterwards reopens just that selection; the next
 * signature covers only reopened items. Earlier signed documents stay.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { cookies } from "next/headers"

import { projectContacts, projectFinishSelections, projects } from "@/db/schema"
import { peopleView } from "@/lib/domain/identity/views"
import { projectChangeOrderLines, projectChangeOrders } from "@/db/schema-change-orders"
import { projectSelectionChoices, projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { projectSelectionDecisions } from "@/db/schema-selection-decisions"
import { chunkD1Values } from "@/lib/d1-query"
import { changeOrderStatusStatement } from "@/lib/domain/estimates/change-order-status-store"
import { SELECTION_ROUND_VARIANCE_SOURCE } from "@/lib/domain/estimates/variance-rules"
import {
  approveVariance,
  createVariance,
  projectVarianceSettings,
  saveVarianceLines,
} from "@/lib/domain/estimates/variances"
import { announceEsignOutcome } from "@/lib/esign/announce"
import { prepareEstimateSignaturePdf } from "@/lib/estimates/signature-pdf"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { createFoxitPreparedEnvelope, downloadFoxitExecutedEnvelope } from "@/lib/foxit/esign"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { internalDomainSet, resolveRecordFolder } from "@/lib/paper-trail/folders"
import { PRINT_READY_SELECTOR } from "@/lib/print/print-documents"
import { buildRoundDocument, roundOverageLines, type ContractKind, type RoundDocument, type RoundDocumentLineInput } from "@/lib/selections/round-document"
import type { Db } from "@/lib/server/action-context"

import { pickedByLabel } from "./choice-rules"
import { loadChoicePanels } from "./choices-read"
import { createSelectionChangeOrder, type SelectionChangeOrderActor } from "./selection-change-orders"
import { ensureSelectionTodo } from "./selection-todos"
import { replacedSelectionIds } from "./lock-read"
import { outsidePhaseWork } from "./locks"
import { insertRoundSignatureStatements, roundSignatureTransitionStatement, transitionRoundSignature, updateRoundSignature } from "./round-signature-store"
import { updateFinishSelectionsWithEventStatement } from "./store"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"
import { roomOrderBy } from "@/lib/domain/selections/room-order"

const people = peopleView()

type SignatureRow = typeof projectSelectionRoundSignatures.$inferSelect

export type RoundSigner = { readonly name: string; readonly email: string }

type RoundSignatureView = {
  readonly id: string
  readonly status: SignatureRow["status"]
  readonly sentAt: string | null
  readonly signedAt: string | null
  readonly createdAt: string
  readonly itemCount: number
  readonly deltaCents: number
  readonly treatment: SignatureRow["treatment"]
  readonly changeOrderId: string | null
  readonly changeOrderNumber: string | null
  readonly signedDocumentHref: string | null
  readonly foxitSessionUrl: string | null
}

export type RoundSigningView = {
  readonly roundKey: string
  readonly roundName: string
  readonly project: { readonly name: string; readonly projectNumber: string | null; readonly clientName: string | null; readonly address: string | null }
  readonly contractKind: ContractKind
  readonly thresholdPercent: number
  readonly document: RoundDocument
  /** Newest first. */
  readonly signatures: readonly RoundSignatureView[]
  /** The job's active owner contacts with an email, primary first. */
  readonly ownerContacts: readonly RoundSigner[]
}

function contractKindOf(type: string): ContractKind {
  return type === "fixed_price" ? "fixed_price" : "cost_plus"
}

/** For each selection, the choice its latest owner signature covered. */
export async function signedChoices(db: Db, selectionIds: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
  if (selectionIds.length === 0) return new Map()
  const chunks = await Promise.all(
    chunkD1Values([...selectionIds]).map((ids) =>
      db
        .select({ selectionId: projectSelectionRoundSignatureItems.selectionId, choiceId: projectSelectionRoundSignatureItems.choiceId, signedAt: projectSelectionRoundSignatures.signedAt })
        .from(projectSelectionRoundSignatureItems)
        .innerJoin(projectSelectionRoundSignatures, eq(projectSelectionRoundSignatures.id, projectSelectionRoundSignatureItems.signatureId))
        .where(and(inArray(projectSelectionRoundSignatureItems.selectionId, ids), eq(projectSelectionRoundSignatures.status, "signed")))
        .orderBy(asc(projectSelectionRoundSignatures.signedAt)),
    ),
  )
  // Later signatures overwrite earlier ones.
  return new Map(chunks.flat().map((row) => [row.selectionId, row.choiceId]))
}

export async function loadRoundSigningView(db: Db, projectId: string, organizationId: string, roundKey: string): Promise<RoundSigningView | null> {
  const [settings, project, variance, selections, owners, signatures] = await Promise.all([
    readFeatureSettings(db, organizationId, "selections"),
    db
      .select({ name: projects.name, projectNumber: projects.projectNumber, clientName: projects.clientName, address: projects.address })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get(),
    projectVarianceSettings(db, projectId),
    db
      .select({
        id: projectFinishSelections.id,
        roomName: projectFinishSelections.roomName,
        name: projectFinishSelections.name,
        costCode: projectFinishSelections.costCode,
        status: projectFinishSelections.status,
        ownerApproved: projectFinishSelections.ownerApproved,
        allowanceCents: projectSelectionDecisions.allowanceCents,
      })
      .from(projectFinishSelections)
      .leftJoin(projectSelectionDecisions, eq(projectSelectionDecisions.selectionId, projectFinishSelections.id))
      .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.roundKey, roundKey)))
      .orderBy(...roomOrderBy(), asc(projectFinishSelections.roomName), asc(projectFinishSelections.sortOrder), asc(projectFinishSelections.name)),
    withContactDirectory(db
      .select({ name: resolvedContactColumns.displayName, email: resolvedContactColumns.email })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder)).$dynamic(), organizationId),
    db
      .select({ signature: projectSelectionRoundSignatures, changeOrderNumber: projectChangeOrders.changeOrderNumber })
      .from(projectSelectionRoundSignatures)
      .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectSelectionRoundSignatures.changeOrderId))
      .where(and(eq(projectSelectionRoundSignatures.projectId, projectId), eq(projectSelectionRoundSignatures.roundKey, roundKey)))
      .orderBy(desc(projectSelectionRoundSignatures.createdAt)),
  ])
  const round = settings.rounds.find((item) => item.id === roundKey)
  if (!project || !round) return null
  const ids = selections.map((selection) => selection.id)
  const [panels, signed, itemCounts, replaced] = await Promise.all([
    Promise.all(chunkD1Values(ids).map((chunk) => loadChoicePanels(db, projectId, chunk, "staff", ""))).then((parts) => parts.flat()),
    signedChoices(db, ids),
    signatures.length
      ? db
          .select({ signatureId: projectSelectionRoundSignatureItems.signatureId })
          .from(projectSelectionRoundSignatureItems)
          .where(inArray(projectSelectionRoundSignatureItems.signatureId, signatures.slice(0, 90).map((row) => row.signature.id)))
      : Promise.resolve([]),
    replacedSelectionIds(db, ids),
  ])
  const byId = new Map(panels.map((panel) => [panel.selectionId, panel]))
  const pickOf = (selectionId: string) => byId.get(selectionId)?.choices.find((item) => item.chosen) ?? null
  // Ordered, installed and replaced selections, and older approvals no
  // signature covers, are outside the phase: not signed or billed again.
  const inPhase = selections.filter((selection) => {
    const pick = pickOf(selection.id)
    return !outsidePhaseWork({
      status: selection.status,
      replaced: replaced.has(selection.id),
      ownerApproved: selection.ownerApproved,
      signedCurrentPick: pick !== null && signed.get(selection.id) === pick.id,
      hasPick: pick !== null,
    })
  })
  const lines: RoundDocumentLineInput[] = inPhase.map((selection) => {
    const choice = pickOf(selection.id)
    const link = choice?.links[0] ?? null
    return {
      selectionId: selection.id,
      roomName: selection.roomName,
      selectionName: selection.name,
      choiceId: choice?.id ?? null,
      choiceTitle: choice?.title ?? null,
      choiceDescription: choice?.description ?? null,
      photoId: choice?.photos[0]?.photoId ?? null,
      linkUrl: link?.url ?? null,
      linkSite: link ? (link.siteName ?? hostName(link.url)) : null,
      ownerPriceCents: choice?.ownerPriceCents ?? null,
      allowanceCents: selection.allowanceCents,
      costCode: selection.costCode,
      pickedBy: choice ? pickedByLabel(choice) : null,
      signedEarlier: choice !== null && signed.get(selection.id) === choice.id,
    }
  })
  const contractKind = contractKindOf(variance?.contractType ?? "fixed_price")
  return {
    roundKey,
    roundName: round.name,
    project,
    contractKind,
    thresholdPercent: settings.changeOrderThresholdPercent,
    document: buildRoundDocument(lines, contractKind, settings.changeOrderThresholdPercent),
    ownerContacts: owners.flatMap((owner) => (owner.email?.trim() ? [{ name: owner.name, email: owner.email.trim() }] : [])),
    signatures: signatures.map(({ signature, changeOrderNumber: number }) => ({
      id: signature.id,
      status: signature.status,
      sentAt: signature.sentAt,
      signedAt: signature.signedAt,
      createdAt: signature.createdAt,
      itemCount: itemCounts.filter((item) => item.signatureId === signature.id).length,
      deltaCents: signature.deltaCents,
      treatment: signature.treatment,
      changeOrderId: signature.changeOrderId,
      changeOrderNumber: number,
      signedDocumentHref:
        signature.status === "signed" && signature.foxitEnvelopeId
          ? `/api/integrations/foxit/envelopes/${encodeURIComponent(signature.foxitEnvelopeId)}/document`
          : null,
      foxitSessionUrl: signature.status === "preparing" ? signature.foxitEmbeddedSessionUrl : null,
    })),
  }
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// ---- sending

type Actor = SelectionChangeOrderActor

async function renderRoundPdf(env: CloudflareEnv, projectId: string, roundKey: string, signatureId: string, signerLabels: readonly string[]): Promise<{ readonly pdfBase64: string; readonly fields: Parameters<typeof createFoxitPreparedEnvelope>[0]["fields"] }> {
  const quickAction = Reflect.get(env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") throw new Error("Cloudflare Browser Run is not available for selections PDFs.")
  const requestCookies = await cookies()
  const url = new URL(`/print/projects/${encodeURIComponent(projectId)}/selections-round`, new URL(env.WORKOS_REDIRECT_URI).origin)
  url.searchParams.set("round", roundKey)
  url.searchParams.set("signatureId", signatureId)
  const rendered: unknown = await Reflect.apply(quickAction, env.BROWSER, [
    "pdf",
    {
      url: url.toString(),
      setExtraHTTPHeaders: { Cookie: requestCookies.toString() },
      gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
      waitForSelector: { selector: PRINT_READY_SELECTOR, timeout: 60_000 },
      pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } },
    },
  ])
  if (!(rendered instanceof Response) || !rendered.ok) throw new Error("Unable to render the selections PDF.")
  return prepareEstimateSignaturePdf({ pdf: await rendered.arrayBuffer(), signerLabels })
}

export type PreparedRoundSignature = { readonly signatureId: string; readonly embeddedSessionUrl: string }

/**
 * Prepares the round's owner signature: the change order or variance for the
 * difference, the signature record and its items, the PDF, and the Foxit
 * envelope. Returns Foxit's sending session for staff to review and send.
 */
export async function prepareRoundSignature(input: {
  readonly db: Db
  readonly env: CloudflareEnv
  readonly projectId: string
  readonly organizationId: string
  readonly roundKey: string
  readonly signers: readonly RoundSigner[]
  readonly actor: Actor
}): Promise<PreparedRoundSignature> {
  const { db, env, projectId, actor } = input
  const view = await loadRoundSigningView(db, projectId, input.organizationId, input.roundKey)
  if (!view) throw new Error("Selection Phase not found.")
  if (view.document.blocker) throw new Error(view.document.blocker)
  if (input.signers.length === 0) throw new Error("Choose at least one owner to sign.")
  if (input.signers.length > 4) throw new Error("Send to no more than four signers.")
  const out = view.signatures.find((signature) => signature.status === "sent")
  if (out) throw new Error("This Selection Phase is already out for signature. Cancel it in Foxit before sending a new one.")
  const now = new Date().toISOString()
  // An unsent preparation is replaced by this one.
  for (const stale of view.signatures.filter((signature) => signature.status === "preparing")) {
    await cancelRoundSignature(db, projectId, stale.id, now)
  }

  const overage = roundOverageLines(view.document, view.roundName)
  if (!overage.ok) throw new Error(overage.error)
  const signatureId = crypto.randomUUID()
  let changeOrderId: string | null = null
  if (view.document.treatment === "change_order" && overage.lines.length > 0) {
    // Signature pending: the owner signs it inside the round document.
    const created = await createSelectionChangeOrder(db, {
      projectId,
      sourceType: "selection_round",
      sourceRecordId: signatureId,
      title: `${view.roundName} Selection Phase`,
      scope: `Selections in the ${view.roundName} Selection Phase ${view.document.deltaCents >= 0 ? "over" : "under"} the allowance.`,
      reason: "The owner's selections differ from the allowance.",
      lines: overage.lines,
      history: {
        eventType: "created_from_selection_round",
        note: `Created for the owner's signature on the ${view.roundName} Selection Phase.`,
        metadata: { selectionRoundSignatureId: signatureId },
      },
      actor,
      now,
    })
    changeOrderId = created.id
  } else if (view.document.treatment === "variance" && overage.lines.length > 0) {
    const created = await createVariance({
      db,
      projectId,
      actor,
      title: `${view.roundName} Selection Phase`,
      scope: `Selections in the ${view.roundName} Selection Phase ${view.document.deltaCents >= 0 ? "over" : "under"} the allowance.`,
      reason: "The owner's selections differ from the allowance.",
      // Priced at owner prices (fee included), so approving it adds no builder fee.
      source: { type: SELECTION_ROUND_VARIANCE_SOURCE, recordId: signatureId },
    })
    if (!created.success) throw new Error(created.error)
    const lines = await saveVarianceLines({ db, projectId, changeOrderId: created.id, actor, lines: overage.lines })
    if (!lines.success) throw new Error(lines.error)
    changeOrderId = created.id
  }

  const [firstInsert, ...moreInserts] = insertRoundSignatureStatements(
      db,
      {
        id: signatureId,
        projectId,
        roundKey: view.roundKey,
        roundNameSnapshot: view.roundName,
        status: "preparing",
        signersJsonSnapshot: JSON.stringify(input.signers),
        allowanceCents: view.document.allowanceCents,
        ownerTotalCents: view.document.ownerTotalCents,
        deltaCents: view.document.deltaCents,
        treatment: view.document.treatment,
        changeOrderId,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      },
      view.document.toSign.map((line) => ({
        signatureId,
        selectionId: line.selectionId,
        choiceId: line.choiceId,
        choiceTitleSnapshot: line.choiceTitle ?? "",
        ownerPriceCentsSnapshot: line.ownerPriceCents,
        allowanceCentsSnapshot: line.allowanceCents,
      })),
  )
  if (firstInsert) await db.batch([firstInsert, ...moreInserts])

  try {
    const pdf = await renderRoundPdf(env, projectId, view.roundKey, signatureId, input.signers.map((signer) => signer.name))
    const origin = new URL(env.WORKOS_REDIRECT_URI).origin
    const back = `${origin}/dashboard/projects/${encodeURIComponent(projectId)}/selections`
    const envelope = await createFoxitPreparedEnvelope({
      clientId: env.FOXIT_ESIGN_CLIENT_ID,
      clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
      folderName: `${view.project.projectNumber ?? view.project.name} ${view.roundName} Selection Phase`.slice(0, 120),
      pdfBase64: pdf.pdfBase64,
      parties: input.signers.map((signer, index) => ({ name: signer.name, email: signer.email, sequence: index + 1 })),
      fields: pdf.fields,
      successUrl: back,
      errorUrl: back,
      selectionRoundSignatureId: signatureId,
      sourceHash: signatureId,
    })
    await updateRoundSignature(db, signatureId, "preparing", {
      foxitEnvelopeId: envelope.envelopeId,
      foxitEmbeddedSessionUrl: envelope.embeddedSessionUrl,
      updatedAt: new Date().toISOString(),
    })
    return { signatureId, embeddedSessionUrl: envelope.embeddedSessionUrl }
  } catch (error) {
    await cancelRoundSignature(db, projectId, signatureId, new Date().toISOString())
    throw error
  }
}

/**
 * Cancels (or, when the owner declined, declines) an unsigned signature and
 * voids its draft change order or variance. False when the signature had
 * already moved on (signed, or a retry of the same event).
 */
async function cancelRoundSignature(db: Db, projectId: string, signatureId: string, now: string, event: "cancel" | "decline" = "cancel"): Promise<boolean> {
  const signature = await db
    .select()
    .from(projectSelectionRoundSignatures)
    .where(and(eq(projectSelectionRoundSignatures.id, signatureId), eq(projectSelectionRoundSignatures.projectId, projectId)))
    .get()
  if (!signature) return false
  if (!(await transitionRoundSignature(db, signatureId, signature.status, event, { updatedAt: now }))) return false
  if (signature.changeOrderId) {
    await db.batch([
      changeOrderStatusStatement(db, {
        changeOrderId: signature.changeOrderId,
        event: "cancel_selection_round",
        values: { foxitStatus: "cancelled", updatedAt: now },
      }),
    ])
  }
  return true
}

// ---- Foxit events

export async function findRoundSignatureByEnvelope(db: Db, envelopeId: string): Promise<SignatureRow | null> {
  const row = await db.select().from(projectSelectionRoundSignatures).where(eq(projectSelectionRoundSignatures.foxitEnvelopeId, envelopeId)).get()
  return row ?? null
}

async function fileSignedRoundPdf(db: Db, env: CloudflareEnv, signature: SignatureRow, now: string): Promise<string | null> {
  if (!signature.foxitEnvelopeId) return null
  const project = await db
    .select({ organizationId: projects.organizationId, folderId: projects.googleDriveFolderId, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, signature.projectId))
    .get()
  if (!project?.organizationId || !project.folderId) return null
  const drive = await getProjectDocumentDriveContext({ db, env, organizationId: project.organizationId })
  const settings = await readFeatureSettings(db, project.organizationId, "paper-trail")
  const folder = await resolveRecordFolder({
    db,
    drive,
    projectFolderId: project.folderId,
    category: "selections",
    subfolders: [],
    internalDomains: internalDomainSet(drive.googleEmail, settings.internalDomains),
    now: new Date(now),
  })
  if (!folder.ok) throw new Error(folder.error)
  const download = await downloadFoxitExecutedEnvelope({
    clientId: env.FOXIT_ESIGN_CLIENT_ID,
    clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
    envelopeId: signature.foxitEnvelopeId,
  })
  if (!download.ok) throw new Error(`Foxit did not return the signed selections (${download.status}).`)
  const name = `${project.projectNumber ?? ""} ${signature.roundNameSnapshot} Selection Phase signed ${now.slice(0, 10)}`.replace(/[\\/:*?"<>|]+/g, "-").trim()
  const file = await drive.client.uploadFile(drive.googleEmail, {
    name: `${name}.pdf`,
    parentId: folder.folderId,
    mimeType: "application/pdf",
    data: new Blob([await download.arrayBuffer()], { type: "application/pdf" }),
    appProperties: { compassRecordType: "selection_round_signature", compassRecordId: signature.id },
  })
  return file.id
}

/**
 * Applies a Foxit event to a round signature. Returns whether anything
 * changed (a retry of an applied event changes nothing).
 */
export async function handleRoundSignatureEvent(input: {
  readonly db: Db
  readonly env: CloudflareEnv
  readonly signature: SignatureRow
  readonly event: string
}): Promise<boolean> {
  const { db, env, signature } = input
  const now = new Date().toISOString()
  if (input.event === "folder_sent") {
    return transitionRoundSignature(db, signature.id, signature.status, "send", { sentAt: now, foxitEmbeddedSessionUrl: null, updatedAt: now })
  }
  if (input.event === "folder_declined" || input.event === "folder_cancelled") {
    // Once per signature: a retry, or a signature already signed, changes nothing.
    const event = input.event === "folder_declined" ? "decline" : "cancel"
    if (!(await cancelRoundSignature(db, signature.projectId, signature.id, now, event))) return false
    await announceEsignOutcome({
      db,
      projectId: signature.projectId,
      kind: "selections_round",
      outcome: input.event === "folder_declined" ? "declined" : "cancelled",
      recordId: signature.id,
      number: signature.roundNameSnapshot,
      title: "",
      changeOrderId: null,
      sentBy: signature.createdBy,
    })
    return true
  }
  if (input.event !== "folder_executed") return false
  // Signed exactly once, and only while preparing or sent: a retried webhook,
  // or one for a signature already cancelled or declined (its change order
  // voided), applies nothing below.
  const sign = roundSignatureTransitionStatement(db, signature.id, signature.status, "sign", { signedAt: now, foxitEmbeddedSessionUrl: null, updatedAt: now })
  if (sign === null) return false

  const items = await db
    .select({ selectionId: projectSelectionRoundSignatureItems.selectionId })
    .from(projectSelectionRoundSignatureItems)
    .where(eq(projectSelectionRoundSignatureItems.signatureId, signature.id))
  const evidenceUrl = signature.foxitEnvelopeId ? `/api/integrations/foxit/envelopes/${encodeURIComponent(signature.foxitEnvelopeId)}/document` : null
  // Later statements land only if this request's sign did (same signed_at).
  const signedNow = sql`EXISTS (SELECT 1 FROM ${projectSelectionRoundSignatures} WHERE ${projectSelectionRoundSignatures.id} = ${signature.id} AND ${projectSelectionRoundSignatures.status} = 'signed' AND ${projectSelectionRoundSignatures.signedAt} = ${now})`
  // The owner signed for one pick per selection. A selection whose pick
  // staff changed after the document went out is not approved by it; it
  // stays open for the next signature.
  const pickStillSigned = sql`EXISTS (SELECT 1 FROM ${projectSelectionRoundSignatureItems} INNER JOIN ${projectSelectionChoices} ON ${projectSelectionChoices.id} = ${projectSelectionRoundSignatureItems.choiceId} WHERE ${projectSelectionRoundSignatureItems.signatureId} = ${signature.id} AND ${projectSelectionRoundSignatureItems.selectionId} = ${projectFinishSelections.id} AND ${projectSelectionChoices.chosen} = 1)`
  const statements = [
    sign,
    ...chunkD1Values(items.map((item) => item.selectionId)).map((ids) =>
      updateFinishSelectionsWithEventStatement(
        db,
        and(
          eq(projectFinishSelections.projectId, signature.projectId),
          inArray(projectFinishSelections.id, ids),
          signedNow,
          pickStillSigned,
          // A selection replaced meanwhile isn't approved by it (its replacement is billed by its own change order).
          sql`NOT EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = project_finish_selections.id)`,
        ),
        // Signing never rewinds ordering or installation.
        "owner_sign",
        {
          ownerApproved: true,
          // approved_by names a Compass user; the owner signers are on the signature record.
          approvedBy: null,
          approvedAt: now,
          updatedAt: now,
        },
      ),
    ),
  ]
  const changeOrder = signature.changeOrderId
    ? await db.select({ recordType: projectChangeOrders.recordType, status: projectChangeOrders.status }).from(projectChangeOrders).where(eq(projectChangeOrders.id, signature.changeOrderId)).get()
    : undefined
  if (signature.changeOrderId && changeOrder?.recordType === "change_order") {
    statements.push(
      changeOrderStatusStatement(db, {
        changeOrderId: signature.changeOrderId,
        event: "sign_selection_round",
        also: signedNow,
        values: {
          executedAt: now,
          executedDocumentUrl: evidenceUrl,
          executedDocumentLabel: `${signature.roundNameSnapshot} Selection Phase signed`,
          foxitStatus: "completed",
          updatedAt: now,
        },
      }),
    )
  }
  const [first, ...rest] = statements
  const [signed] = await db.batch([first, ...rest])
  // Another delivery of this event signed it first; it runs the follow-ups.
  if (signed.meta.changes === 0) return false

  await orderTodosForSigned(db, signature, now)

  const sender = signature.createdBy
    ? await db.select({ id: people.id, role: people.role, displayName: people.displayName, email: people.email, firstName: people.firstName, lastName: people.lastName }).from(people).where(eq(people.id, signature.createdBy)).get()
    : undefined
  if (signature.changeOrderId && changeOrder?.recordType === "variance" && sender) {
    const approved = await approveVariance({ db, projectId: signature.projectId, changeOrderId: signature.changeOrderId, actor: sender })
    if (!approved.success) console.error("[selections] variance approval after signing failed", approved.error)
  } else if (signature.changeOrderId && changeOrder?.recordType === "change_order") {
    const budget = await rebuildProjectContractBudget({ db, projectId: signature.projectId, actorUserId: signature.createdBy })
    if (!budget.success) console.error("[selections] contract budget rebuild after signing failed", budget.error)
  }
  try {
    const fileId = await fileSignedRoundPdf(db, env, signature, now)
    if (fileId) await updateRoundSignature(db, signature.id, "signed", { signedDriveFileId: fileId, updatedAt: new Date().toISOString() })
  } catch (error) {
    // The signature stands; the signed PDF stays available from Foxit.
    console.error("[selections] saving the signed selections PDF failed", error)
  }
  await announceEsignOutcome({
    db,
    projectId: signature.projectId,
    kind: "selections_round",
    outcome: "signed",
    recordId: signature.id,
    number: signature.roundNameSnapshot,
    title: "",
    changeOrderId: signature.changeOrderId,
    sentBy: signature.createdBy,
  })
  return true
}

/**
 * The selections this signature approved get staff's "Order" to-do: only a
 * signed document approves a selection, so ordering waits for it (the
 * owner's click only records their choice). A failure is logged; the
 * signature stands.
 */
async function orderTodosForSigned(db: Db, signature: SignatureRow, now: string): Promise<void> {
  try {
    const approved = await db
      .select({ id: projectFinishSelections.id, name: projectFinishSelections.name })
      .from(projectSelectionRoundSignatureItems)
      .innerJoin(projectFinishSelections, eq(projectFinishSelections.id, projectSelectionRoundSignatureItems.selectionId))
      .where(
        and(
          eq(projectSelectionRoundSignatureItems.signatureId, signature.id),
          eq(projectFinishSelections.status, "approved"),
          eq(projectFinishSelections.approvedAt, now),
        ),
      )
    for (const selection of approved) {
      await ensureSelectionTodo(db, { projectId: signature.projectId, selectionId: selection.id, selectionName: selection.name, step: "order", actorId: signature.createdBy, now })
    }
  } catch (error) {
    console.error("[selections] order to-dos after signing failed", error)
  }
}

/** For the print page of a prepared signature: who signs, and the change order or variance it carries. */
export async function loadRoundSignaturePrintParts(
  db: Db,
  projectId: string,
  signatureId: string,
): Promise<{
  readonly signers: readonly RoundSigner[]
  readonly changeOrder: {
    readonly number: string
    readonly recordType: "change_order" | "variance"
    readonly amountCents: number
    readonly lines: readonly { readonly costCode: string | null; readonly description: string; readonly amountCents: number | null }[]
  } | null
} | null> {
  const signature = await db
    .select()
    .from(projectSelectionRoundSignatures)
    .where(and(eq(projectSelectionRoundSignatures.id, signatureId), eq(projectSelectionRoundSignatures.projectId, projectId)))
    .get()
  if (!signature) return null
  const signers = parseSigners(signature.signersJsonSnapshot)
  if (!signature.changeOrderId) return { signers, changeOrder: null }
  const [order, lines] = await Promise.all([
    db
      .select({ number: projectChangeOrders.changeOrderNumber, recordType: projectChangeOrders.recordType, amountCents: projectChangeOrders.amountCents })
      .from(projectChangeOrders)
      .where(eq(projectChangeOrders.id, signature.changeOrderId))
      .get(),
    db
      .select({ costCode: projectChangeOrderLines.costCode, description: projectChangeOrderLines.description, amountCents: projectChangeOrderLines.amountCents })
      .from(projectChangeOrderLines)
      .where(eq(projectChangeOrderLines.changeOrderId, signature.changeOrderId))
      .orderBy(asc(projectChangeOrderLines.lineNumber)),
  ])
  if (!order) return { signers, changeOrder: null }
  return {
    signers,
    changeOrder: {
      number: order.number,
      recordType: order.recordType === "variance" ? "variance" : "change_order",
      amountCents: order.amountCents ?? lines.reduce((total, line) => total + (line.amountCents ?? 0), 0),
      lines,
    },
  }
}

function parseSigners(json: string): readonly RoundSigner[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return []
      const name = Reflect.get(item, "name")
      const email = Reflect.get(item, "email")
      return typeof name === "string" && typeof email === "string" ? [{ name, email }] : []
    })
  } catch {
    return []
  }
}
