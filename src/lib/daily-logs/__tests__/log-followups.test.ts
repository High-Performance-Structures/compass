import { describe, expect, it } from "vitest"

import {
  clientContactFollowUpTitle,
  clientContactsNamedIn,
  dailyLogTodoFilterOptions,
  dailyLogTodoMatchesFilter,
  DEFAULT_DAILY_LOG_FOLLOW_UP_RULES,
  madeTodoTitles,
  savedLogTodoRules,
  todoTitleKey,
  EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT,
  emptyClientContactRow,
  followUpLines,
  followUpsFromDraft,
  isLineFlagged,
  lineTodoKey,
  summaryCountHint,
  toggleCompletedTodo,
  toggleLineTodo,
  toggleWorkedTodo,
  validateDailyLogFollowUps,
  workLinesAfterTick,
} from "../log-followups"

const todo = { id: "t1", title: "Second-floor joists, east side", costCode: "06 11 00" }
const rules = DEFAULT_DAILY_LOG_FOLLOW_UP_RULES

describe("daily log follow-ups", () => {
  it("splits issue text into lines without bullets or repeats", () => {
    expect(followUpLines("- Short on subfloor\n\n• Plumber no-show\n2) Short on subfloor\n  ")).toEqual([
      "Short on subfloor",
      "Plumber no-show",
    ])
  })

  it("finds client contacts named in Visitors by full name or last name", () => {
    const contacts = [
      { id: "c1", name: "Jordan Bishop", role: "Owner" },
      { id: "c2", name: "Al Ng", role: null },
    ]
    expect(clientContactsNamedIn("J. Bishop walked the second floor", contacts).map((c) => c.id)).toEqual(["c1"])
    expect(clientContactsNamedIn("al ng stopped by", contacts).map((c) => c.id)).toEqual(["c2"])
    // Two-letter last names only match the full name.
    expect(clientContactsNamedIn("Ng was here", contacts)).toEqual([])
    expect(clientContactsNamedIn("", contacts)).toEqual([])
  })

  it("adds a ticked to-do's cost code line and removes it when unticked", () => {
    const blank = [{ costCode: "", hours: "", description: "" }]
    const ticked = workLinesAfterTick(blank, todo, true)
    expect(ticked).toEqual([{ costCode: "06 11 00", hours: "", description: todo.title, todoId: "t1" }])
    expect(workLinesAfterTick(ticked, todo, true)).toBe(ticked)
    expect(workLinesAfterTick(ticked, todo, false)).toEqual(blank)
    // A to-do without a cost code adds no line.
    expect(workLinesAfterTick(blank, { ...todo, costCode: null }, true)).toBe(blank)
  })

  it("builds what a log sends from the draft", () => {
    let draft = toggleWorkedTodo(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "t1")
    draft = { ...draft, blocked: { t9: "still" } }
    const issueKey = lineTodoKey("issues", "Short on subfloor")
    draft = toggleLineTodo(draft, rules, issueKey)
    draft = { ...draft, lineTodos: { ...draft.lineTodos, [issueKey]: { recordType: "supplier_task", assigneeName: "Nu-Tech", costCode: "06 15 13" } } }
    draft = { ...draft, contacts: [{ ...emptyClientContactRow("k1", "c1"), summary: "Walked the second floor with Dan." }] }

    const followUps = followUpsFromDraft(draft, { issues: "Short on subfloor\nNeighbor asked about the dumpster", notes: "" }, rules)
    expect(followUps.todoUpdates).toEqual([
      { todoId: "t1", worked: true, completed: false, blocked: null },
      { todoId: "t9", worked: false, completed: false, blocked: "still" },
    ])
    expect(followUps.newTodos).toEqual([
      { source: "issues", title: "Short on subfloor", recordType: "supplier_task", assigneeName: "Nu-Tech", costCode: "06 15 13" },
    ])
    expect(followUps.clientContacts).toHaveLength(1)
    expect(followUps.clientContacts[0]).not.toHaveProperty("key")
  })

  it("marks a to-do Completed, which implies worked on, and unticking reverses both", () => {
    const completed = toggleCompletedTodo(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "t1")
    expect(completed.completed).toEqual(["t1"])
    expect(completed.worked).toEqual(["t1"])
    // Already worked on: not added twice.
    const both = toggleCompletedTodo(toggleWorkedTodo(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "t1"), "t1")
    expect(both.worked).toEqual(["t1"])
    const undone = toggleCompletedTodo(completed, "t1")
    expect(undone.completed).toEqual([])
    expect(undone.worked).toEqual([])
    // Unticking worked on also clears Completed.
    expect(toggleWorkedTodo(completed, "t1").completed).toEqual([])
  })

  it("sends Completed with the log, unless the company turned it off; old drafts have none", () => {
    const draft = toggleCompletedTodo(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "t1")
    const text = { issues: "", notes: "" }
    expect(followUpsFromDraft(draft, text, rules).todoUpdates).toEqual([{ todoId: "t1", worked: true, completed: true, blocked: null }])
    expect(followUpsFromDraft(draft, text, { ...rules, todosCanComplete: false }).todoUpdates).toEqual([{ todoId: "t1", worked: true, completed: false, blocked: null }])
    // A draft saved before Completed existed has no list at all.
    const old = { ...EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, worked: ["t2"] }
    expect("completed" in old).toBe(false)
    expect(followUpsFromDraft(old, text, rules).todoUpdates).toEqual([{ todoId: "t2", worked: true, completed: false, blocked: null }])
  })

  it("filters the checklist by Completed", () => {
    const todos = [
      { id: "t1", title: "A", status: "open" as const, recordType: "staff_task", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-11-11" },
      { id: "t2", title: "B", status: "open" as const, recordType: "staff_task", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-11-11" },
    ]
    const options = dailyLogTodoFilterOptions(todos, [], ["t2"], "Done")
    expect(options.find((option) => option.value === "completed")).toEqual({ value: "completed", label: "Done", count: 1 })
    expect(options.find((option) => option.value === "worked")?.count).toBe(1)
    expect(todos.filter((item) => dailyLogTodoMatchesFilter(item, "completed", [], ["t2"])).map((item) => item.id)).toEqual(["t2"])
  })

  it("makes every line a to-do in auto mode unless the crew skips it", () => {
    const auto = { ...rules, todoMode: "auto" as const }
    const key = lineTodoKey("notes", "Call county")
    expect(isLineFlagged(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "auto", key)).toBe(true)
    const skipped = toggleLineTodo(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, auto, key)
    expect(isLineFlagged(skipped, "auto", key)).toBe(false)
    expect(followUpsFromDraft(skipped, { issues: "", notes: "Call county" }, auto).newTodos).toEqual([])
    expect(isLineFlagged(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, "off", key)).toBe(false)
  })

  it("checks client contact and to-do kinds against the company's rules", () => {
    const errors = validateDailyLogFollowUps(
      {
        todoUpdates: [],
        newTodos: [{ source: "issues", title: "x", recordType: "supplier_task", assigneeName: "", costCode: "" }],
        clientContacts: [{ contactId: "", interactionType: "fax", direction: "inbound", time: "25:00", summary: "short", followUpTodo: false }],
      },
      { todoTypes: ["staff_task"], minimumSummaryCharacters: 15 },
    )
    expect(errors.map((error) => error.key)).toEqual([
      "newTodos.0",
      "clientContacts.0.contactId",
      "clientContacts.0.interactionType",
      "clientContacts.0.time",
      "clientContacts.0.summary",
    ])
  })

  it("counts down to a summary that counts as contact", () => {
    expect(summaryCountHint("Called", 15)).toBe("9 more characters to count as client contact")
    expect(summaryCountHint("Called about the window move", 15)).toBeNull()
  })

  it("titles a client contact's follow-up to-do", () => {
    expect(clientContactFollowUpTitle("J. Bishop", "Asked to move the bath window.\nDan will price it.")).toBe(
      "Follow up with J. Bishop: Asked to move the bath window.",
    )
  })
})

describe("to-dos from saved logs", () => {
  it("matches a line to a to-do title regardless of case and spacing", () => {
    expect(todoTitleKey("  Order  more SIMPSON ties ")).toBe("order more simpson ties")
    expect(madeTodoTitles([{ title: "Order more Simpson ties" }]).has(todoTitleKey("order more simpson  ties"))).toBe(true)
  })

  it("counts a line as made when its to-do was reworded", () => {
    const made = madeTodoTitles([
      {
        title: "Confirm the 10:30 rebar inspection with the inspector",
        description:
          "From the Oct 26, 2026 daily log (issues): Inspector moved the rebar inspection from 9:00 to 10:30.\n\nCreated from Daily log Oct 26, 2026.",
      },
    ])
    expect(made.has(todoTitleKey("Inspector moved the rebar inspection from 9:00 to 10:30."))).toBe(true)
    expect(made.has(todoTitleKey("Confirm the 10:30 rebar inspection with the inspector"))).toBe(true)
    expect(made.has(todoTitleKey("Pump truck booked"))).toBe(false)
  })

  it("never makes to-dos automatically when a saved log is edited", () => {
    expect(savedLogTodoRules({ ...rules, todoMode: "auto" }).todoMode).toBe("ask")
    expect(savedLogTodoRules({ ...rules, todoMode: "off" }).todoMode).toBe("off")
    expect(savedLogTodoRules({ ...rules, todoMode: "ask" })).toEqual({ ...rules, todoMode: "ask" })
  })
})

describe("to-do checklist filters", () => {
  const todo = (id: string, status: "open" | "in_progress" | "blocked", statusLabel?: string) => ({
    id, title: id, status, recordType: "todo", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-11-07", statusLabel,
  })
  const todos = [todo("a", "open", "To do"), todo("b", "in_progress"), todo("c", "in_progress")]

  it("counts each status under the company's name, plus All and Worked on", () => {
    expect(dailyLogTodoFilterOptions(todos, ["b"]).map(({ value, label, count }) => [value, label, count])).toEqual([
      ["all", "All", 3],
      ["open", "To do", 1],
      ["in_progress", "In progress", 2],
      ["blocked", "Blocked", 0],
      ["worked", "Worked on", 1],
      ["completed", "Completed", 0],
    ])
  })

  it("matches by status or by what was ticked today", () => {
    expect(todos.filter((item) => dailyLogTodoMatchesFilter(item, "in_progress", [])).map((item) => item.id)).toEqual(["b", "c"])
    expect(todos.filter((item) => dailyLogTodoMatchesFilter(item, "worked", ["a"])).map((item) => item.id)).toEqual(["a"])
    expect(todos.filter((item) => dailyLogTodoMatchesFilter(item, "all", [])).length).toBe(3)
  })
})
