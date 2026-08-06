import { describe, expect, it } from "vitest"

import { selectTemplateTodos } from "@/lib/templates/template-todo-selection"

describe("template to-do selection", () => {
  const todos = [
    { templateContentItemId: "todo-1", title: "First" },
    { templateContentItemId: "todo-2", title: "Second" },
    { templateContentItemId: "todo-3", title: "Third" }
  ]

  it("defaults to importing no template to-dos", () => {
    expect(selectTemplateTodos(todos, [])).toEqual({ selected: [], missingIds: [] })
  })

  it("returns only selected to-dos in template order", () => {
    expect(selectTemplateTodos(todos, ["todo-3", "todo-1", "todo-3"])).toEqual({
      selected: [todos[0], todos[2]],
      missingIds: []
    })
  })

  it("reports selected IDs that do not belong to the template", () => {
    expect(selectTemplateTodos(todos, ["todo-2", "other-template-todo"])).toEqual({
      selected: [todos[1]],
      missingIds: ["other-template-todo"]
    })
  })
})
