/**
 * The to-do that asks staff to price an owner's suggested choice (rules in
 * owner-suggestion-rules.ts): "Price owner's suggested choice: <selection>
 * — <choice>", for the job's first selection manager (project manager, else
 * the next role in Settings › Selections; selection-managers.ts), else the
 * company's first active administrator, as a replacement's change-order
 * to-do is. One per suggestion: a second call for the same choice makes
 * nothing, and another suggestion on the same selection gets its own. Once
 * staff price the suggestion (an owner price typed in, or an RFQ quote with
 * the markup), its open to-do is archived: the save did the work.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm"

import { projectSelectionChoices } from "@/db/schema-selection-choices"
import { chunkD1Values } from "@/lib/d1-query"
import { firstActiveAdmin } from "@/lib/domain/identity/reads"
import type { Db } from "@/lib/server/action-context"

import { ownerSuggestionTodoSubject } from "./owner-suggestion-rules"
import { selectionManagers } from "./selection-managers"
import { archiveOwnerSuggestionTodo, ensureSelectionTodo, ownerSuggestionTodoKey } from "./selection-todos"

export async function ensureOwnerSuggestionTodo(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string | null
    readonly selectionId: string
    readonly selectionName: string
    readonly choiceId: string
    readonly choiceTitle: string
    readonly actorId: string
    readonly now: string
  },
): Promise<string | null> {
  const managers = await selectionManagers(db, input.projectId)
  const admin = managers[0] || !input.organizationId ? null : await firstActiveAdmin(db, input.organizationId)
  return ensureSelectionTodo(db, {
    projectId: input.projectId,
    selectionId: input.selectionId,
    selectionName: ownerSuggestionTodoSubject(input.selectionName, input.choiceTitle),
    step: "price_owner_suggestion",
    actorId: input.actorId,
    now: input.now,
    assigneeName: managers[0]?.name ?? admin?.name ?? null,
    onceKey: ownerSuggestionTodoKey(input.choiceId),
    perKey: true,
  })
}

/**
 * Archives the open pricing to-dos of the given choices that are owner
 * suggestions staff have now priced (no longer pending). Others are skipped.
 */
export async function archivePricedSuggestionTodos(
  db: Db,
  projectId: string,
  choices: readonly { readonly choiceId: string; readonly selectionId: string }[],
  now: string,
): Promise<void> {
  const ids = [...new Set(choices.map((choice) => choice.choiceId))]
  if (ids.length === 0) return
  const priced = (
    await Promise.all(
      chunkD1Values(ids).map((chunk) =>
        db
          .select({ id: projectSelectionChoices.id, selectionId: projectSelectionChoices.selectionId })
          .from(projectSelectionChoices)
          .where(
            and(
              eq(projectSelectionChoices.projectId, projectId),
              inArray(projectSelectionChoices.id, chunk),
              isNotNull(projectSelectionChoices.suggestedAt),
              eq(projectSelectionChoices.ownerPricingPending, false),
            ),
          ),
      ),
    )
  ).flat()
  for (const choice of priced) await archiveOwnerSuggestionTodo(db, projectId, choice.selectionId, choice.id, now)
}
