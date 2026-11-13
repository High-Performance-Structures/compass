"use server"

import { and, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectFinishSelections } from "@/db/schema"
import { actionFailure, errorMessage, type ActionFailure, type ActionResult } from "@/lib/action-result"
import { staffSelectionContext } from "@/lib/domain/selections/access"
import { nextChoiceSortOrder, selectionInProject } from "@/lib/domain/selections/choices-read"
import { insertSelectionChoices, insertSelectionLinks } from "@/lib/domain/selections/choices-store"
import { replacedSelectionIds } from "@/lib/domain/selections/lock-read"
import { checkRoundsReady } from "@/lib/domain/selections/rounds-server"
import { ensureSelectionTodo } from "@/lib/domain/selections/selection-todos"
import { updateFinishSelections } from "@/lib/domain/selections/store"
import { deleteChoiceTemplate as deleteTemplateRow, upsertChoiceTemplates } from "@/lib/domain/selections/template-store"
import {
  choicesFromTemplate,
  loadChoiceTemplates,
  loadTemplateItems,
  selectionChoicesAsTemplateItems,
  templateIdsByName,
  vendorIdsByName,
  type ChoiceTemplateSummary,
} from "@/lib/domain/selections/templates"
import { categoryLeadTimeDays } from "@/lib/feature-settings/selection-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { parseChoiceTemplateCsv } from "@/lib/selections/choice-template-csv"

/*
 * Selection rounds on a job and the company choice-template library. Staff
 * reach them through the staff selections rule. Templates belong to the
 * company; they are managed from any job's Selections page. Reads and rules
 * live in src/lib/domain/selections; writes go through its stores.
 */

type Done = ActionResult<{ readonly count: number }>

function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  revalidatePath(`/preview/projects/${projectId}/owner/selections`)
}

function failure(error: unknown, fallback: string): ActionFailure {
  return actionFailure(errorMessage(error, fallback))
}

// ---- rounds

/** Puts selections into one of the company's rounds (or none), then checks the rounds' readiness. */
export async function assignSelectionRound(projectId: string, selectionIds: readonly string[], roundKey: string | null): Promise<Done> {
  try {
    const context = await staffSelectionContext(projectId, "update")
    const ids = [...new Set(selectionIds)]
    if (ids.length === 0 || ids.length > 90) return { success: false, error: "Choose between 1 and 90 selections." }
    if (roundKey !== null) {
      const settings = await readFeatureSettings(context.db, context.organizationId, "selections")
      if (!settings.rounds.some((round) => round.id === roundKey)) return { success: false, error: "That Selection Phase isn't in Settings › Selections." }
    }
    // Ordered, installed and replaced selections only leave a Selection
    // Phase (never join one), and a replacement stays out of them: its change
    // order is its signature, so a phase would bill the difference twice.
    const count = await updateFinishSelections(
      context.db,
      and(inArray(projectFinishSelections.id, ids), eq(projectFinishSelections.projectId, projectId), roundKey === null ? undefined : isNull(projectFinishSelections.replacesSelectionId)),
      { roundKey, updatedAt: new Date().toISOString() },
      { unlockedOnly: roundKey !== null },
    )
    if (count === 0) return { success: false, error: "Ordered, installed and replacement selections can't change Selection Phase." }
    await checkRoundsReady(context.db, projectId, context.user.id)
    refresh(projectId)
    return { success: true, data: { count } }
  } catch (error) {
    return failure(error, "Unable to change the Selection Phase.")
  }
}

// ---- templates

export async function getChoiceTemplates(projectId: string): Promise<ActionResult<readonly ChoiceTemplateSummary[]>> {
  try {
    const { db, organizationId } = await staffSelectionContext(projectId, "read")
    return { success: true, data: await loadChoiceTemplates(db, organizationId) }
  } catch (error) {
    return failure(error, "Unable to load templates.")
  }
}

/** Saves the selection's choices as a company template (replacing one with the same name). */
export async function saveSelectionAsTemplate(projectId: string, selectionId: string, rawName: string): Promise<Done> {
  try {
    const name = rawName.trim().slice(0, 120)
    if (!name) return { success: false, error: "Name the template." }
    const context = await staffSelectionContext(projectId, "update")
    const { db, organizationId } = context
    const selection = await selectionInProject(db, projectId, selectionId)
    if (!selection) return { success: false, error: "Selection not found" }
    const items = await selectionChoicesAsTemplateItems(db, projectId, selectionId)
    if (items.length === 0) return { success: false, error: "Add choices before saving them as a template." }
    const existing = await templateIdsByName(db, organizationId, [name])
    const templateId = existing.get(name.toLocaleLowerCase()) ?? crypto.randomUUID()
    const now = new Date().toISOString()
    await upsertChoiceTemplates(db, [
      {
        template: { id: templateId, organizationId, name, category: selection.category, description: null, createdBy: context.user.id, createdAt: now, updatedAt: now },
        items: items.map((item) => ({ ...item, id: crypto.randomUUID(), templateId, createdAt: now })),
      },
    ])
    return { success: true, data: { count: items.length } }
  } catch (error) {
    return failure(error, "Unable to save the template.")
  }
}

export type ApplyTemplateTarget =
  | { readonly kind: "selection"; readonly selectionId: string }
  /** Every selection on the job in the template's category. */
  | { readonly kind: "category" }

/** Adds a template's choices after the existing choices of the target selection(s). */
export async function applyChoiceTemplate(projectId: string, templateId: string, target: ApplyTemplateTarget): Promise<Done> {
  try {
    const context = await staffSelectionContext(projectId, "update")
    const { db, organizationId } = context
    const template = await loadTemplateItems(db, organizationId, templateId)
    if (!template) return { success: false, error: "Template not found." }
    if (template.items.length === 0) return { success: false, error: "This template has no choices." }
    const found =
      target.kind === "selection"
        ? await selectionInProject(db, projectId, target.selectionId).then((row) => (row ? [row] : []))
        : await db
            .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, category: projectFinishSelections.category })
            .from(projectFinishSelections)
            .where(eq(projectFinishSelections.projectId, projectId))
            .then((rows) => {
              const wanted = template.category?.trim().toLocaleLowerCase() ?? ""
              return wanted ? rows.filter((row) => row.category.trim().toLocaleLowerCase() === wanted) : []
            })
    // A replaced selection stays on record as it was: no new choices.
    const replaced = await replacedSelectionIds(db, found.map((selection) => selection.id))
    if (target.kind === "selection" && replaced.size > 0) return { success: false, error: "This selection was replaced. Add choices to the replacement." }
    const selections = found.filter((selection) => !replaced.has(selection.id))
    if (selections.length === 0) {
      return { success: false, error: target.kind === "selection" ? "Selection not found" : "No selection on this job has the template's category." }
    }
    if (selections.length > 50) return { success: false, error: "Apply a template to no more than 50 selections at once." }
    const settings = await readFeatureSettings(db, organizationId, "selections")
    const now = new Date().toISOString()
    const sortStarts = await Promise.all(selections.map((selection) => nextChoiceSortOrder(db, selection.id)))
    const plans = selections.map((selection, index) => {
      const choices = choicesFromTemplate(template.items, {
        projectId,
        selectionId: selection.id,
        firstSortOrder: sortStarts[index] ?? 0,
        createdBy: context.user.id,
        now,
        ownerMarkupPercent: settings.ownerMarkupPercent,
        categoryLeadTimeDays: categoryLeadTimeDays(settings, selection.category),
      })
      return { selection, choices }
    })
    const choices = plans.flatMap((plan) => plan.choices)
    await insertSelectionChoices(db, choices)
    await insertSelectionLinks(
      db,
      plans.flatMap((plan) =>
        plan.choices.flatMap((choice, index) => {
          const url = template.items[index]?.productUrl
          return url && choice.id
            ? [{ id: crypto.randomUUID(), projectId, selectionId: plan.selection.id, choiceId: choice.id, url, addedByUserId: context.user.id, addedByAudience: "staff" as const, createdAt: now }]
            : []
        }),
      ),
    )
    // Unpriced choices give the selection a "Price choices" to-do, as when added by hand.
    await Promise.all(
      plans
        .filter((item) => item.choices.some((choice) => choice.priceCents === null || choice.priceCents === undefined))
        .map((plan) =>
          ensureSelectionTodo(db, { projectId, selectionId: plan.selection.id, selectionName: plan.selection.name, step: "price_choices", actorId: context.user.id, now }),
        ),
    )
    refresh(projectId)
    return { success: true, data: { count: choices.length } }
  } catch (error) {
    return failure(error, "Unable to apply the template.")
  }
}

/**
 * Imports templates from CSV text (see choice-template-csv for the
 * columns). A template whose name the company already uses is replaced.
 * Supplier names that match a vendor record link to it. Rows with problems
 * are skipped and reported.
 */
export async function importChoiceTemplatesCsv(
  projectId: string,
  csv: string,
): Promise<ActionResult<{ readonly templates: number; readonly choices: number; readonly errors: readonly string[] }>> {
  try {
    if (csv.length > 2_000_000) return { success: false, error: "The file is too large. Split it into smaller files." }
    const parsed = parseChoiceTemplateCsv(csv)
    if (parsed.templates.length === 0) return { success: false, error: parsed.errors[0] ?? "No templates found in the file." }
    if (parsed.templates.length > 200) return { success: false, error: "Import no more than 200 templates at a time." }
    const context = await staffSelectionContext(projectId, "update")
    const { db, organizationId } = context
    const [existing, vendorIds] = await Promise.all([
      templateIdsByName(db, organizationId, parsed.templates.map((template) => template.name)),
      vendorIdsByName(db, organizationId),
    ])
    const now = new Date().toISOString()
    const rows = parsed.templates.map((template) => {
      const templateId = existing.get(template.name.toLocaleLowerCase()) ?? crypto.randomUUID()
      return {
        template: { id: templateId, organizationId, name: template.name, category: template.category, description: null, createdBy: context.user.id, createdAt: now, updatedAt: now },
        items: template.items.map((item, index) => {
          const vendorId = item.supplierName ? (vendorIds.get(item.supplierName.trim().toLocaleLowerCase()) ?? null) : null
          return {
            id: crypto.randomUUID(),
            templateId,
            title: item.title,
            description: item.description,
            priceCents: item.priceCents,
            ownerPriceCents: item.ownerPriceCents,
            leadTimeDays: item.leadTimeDays,
            vendorId,
            supplierName: vendorId ? null : item.supplierName,
            productUrl: item.productUrl,
            sortOrder: index,
            createdAt: now,
          }
        }),
      }
    })
    await upsertChoiceTemplates(db, rows)
    return {
      success: true,
      data: { templates: rows.length, choices: rows.reduce((total, row) => total + row.items.length, 0), errors: parsed.errors },
    }
  } catch (error) {
    return failure(error, "Unable to import templates.")
  }
}

export async function deleteChoiceTemplate(projectId: string, templateId: string): Promise<Done> {
  try {
    const { db, organizationId } = await staffSelectionContext(projectId, "update")
    await deleteTemplateRow(db, organizationId, templateId)
    return { success: true, data: { count: 1 } }
  } catch (error) {
    return failure(error, "Unable to delete the template.")
  }
}
