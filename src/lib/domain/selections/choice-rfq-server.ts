/**
 * Reads behind "Ask supplier to price" and the price fill-back. The RFQ and
 * its procurement links are still written by the RFQ actions; choice prices
 * are written through the selections choices store.
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import { projectFinishSelections, projectOperations, projects, vendors } from "@/db/schema"
import { projectSelectionChoices, projectSelectionLinks } from "@/db/schema-selection-choices"
import { projectSelectionProcurementLinks } from "@/db/schema-selection-decisions"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import type { CreateRfqScopeLineInput } from "@/lib/domain/operations/types"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"
import { choicePricesFromResponse, choiceRfqScopeLine } from "@/lib/selections/choice-rfq"
import { parseSpecification } from "@/lib/selections/decisions"
import type { Db } from "@/lib/server/action-context"

import { setChoicePricesFromRfq } from "./choices-store"
import { archivePricedSuggestionTodos } from "./owner-suggestions"
import { notifyPriceChangesDuringSignature } from "./price-change-notice"

type FinishSelectionRow = typeof projectFinishSelections.$inferSelect

export type ChoicesForRfq = {
  readonly selection: FinishSelectionRow
  readonly lines: readonly (CreateRfqScopeLineInput & { readonly choiceId: string })[]
}

/** The selection and one scope line per requested choice, in the selection's choice order. */
export async function loadChoicesForRfq(
  db: Db,
  projectId: string,
  selectionId: string,
  choiceIds: readonly string[],
): Promise<ChoicesForRfq> {
  const ids = [...new Set(choiceIds)]
  if (ids.length === 0) throw new Error("Choose at least one choice to price.")
  if (ids.length > 50) throw new Error("Price no more than 50 choices per RFQ.")
  const selection = await db
    .select()
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  if (!selection) throw new Error("Selection not found")
  const [choices, links, catalog] = await Promise.all([
    db
      .select({
        id: projectSelectionChoices.id,
        title: projectSelectionChoices.title,
        description: projectSelectionChoices.description,
        supplierName: projectSelectionChoices.supplierName,
        vendorName: vendors.name,
      })
      .from(projectSelectionChoices)
      .leftJoin(vendors, eq(vendors.id, projectSelectionChoices.vendorId))
      .where(and(eq(projectSelectionChoices.selectionId, selectionId), inArray(projectSelectionChoices.id, ids)))
      .orderBy(asc(projectSelectionChoices.sortOrder)),
    db
      .select({ choiceId: projectSelectionLinks.choiceId, url: projectSelectionLinks.url })
      .from(projectSelectionLinks)
      .where(and(eq(projectSelectionLinks.selectionId, selectionId), inArray(projectSelectionLinks.choiceId, ids)))
      .orderBy(asc(projectSelectionLinks.createdAt)),
    selection.costCode ? loadProjectCostCodeChoices(db, projectId) : Promise.resolve([]),
  ])
  if (choices.length !== ids.length) throw new Error("A choice was not found on this selection.")
  const code = selection.costCode?.trim() || null
  const catalogEntry = code ? catalog.find((entry) => entry.code === code) : undefined
  const forRfq = {
    id: selection.id,
    roomName: selection.roomName,
    name: selection.name,
    quantity: selection.quantity,
    costCode: catalogEntry ? catalogEntry.code : null,
    phaseCode: catalogEntry ? catalogEntry.divisionCode : null,
    freeTextCostCode: catalogEntry ? null : code,
  }
  return {
    selection,
    lines: choices.map((choice) =>
      choiceRfqScopeLine(forRfq, {
        ...choice,
        productUrl: links.find((link) => link.choiceId === choice.id)?.url ?? selection.productUrl,
      }),
    ),
  }
}

/** Every choice id named on the lines belongs to the line's selection on this project. */
export async function choicesBelongToSelections(
  db: Db,
  projectId: string,
  lines: readonly { readonly selectionId?: string | null; readonly choiceId?: string | null }[],
): Promise<boolean> {
  const wanted = lines.flatMap((line) => (line.choiceId ? [{ choiceId: line.choiceId, selectionId: line.selectionId ?? null }] : []))
  if (wanted.length === 0) return true
  const rows = await db
    .select({ id: projectSelectionChoices.id, selectionId: projectSelectionChoices.selectionId })
    .from(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.projectId, projectId), inArray(projectSelectionChoices.id, wanted.map((line) => line.choiceId))))
  const found = new Map(rows.map((row) => [row.id, row.selectionId]))
  return wanted.every((line) => line.selectionId !== null && found.get(line.choiceId) === line.selectionId)
}

/** The choices' current prices, for comparing before and after a fill-back. */
async function choicePrices(db: Db, projectId: string, choiceIds: readonly string[]) {
  return db
    .select({
      id: projectSelectionChoices.id,
      selectionId: projectSelectionChoices.selectionId,
      title: projectSelectionChoices.title,
      priceCents: projectSelectionChoices.priceCents,
      ownerPriceCents: projectSelectionChoices.ownerPriceCents,
    })
    .from(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.projectId, projectId), inArray(projectSelectionChoices.id, [...new Set(choiceIds)])))
}

/**
 * After a supplier answers an RFQ, copies each priced line onto the choice it
 * priced (supplier price; the RFQ's vendor becomes the choice's supplier when
 * it has none). Returns how many choices changed.
 */
async function applyRfqPricesToChoices(db: Db, projectId: string, rfqId: string, now: string): Promise<number> {
  const [rfq, links] = await Promise.all([
    db
      .select({ payload: projectOperations.sagePayloadJson, vendorId: projectOperations.vendorId })
      .from(projectOperations)
      .where(and(eq(projectOperations.id, rfqId), eq(projectOperations.projectId, projectId)))
      .get(),
    db
      .select({ selectionId: projectSelectionProcurementLinks.selectionId, specificationJson: projectSelectionProcurementLinks.specificationJson })
      .from(projectSelectionProcurementLinks)
      .where(and(eq(projectSelectionProcurementLinks.operationId, rfqId), eq(projectSelectionProcurementLinks.projectId, projectId))),
  ])
  if (!rfq || links.length === 0) return 0
  const response = parsePortalRfqPayload(rfq.payload).vendorResponse
  const prices = links.flatMap((link) =>
    choicePricesFromResponse(parseSpecification(link.specificationJson)?.choiceLines ?? [], response).map((price) => ({
      ...price,
      selectionId: link.selectionId,
    })),
  )
  if (prices.length === 0) return 0
  const project = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).get()
  const settings = project?.organizationId ? await readFeatureSettings(db, project.organizationId, "selections") : null
  const ids = prices.map((price) => price.choiceId)
  const before = await choicePrices(db, projectId, ids)
  await setChoicePricesFromRfq(db, projectId, prices, rfq.vendorId, now, settings?.ownerMarkupPercent ?? null)
  // An owner's suggestion the supplier's quote (plus markup) priced: its pricing to-do is archived.
  await archivePricedSuggestionTodos(db, projectId, prices, now)
  // A supplier's new price on a selection out for the owner's signature: the job's managers are told.
  const after = new Map((await choicePrices(db, projectId, ids)).map((row) => [row.id, row]))
  await notifyPriceChangesDuringSignature(db, {
    projectId,
    changes: before.flatMap((row) => {
      const current = after.get(row.id)
      return current
        ? [{ choiceId: row.id, selectionId: row.selectionId, title: row.title, before: row, after: current }]
        : []
    }),
    actor: null,
    now,
  })
  return prices.length
}

/**
 * The fill-back as a side step of saving an RFQ response: the response is
 * already saved, so a failure here is logged, never shown to the supplier.
 */
export async function fillSelectionChoicePrices(db: Db, projectId: string, rfqId: string, now: string): Promise<void> {
  try {
    await applyRfqPricesToChoices(db, projectId, rfqId, now)
  } catch (error) {
    console.error("[selections] RFQ price fill-back failed", error)
  }
}
