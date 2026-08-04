export type TemplateChecklistItemLike = {
  readonly id: string
  readonly sourceItemId: string | null
  readonly parentSourceItemId: string | null
  readonly title: string
  readonly description: string | null
  readonly sortOrder: number
}

export type TemplateChecklistGroup<T extends TemplateChecklistItemLike> = {
  readonly task: T
  readonly checklistItems: readonly T[]
}

function orderedItems<T extends TemplateChecklistItemLike>(
  items: readonly T[]
): readonly T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        left.item.sortOrder - right.item.sortOrder || left.index - right.index
    )
    .map(({ item }) => item)
}

export function groupTemplateChecklistItems<
  T extends TemplateChecklistItemLike,
>(items: readonly T[]): readonly TemplateChecklistGroup<T>[] {
  const bySourceId = new Map<string, T>()
  for (const item of items) {
    if (!item.sourceItemId) continue
    if (bySourceId.has(item.sourceItemId)) {
      throw new Error("Template tasks contain duplicate source identifiers.")
    }
    bySourceId.set(item.sourceItemId, item)
  }

  const childrenByParent = new Map<string, T[]>()
  for (const item of items) {
    if (!item.parentSourceItemId) continue
    const parent = bySourceId.get(item.parentSourceItemId)
    if (!parent) {
      throw new Error("Template checklist item references a missing parent task.")
    }
    if (parent.id === item.id) {
      throw new Error("Template checklist item cannot reference itself.")
    }
    if (parent.parentSourceItemId) {
      throw new Error("Nested template checklists are not supported.")
    }
    const children = childrenByParent.get(parent.id) ?? []
    children.push(item)
    childrenByParent.set(parent.id, children)
  }

  return orderedItems(items)
    .filter((item) => !item.parentSourceItemId)
    .map((task) => ({
      task,
      checklistItems: orderedItems(childrenByParent.get(task.id) ?? []),
    }))
}

export function formatTemplateChecklist(
  items: readonly TemplateChecklistItemLike[]
): string | null {
  if (items.length === 0) return null
  const lines = items.map((item) => {
    const detail = item.description?.trim()
    if (!detail) return `☐ ${item.title.trim()}`
    return `☐ ${item.title.trim()}\n  ${detail.replaceAll("\n", "\n  ")}`
  })
  return `Checklist:\n${lines.join("\n")}`
}
