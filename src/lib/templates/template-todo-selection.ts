export type SelectableTemplateTodo = {
  readonly templateContentItemId: string
}

export type TemplateTodoSelection<T extends SelectableTemplateTodo> = {
  readonly selected: readonly T[]
  readonly missingIds: readonly string[]
}

export function selectTemplateTodos<T extends SelectableTemplateTodo>(
  todos: readonly T[],
  selectedIds: readonly string[]
): TemplateTodoSelection<T> {
  const requestedIds = new Set(selectedIds)
  const availableIds = new Set(todos.map((todo) => todo.templateContentItemId))

  return {
    selected: todos.filter((todo) => requestedIds.has(todo.templateContentItemId)),
    missingIds: [...requestedIds].filter((id) => !availableIds.has(id))
  }
}
