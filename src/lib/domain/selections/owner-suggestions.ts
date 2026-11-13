/**
 * The to-do that asks staff to price an owner's suggested choice (rules in
 * owner-suggestion-rules.ts): "Price owner's suggested choice: <selection>
 * — <choice>", for the job's first selection manager (project manager, else
 * the next role in Settings › Selections; selection-managers.ts), else the
 * company's first active administrator, as a replacement's change-order
 * to-do is. One per suggestion: a second call for the same choice makes
 * nothing, and another suggestion on the same selection gets its own.
 */
import { firstActiveAdmin } from "@/lib/domain/identity/reads"
import type { Db } from "@/lib/server/action-context"

import { ownerSuggestionTodoSubject } from "./owner-suggestion-rules"
import { selectionManagers } from "./selection-managers"
import { ensureSelectionTodo, ownerSuggestionTodoKey } from "./selection-todos"

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
