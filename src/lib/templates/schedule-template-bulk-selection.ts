import type { ScheduleTemplateItemDefinition } from "./schedule-template-application"

export type BulkScheduleTemplateSelection = {
  readonly templateItemId: string
  readonly templateTodoIds: readonly string[]
}

export type ValidBulkScheduleTemplateSelection = {
  readonly itemIds: readonly string[]
  readonly todoIdsByItem: ReadonlyMap<string, readonly string[]>
}

export type BulkScheduleTemplateSelectionResult =
  | {
      readonly success: true
      readonly data: ValidBulkScheduleTemplateSelection
    }
  | { readonly success: false; readonly error: string }

export function normalizeBulkScheduleTemplateOffsets(
  items: readonly ScheduleTemplateItemDefinition[]
): readonly ScheduleTemplateItemDefinition[] {
  if (items.length === 0) return []

  const firstSelectedOffset = Math.min(
    ...items.map((item) => item.startOffsetWorkdays)
  )
  return items.map((item) => ({
    ...item,
    startOffsetWorkdays: item.startOffsetWorkdays - firstSelectedOffset
  }))
}

export function validateBulkScheduleTemplateSelection(input: {
  readonly selections: readonly BulkScheduleTemplateSelection[]
  readonly availableItemIds: ReadonlySet<string>
  readonly availableTodoIds: ReadonlySet<string>
}): BulkScheduleTemplateSelectionResult {
  if (input.selections.length === 0) {
    return { success: false, error: "Choose at least one schedule item." }
  }
  if (input.selections.length > 500) {
    return {
      success: false,
      error: "A bulk import may contain no more than 500 schedule items."
    }
  }

  const itemIds = new Set<string>()
  const assignedTodoIds = new Set<string>()
  const todoIdsByItem = new Map<string, readonly string[]>()

  for (const selection of input.selections) {
    if (!input.availableItemIds.has(selection.templateItemId)) {
      return {
        success: false,
        error: "One or more selected schedule items are no longer available."
      }
    }
    if (itemIds.has(selection.templateItemId)) {
      return {
        success: false,
        error: "Each template schedule item may only be imported once."
      }
    }
    itemIds.add(selection.templateItemId)

    const selectedTodoIds = new Set<string>()
    for (const todoId of selection.templateTodoIds) {
      if (!input.availableTodoIds.has(todoId)) {
        return {
          success: false,
          error: "One or more selected template to-dos are no longer available."
        }
      }
      if (selectedTodoIds.has(todoId) || assignedTodoIds.has(todoId)) {
        return {
          success: false,
          error: "Each template to-do may only be assigned to one schedule item."
        }
      }
      selectedTodoIds.add(todoId)
      assignedTodoIds.add(todoId)
    }
    todoIdsByItem.set(selection.templateItemId, [...selectedTodoIds])
  }

  return {
    success: true,
    data: {
      itemIds: [...itemIds],
      todoIdsByItem
    }
  }
}
