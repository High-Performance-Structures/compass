/**
 * What a daily log does besides recording the day: tick the to-dos worked on,
 * answer whether a blocked to-do is still blocked, turn issue and next-step
 * lines into to-dos, and record client contact. Shared by the browser, Field
 * Mode on phones and the server.
 *
 * Kept free of path aliases so the native Field Mode bundle can import it.
 */

import type { DailyLogWorkLineDraft } from "./daily-log-form"

/** To-do kinds a daily log can create, in the order pickers show them. */
export const DAILY_LOG_TODO_TYPES = ["staff_task", "subcontractor_task", "supplier_task"] as const

export type DailyLogTodoType = (typeof DAILY_LOG_TODO_TYPES)[number]

export const DAILY_LOG_TODO_TYPE_LABELS: { readonly [K in DailyLogTodoType]: string } = {
  staff_task: "Staff to-do",
  subcontractor_task: "Sub to-do",
  supplier_task: "Supplier to-do",
}

export function isDailyLogTodoType(value: string): value is DailyLogTodoType {
  return DAILY_LOG_TODO_TYPES.some((type) => type === value)
}

/** How issue and next-step lines become to-dos. */
export const DAILY_LOG_TODO_MODES = ["ask", "auto", "off"] as const

export type DailyLogTodoMode = (typeof DAILY_LOG_TODO_MODES)[number]

/** The company's rules for a daily log's to-dos and client contact. */
export type DailyLogFollowUpRules = {
  readonly todoMode: DailyLogTodoMode
  /** To-do kinds the crew may create from a log. */
  readonly todoTypes: readonly DailyLogTodoType[]
  /** Ticking an Open to-do moves it to In progress. */
  readonly workedMovesToInProgress: boolean
  /** Blocked to-dos ask "still blocked?" on the next log. */
  readonly carryBlocked: boolean
  /** To-dos carry a cost code. */
  readonly todoCostCodes: boolean
  /** Ticking a to-do with a cost code adds a cost code line for its hours. */
  readonly tickAddsLine: boolean
  /** The crew picks the cost code on a new to-do (otherwise the office does). */
  readonly crewPicksCostCode: boolean
  readonly clientContact: boolean
  readonly clientContactSuggest: boolean
  /** From the client interaction settings: shortest summary that counts. */
  readonly minimumSummaryCharacters: number
}

export const DEFAULT_DAILY_LOG_FOLLOW_UP_RULES: DailyLogFollowUpRules = {
  todoMode: "ask",
  todoTypes: [...DAILY_LOG_TODO_TYPES],
  workedMovesToInProgress: true,
  carryBlocked: true,
  todoCostCodes: true,
  tickAddsLine: true,
  crewPicksCostCode: true,
  clientContact: true,
  clientContactSuggest: true,
  minimumSummaryCharacters: 15,
}

/** An open to-do as the log form shows it. */
export type DailyLogOpenTodo = {
  readonly id: string
  readonly title: string
  readonly status: "open" | "in_progress" | "blocked"
  readonly recordType: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly costCode: string | null
  /** Date (YYYY-MM-DD) it was last changed; for a blocked to-do, roughly when it became blocked. */
  readonly changedOn: string
}

/** A client contact on the project, for the log's client contact picker. */
export type DailyLogClientContactOption = {
  readonly id: string
  readonly name: string
  readonly role: string | null
}

export const DAILY_LOG_INTERACTION_TYPES = [
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "sms", label: "Text" },
  { id: "meeting", label: "Meeting" },
  { id: "site_visit", label: "Site visit" },
  { id: "client_send", label: "Document/Submittal to Client" },
] as const

export type DailyLogInteractionType = (typeof DAILY_LOG_INTERACTION_TYPES)[number]["id"]

export function isDailyLogInteractionType(value: string): value is DailyLogInteractionType {
  return DAILY_LOG_INTERACTION_TYPES.some((type) => type.id === value)
}

/** One line of Issues or Notes / next steps turned into a to-do. */
export type DailyLogNewTodoDraft = {
  readonly source: "issues" | "notes"
  readonly title: string
  readonly recordType: DailyLogTodoType
  readonly assigneeName: string
  readonly costCode: string
}

export type DailyLogTodoUpdateDraft = {
  readonly todoId: string
  readonly worked: boolean
  readonly blocked: "still" | "cleared" | null
}

export type DailyLogClientContactDraft = {
  readonly contactId: string
  readonly interactionType: string
  readonly direction: "inbound" | "outbound"
  /** Local time HH:MM on the log's date; blank for "sometime that day". */
  readonly time: string
  readonly summary: string
  readonly followUpTodo: boolean
}

/** Everything a log carries besides its own fields. */
export type DailyLogFollowUps = {
  readonly todoUpdates: readonly DailyLogTodoUpdateDraft[]
  readonly newTodos: readonly DailyLogNewTodoDraft[]
  readonly clientContacts: readonly DailyLogClientContactDraft[]
}

export const EMPTY_DAILY_LOG_FOLLOW_UPS: DailyLogFollowUps = { todoUpdates: [], newTodos: [], clientContacts: [] }

const MAX_LINES = 20
const MAX_TITLE = 200

/**
 * The separate items in an Issues or Notes field: one per line, without list
 * bullets. Blank lines are skipped.
 */
export function followUpLines(text: string): readonly string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()
    if (line && !lines.includes(line)) lines.push(line.slice(0, MAX_TITLE))
    if (lines.length >= MAX_LINES) break
  }
  return lines
}

function words(text: string): readonly string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean)
}

/**
 * Client contacts named in the Visitors field. A contact matches on their full
 * name, or on a last name of three or more letters standing alone.
 */
export function clientContactsNamedIn(text: string, contacts: readonly DailyLogClientContactOption[]): readonly DailyLogClientContactOption[] {
  const said = words(text)
  if (said.length === 0) return []
  const saidText = ` ${said.join(" ")} `
  return contacts.filter((contact) => {
    const nameWords = words(contact.name)
    if (nameWords.length === 0) return false
    if (saidText.includes(` ${nameWords.join(" ")} `)) return true
    const last = nameWords[nameWords.length - 1]
    return last !== undefined && last.length >= 3 && said.includes(last)
  })
}

/** The cost code line a ticked to-do adds: its code and title, hours left for the crew. */
export function workLineForTodo(todo: Pick<DailyLogOpenTodo, "id" | "title" | "costCode">): DailyLogWorkLineDraft {
  return { costCode: todo.costCode ?? "", hours: "", description: todo.title.slice(0, 500), todoId: todo.id }
}

/**
 * Lines after ticking or unticking a to-do. Ticking adds its line (replacing a
 * blank starter line); unticking removes the lines that came from it.
 */
export function workLinesAfterTick(
  lines: readonly DailyLogWorkLineDraft[],
  todo: Pick<DailyLogOpenTodo, "id" | "title" | "costCode">,
  ticked: boolean,
): readonly DailyLogWorkLineDraft[] {
  if (!ticked) {
    const kept = lines.filter((line) => line.todoId !== todo.id)
    return kept.length > 0 ? kept : [{ costCode: "", hours: "", description: "" }]
  }
  if (!todo.costCode || lines.some((line) => line.todoId === todo.id)) return lines
  const started = lines.filter((line) => line.costCode.trim() || line.hours.trim() || line.description.trim())
  return [...started, workLineForTodo(todo)]
}

export type DailyLogFollowUpError = { readonly key: string; readonly message: string }

/** Problems with the log's to-do and client contact parts, keyed for the form. */
export function validateDailyLogFollowUps(
  followUps: DailyLogFollowUps,
  rules: Pick<DailyLogFollowUpRules, "todoTypes" | "minimumSummaryCharacters">,
): readonly DailyLogFollowUpError[] {
  const errors: DailyLogFollowUpError[] = []
  followUps.newTodos.forEach((todo, index) => {
    if (!todo.title.trim()) errors.push({ key: `newTodos.${index}`, message: "A to-do needs a title." })
    else if (!rules.todoTypes.includes(todo.recordType)) {
      errors.push({ key: `newTodos.${index}`, message: `${DAILY_LOG_TODO_TYPE_LABELS[todo.recordType]}s can't be created from a daily log.` })
    }
  })
  followUps.clientContacts.forEach((contact, index) => {
    if (!contact.contactId) errors.push({ key: `clientContacts.${index}.contactId`, message: "Choose who you spoke with." })
    if (!isDailyLogInteractionType(contact.interactionType)) {
      errors.push({ key: `clientContacts.${index}.interactionType`, message: "Choose how you were in touch." })
    }
    if (contact.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(contact.time)) {
      errors.push({ key: `clientContacts.${index}.time`, message: "Enter a time like 10:15." })
    }
    if (contact.summary.trim().length < rules.minimumSummaryCharacters) {
      errors.push({
        key: `clientContacts.${index}.summary`,
        message: `Describe what happened in at least ${rules.minimumSummaryCharacters} characters.`,
      })
    }
  })
  return errors
}

/** "12 more characters to count as client contact" style hint, or null once it counts. */
export function summaryCountHint(summary: string, minimum: number): string | null {
  const missing = minimum - summary.trim().length
  if (missing <= 0) return null
  return missing === 1 ? "1 more character to count as client contact" : `${missing} more characters to count as client contact`
}

/** The to-do title a client contact's follow-up gets. */
export function clientContactFollowUpTitle(contactName: string, summary: string): string {
  const firstLine = summary.trim().split(/\r?\n/)[0] ?? ""
  const short = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine
  return `Follow up with ${contactName}: ${short}`.slice(0, MAX_TITLE)
}

/** Type, assignee and cost code chosen for one issue or next-step line's to-do. */
export type DailyLogLineTodoChoice = {
  readonly recordType: DailyLogTodoType
  readonly assigneeName: string
  readonly costCode: string
}

/** A client contact being written on the form; `key` only tells rows apart. */
export type DailyLogClientContactRow = DailyLogClientContactDraft & { readonly key: string }

/** The to-do and client contact part of a log while it's being written. */
export type DailyLogFollowUpDraft = {
  /** To-dos ticked as worked on. */
  readonly worked: readonly string[]
  /** Answers for blocked to-dos. */
  readonly blocked: { readonly [todoId: string]: "still" | "cleared" }
  /** Lines flagged as to-dos (or, when every line becomes one, their choices), by line key. */
  readonly lineTodos: { readonly [lineKey: string]: DailyLogLineTodoChoice }
  /** When every line becomes a to-do: lines the crew turned back into notes. */
  readonly skippedLines: readonly string[]
  readonly contacts: readonly DailyLogClientContactRow[]
  /** The crew dismissed the "log it as client contact?" suggestion. */
  readonly suggestionDismissed: boolean
}

export const EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT: DailyLogFollowUpDraft = {
  worked: [],
  blocked: {},
  lineTodos: {},
  skippedLines: [],
  contacts: [],
  suggestionDismissed: false,
}

export function lineTodoKey(source: DailyLogNewTodoDraft["source"], text: string): string {
  return `${source}:${text}`
}

export function isLineFlagged(draft: DailyLogFollowUpDraft, mode: DailyLogTodoMode, key: string): boolean {
  if (mode === "off") return false
  if (mode === "auto") return !draft.skippedLines.includes(key)
  return key in draft.lineTodos
}

export function defaultLineChoice(rules: Pick<DailyLogFollowUpRules, "todoTypes">): DailyLogLineTodoChoice {
  return { recordType: rules.todoTypes[0] ?? "staff_task", assigneeName: "", costCode: "" }
}

export function lineChoice(draft: DailyLogFollowUpDraft, rules: Pick<DailyLogFollowUpRules, "todoTypes">, key: string): DailyLogLineTodoChoice {
  return draft.lineTodos[key] ?? defaultLineChoice(rules)
}

/** Flags or unflags a line as a to-do. */
export function toggleLineTodo(
  draft: DailyLogFollowUpDraft,
  rules: Pick<DailyLogFollowUpRules, "todoMode" | "todoTypes">,
  key: string,
): DailyLogFollowUpDraft {
  if (rules.todoMode === "auto") {
    const skipped = draft.skippedLines.includes(key)
    return { ...draft, skippedLines: skipped ? draft.skippedLines.filter((line) => line !== key) : [...draft.skippedLines, key] }
  }
  if (key in draft.lineTodos) {
    return { ...draft, lineTodos: Object.fromEntries(Object.entries(draft.lineTodos).filter(([lineKey]) => lineKey !== key)) }
  }
  return { ...draft, lineTodos: { ...draft.lineTodos, [key]: defaultLineChoice(rules) } }
}

/** Ticks or unticks a to-do as worked on. */
export function toggleWorkedTodo(draft: DailyLogFollowUpDraft, todoId: string): DailyLogFollowUpDraft {
  return draft.worked.includes(todoId)
    ? { ...draft, worked: draft.worked.filter((id) => id !== todoId) }
    : { ...draft, worked: [...draft.worked, todoId] }
}

/** What the form sends with the log. */
export function followUpsFromDraft(
  draft: DailyLogFollowUpDraft,
  text: { readonly issues: string; readonly notes: string },
  rules: Pick<DailyLogFollowUpRules, "todoMode" | "todoTypes" | "clientContact">,
): DailyLogFollowUps {
  const todoIds = new Set([...draft.worked, ...Object.keys(draft.blocked)])
  const todoUpdates = [...todoIds].map((todoId) => ({
    todoId,
    worked: draft.worked.includes(todoId),
    blocked: draft.blocked[todoId] ?? null,
  }))
  const newTodos: DailyLogNewTodoDraft[] = []
  for (const source of ["issues", "notes"] as const) {
    for (const line of followUpLines(text[source])) {
      const key = lineTodoKey(source, line)
      if (!isLineFlagged(draft, rules.todoMode, key)) continue
      const choice = lineChoice(draft, rules, key)
      newTodos.push({ source, title: line, recordType: choice.recordType, assigneeName: choice.assigneeName, costCode: choice.costCode })
    }
  }
  const clientContacts = rules.clientContact
    ? draft.contacts.map((row) => ({
        contactId: row.contactId,
        interactionType: row.interactionType,
        direction: row.direction,
        time: row.time,
        summary: row.summary,
        followUpTodo: row.followUpTodo,
      }))
    : []
  return { todoUpdates, newTodos, clientContacts }
}

export function emptyClientContactRow(key: string, contactId = "", interactionType: DailyLogInteractionType = "call"): DailyLogClientContactRow {
  return { key, contactId, interactionType, direction: "outbound", time: "", summary: "", followUpTodo: false }
}
