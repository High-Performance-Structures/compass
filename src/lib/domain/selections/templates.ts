/**
 * Reads and rules for the company choice-template library: listing
 * templates, turning a selection's choices into a template, turning a
 * template's items into choices on a job, and matching CSV supplier names
 * to the company's vendor records. Writes go through template-store and
 * choices-store.
 */
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm"

import { vendors } from "@/db/schema"
import { projectSelectionChoices, projectSelectionLinks, selectionChoiceTemplateItems, selectionChoiceTemplates } from "@/db/schema-selection-choices"
import { chunkD1Values } from "@/lib/d1-query"
import { ownerPriceFromMarkup } from "@/lib/feature-settings/selection-settings"
import type { Db } from "@/lib/server/action-context"

type TemplateItemRow = typeof selectionChoiceTemplateItems.$inferSelect
type ChoiceInsert = typeof projectSelectionChoices.$inferInsert
type TemplateItemInsert = typeof selectionChoiceTemplateItems.$inferInsert

export type ChoiceTemplateSummary = {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly itemCount: number
}

export async function loadChoiceTemplates(db: Db, organizationId: string): Promise<readonly ChoiceTemplateSummary[]> {
  const rows = await db
    .select({
      id: selectionChoiceTemplates.id,
      name: selectionChoiceTemplates.name,
      category: selectionChoiceTemplates.category,
      itemCount: count(selectionChoiceTemplateItems.id),
    })
    .from(selectionChoiceTemplates)
    .leftJoin(selectionChoiceTemplateItems, eq(selectionChoiceTemplateItems.templateId, selectionChoiceTemplates.id))
    .where(eq(selectionChoiceTemplates.organizationId, organizationId))
    .groupBy(selectionChoiceTemplates.id)
    .orderBy(asc(selectionChoiceTemplates.name))
  return rows
}

/** The template's items in order, when the template is the company's. */
export async function loadTemplateItems(
  db: Db,
  organizationId: string,
  templateId: string,
): Promise<{ readonly name: string; readonly category: string | null; readonly items: readonly TemplateItemRow[] } | null> {
  const template = await db
    .select({ name: selectionChoiceTemplates.name, category: selectionChoiceTemplates.category })
    .from(selectionChoiceTemplates)
    .where(and(eq(selectionChoiceTemplates.id, templateId), eq(selectionChoiceTemplates.organizationId, organizationId)))
    .get()
  if (!template) return null
  const items = await db
    .select()
    .from(selectionChoiceTemplateItems)
    .where(eq(selectionChoiceTemplateItems.templateId, templateId))
    .orderBy(asc(selectionChoiceTemplateItems.sortOrder))
  return { ...template, items }
}

/** Ids of the company's templates by lower-case name, so a re-import replaces instead of duplicating. */
export async function templateIdsByName(db: Db, organizationId: string, names: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (names.length === 0) return new Map()
  const chunks = await Promise.all(
    chunkD1Values([...new Set(names)]).map((chunk) =>
      db
        .select({ id: selectionChoiceTemplates.id, name: selectionChoiceTemplates.name })
        .from(selectionChoiceTemplates)
        .where(and(eq(selectionChoiceTemplates.organizationId, organizationId), inArray(selectionChoiceTemplates.name, chunk))),
    ),
  )
  return new Map(chunks.flat().map((row) => [row.name.toLocaleLowerCase(), row.id]))
}

/** The company's active vendors by lower-case name, for matching typed supplier names. */
export async function vendorIdsByName(db: Db, organizationId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
  return new Map(rows.map((row) => [row.name.trim().toLocaleLowerCase(), row.id]))
}

/** A selection's choices (and each one's first product link) as template items. */
export async function selectionChoicesAsTemplateItems(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<readonly Omit<TemplateItemInsert, "id" | "templateId" | "createdAt">[]> {
  const [choices, links] = await Promise.all([
    db
      .select()
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.projectId, projectId), eq(projectSelectionChoices.selectionId, selectionId)))
      .orderBy(asc(projectSelectionChoices.sortOrder)),
    db
      .select({ choiceId: projectSelectionLinks.choiceId, url: projectSelectionLinks.url })
      .from(projectSelectionLinks)
      .where(and(eq(projectSelectionLinks.projectId, projectId), eq(projectSelectionLinks.selectionId, selectionId)))
      .orderBy(asc(projectSelectionLinks.createdAt)),
  ])
  return choices.map((choice, index) => ({
    title: choice.title,
    description: choice.description,
    priceCents: choice.priceCents,
    ownerPriceCents: choice.ownerPriceCents,
    leadTimeDays: choice.leadTimeDays,
    vendorId: choice.vendorId,
    supplierName: choice.supplierName,
    productUrl: links.find((link) => link.choiceId === choice.id)?.url ?? null,
    sortOrder: index,
  }))
}

/**
 * A template's items as new choices at the end of a selection. A blank owner
 * price is filled from the company markup and a blank lead time from the
 * category default, as when staff add a choice by hand.
 */
export function choicesFromTemplate(
  items: readonly TemplateItemRow[],
  target: {
    readonly projectId: string
    readonly selectionId: string
    readonly firstSortOrder: number
    readonly createdBy: string
    readonly now: string
    readonly ownerMarkupPercent: number | null
    readonly categoryLeadTimeDays: number | null
  },
): readonly ChoiceInsert[] {
  return items.map((item, index) => ({
    id: crypto.randomUUID(),
    projectId: target.projectId,
    selectionId: target.selectionId,
    title: item.title,
    description: item.description,
    priceCents: item.priceCents,
    ownerPriceCents: item.ownerPriceCents ?? ownerPriceFromMarkup(item.priceCents, target.ownerMarkupPercent),
    leadTimeDays: item.leadTimeDays ?? target.categoryLeadTimeDays,
    vendorId: item.vendorId,
    supplierName: item.vendorId ? null : item.supplierName,
    sortOrder: target.firstSortOrder + index,
    status: "proposed",
    sourceSystem: "compass_template",
    createdBy: target.createdBy,
    createdAt: target.now,
    updatedAt: target.now,
  }))
}
