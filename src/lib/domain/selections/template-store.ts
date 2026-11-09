/**
 * The only code that writes the company choice-template library
 * (selection_choice_templates and their items) and the round alert rows
 * (project_selection_round_alerts). No access rules here: callers resolve
 * access first and pass rows scoped to the company or project.
 */
import { and, eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  projectSelectionRoundAlerts,
  selectionChoiceTemplateItems,
  selectionChoiceTemplates,
} from "@/db/schema-selection-choices"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import type { Db } from "@/lib/server/action-context"

type TemplateInsert = typeof selectionChoiceTemplates.$inferInsert
type TemplateItemInsert = typeof selectionChoiceTemplateItems.$inferInsert

/**
 * Saves templates with their items in one batch. A template whose name the
 * company already uses is replaced (its items too), so re-importing a CSV
 * updates rather than duplicates.
 */
export async function upsertChoiceTemplates(
  db: Db,
  templates: readonly { readonly template: TemplateInsert; readonly items: readonly TemplateItemInsert[] }[],
): Promise<void> {
  const statements: BatchItem<"sqlite">[] = []
  for (const { template, items } of templates) {
    statements.push(
      db
        .insert(selectionChoiceTemplates)
        .values(template)
        .onConflictDoUpdate({
          target: [selectionChoiceTemplates.organizationId, selectionChoiceTemplates.name],
          set: { category: template.category, description: template.description, updatedAt: template.updatedAt },
        }),
    )
    // Callers pass the existing template's id when the name is taken, so the items below attach to it.
    statements.push(db.delete(selectionChoiceTemplateItems).where(eq(selectionChoiceTemplateItems.templateId, template.id)))
    for (const item of items) {
      statements.push(db.insert(selectionChoiceTemplateItems).values(item))
    }
  }
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

export async function deleteChoiceTemplate(db: Db, organizationId: string, templateId: string): Promise<void> {
  await db
    .delete(selectionChoiceTemplates)
    .where(and(eq(selectionChoiceTemplates.id, templateId), eq(selectionChoiceTemplates.organizationId, organizationId)))
    .run()
}

/** Moves a merged vendor's template items to the kept vendor. */
export function companyMergeChoiceTemplateStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "vendor") return []
  const guard = companyMoveGuard(move)
  return [
    database
      .prepare(
        `UPDATE selection_choice_template_items SET vendor_id = ?
          WHERE vendor_id = ?
            AND template_id IN (SELECT id FROM selection_choice_templates WHERE organization_id = ?)
            AND ${guard.sql}`,
      )
      .bind(move.destinationId, move.sourceId, move.organizationId, ...guard.binds),
  ]
}

// ---- round alerts

/** Records that the round's "ready to finalize" alert went out; false when it already had. */
export async function recordRoundAlert(db: Db, projectId: string, roundKey: string, now: string): Promise<boolean> {
  const rows = await db
    .insert(projectSelectionRoundAlerts)
    .values({ projectId, roundKey, alertedAt: now })
    .onConflictDoNothing()
    .returning({ roundKey: projectSelectionRoundAlerts.roundKey })
  return rows.length > 0
}

/** Clears the alert record for rounds that are no longer complete, so the next completion alerts again. */
export async function clearRoundAlerts(db: Db, projectId: string, roundKeys: readonly string[]): Promise<void> {
  if (roundKeys.length === 0) return
  await db
    .delete(projectSelectionRoundAlerts)
    .where(and(eq(projectSelectionRoundAlerts.projectId, projectId), inArray(projectSelectionRoundAlerts.roundKey, [...roundKeys])))
    .run()
}
