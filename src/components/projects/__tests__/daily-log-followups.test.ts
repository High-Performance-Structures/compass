import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  DailyLogBlockedTodos,
  DailyLogClientContacts,
  DailyLogLineTodos,
  DailyLogTodoChecklist,
} from "@/components/projects/daily-log-followups"
import {
  DEFAULT_DAILY_LOG_FOLLOW_UP_RULES,
  EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT,
  emptyClientContactRow,
  lineTodoKey,
  type DailyLogOpenTodo,
} from "@/lib/daily-logs/log-followups"

const rules = DEFAULT_DAILY_LOG_FOLLOW_UP_RULES
const noop = (): void => undefined
const todos: readonly DailyLogOpenTodo[] = [
  { id: "t1", title: "Second-floor joists", status: "open", recordType: "staff_task", assigneeName: "Dan", companyName: null, costCode: "06 11 00", changedOn: "2026-10-12" },
  { id: "t2", title: "Framing inspection", status: "blocked", recordType: "staff_task", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-10-12" },
]
const costCodes = [{ code: "06 11 00", name: "Wood Framing", label: "06 11 00 Wood Framing", group: "" }]

describe("daily log to-do and client contact fields", () => {
  it("asks about blocked to-dos with pressed state", () => {
    const html = renderToStaticMarkup(
      createElement(DailyLogBlockedTodos, { todos: todos.filter((todo) => todo.id === "t2"), draft: { ...EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, blocked: { t2: "still" } }, onChange: noop }),
    )
    expect(html).toContain("Framing inspection")
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("Cleared today")
  })

  it("shows a ticked to-do moving to In progress, with its cost code", () => {
    const html = renderToStaticMarkup(
      createElement(DailyLogTodoChecklist, { idPrefix: "log", todos: todos.filter((todo) => todo.id === "t1"), costCodes, rules, worked: ["t1"], onToggle: noop }),
    )
    expect(html).toContain("Staff · Dan · Open → In progress · 06 11 00 Wood Framing")
    expect(html).toContain("It never marks a to-do finished")
  })

  it("offers Make to-do per line, and pickers once flagged", () => {
    const key = lineTodoKey("issues", "Short on subfloor")
    const draft = { ...EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, lineTodos: { [key]: { recordType: "supplier_task" as const, assigneeName: "", costCode: "" } } }
    const html = renderToStaticMarkup(
      createElement(DailyLogLineTodos, {
        idPrefix: "log",
        source: "issues",
        text: "Short on subfloor\nPlumber no-show",
        rules,
        draft,
        assignees: [{ name: "Nu-Tech", kind: "supplier_task" }],
        costCodes,
        onChange: noop,
      }),
    )
    expect(html).toContain("To-do ✓")
    expect(html).toContain("Make to-do")
    expect(html).toContain("Assign to")
    expect(html).toContain("Cost code")
  })

  it("renders nothing for lines when to-dos from logs are off", () => {
    const html = renderToStaticMarkup(
      createElement(DailyLogLineTodos, { idPrefix: "log", source: "notes", text: "Call county", rules: { ...rules, todoMode: "off" }, draft: EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, assignees: [], costCodes: [], onChange: noop }),
    )
    expect(html).toBe("")
  })

  it("suggests client contact from Visitors and counts down the summary", () => {
    const contacts = [{ id: "c1", name: "Jordan Bishop", role: "Owner" }]
    const suggested = renderToStaticMarkup(
      createElement(DailyLogClientContacts, { idPrefix: "log", rules, contacts, visitorLog: "J. Bishop walked the floor", draft: EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, errors: new Map(), onChange: noop }),
    )
    expect(suggested).toContain("Visitors mentions Jordan Bishop, owner. Log it as client contact?")

    const draft = { ...EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, contacts: [{ ...emptyClientContactRow("k1", "c1"), summary: "Called" }] }
    const editing = renderToStaticMarkup(
      createElement(DailyLogClientContacts, { idPrefix: "log", rules, contacts, visitorLog: "", draft, errors: new Map(), onChange: noop }),
    )
    expect(editing).toContain("9 more characters to count as client contact")
    expect(editing).toContain("We reached them")
    expect(editing).toContain("Make a follow-up to-do from this")
  })
})
