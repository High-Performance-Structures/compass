/**
 * Field Mode's to-do and client contact parts of the daily log: blocked
 * to-dos carried forward, the open to-dos checklist, "Make to-do" on issue and
 * next-step lines, and client contact. Rendered as HTML strings like the rest
 * of the form; every control carries `data-fu` (what it changes) and
 * `data-fu-key` (which to-do, line or contact), handled by `followUpAction`.
 */
import { z } from "zod/v4"

import type { DailyLogCostCodeOption } from "../src/lib/daily-logs/daily-log-form"
import {
  clientContactsNamedIn,
  DAILY_LOG_INTERACTION_TYPES,
  DAILY_LOG_TODO_TYPE_LABELS,
  DAILY_LOG_TODO_TYPES,
  EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT,
  emptyClientContactRow,
  followUpLines,
  isLineFlagged,
  lineChoice,
  lineTodoKey,
  summaryCountHint,
  toggleLineTodo,
  toggleWorkedTodo,
  type DailyLogFollowUpDraft,
  type DailyLogFollowUpRules,
  type DailyLogOpenTodo,
} from "../src/lib/daily-logs/log-followups"
import type { FieldDailyLogFollowUpSetup } from "../src/lib/field/types"

type Escape = (value: string) => string

export const followUpDraftSchema = z.object({
  worked: z.array(z.string()),
  blocked: z.record(z.string(), z.enum(["still", "cleared"])),
  lineTodos: z.record(
    z.string(),
    z.object({ recordType: z.enum(DAILY_LOG_TODO_TYPES), assigneeName: z.string(), costCode: z.string() }),
  ),
  skippedLines: z.array(z.string()),
  contacts: z.array(
    z.object({
      key: z.string(),
      contactId: z.string(),
      interactionType: z.string(),
      direction: z.enum(["inbound", "outbound"]),
      time: z.string(),
      summary: z.string(),
      followUpTodo: z.boolean(),
    }),
  ),
  suggestionDismissed: z.boolean(),
})

export function emptyFollowUpDraft(): StoredFollowUpDraft {
  return { ...EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT, worked: [], blocked: {}, lineTodos: {}, skippedLines: [], contacts: [] }
}

export type StoredFollowUpDraft = z.infer<typeof followUpDraftSchema>

/** A plain copy of the draft, as the phone stores it. */
export function storedFollowUpDraft(draft: DailyLogFollowUpDraft): StoredFollowUpDraft {
  return {
    worked: [...draft.worked],
    blocked: { ...draft.blocked },
    lineTodos: Object.fromEntries(Object.entries(draft.lineTodos).map(([key, choice]) => [key, { ...choice }])),
    skippedLines: [...draft.skippedLines],
    contacts: draft.contacts.map((row) => ({ ...row })),
    suggestionDismissed: draft.suggestionDismissed,
  }
}

/** Something a follow-up control asks for. */
export type FollowUpAction = {
  readonly control: string
  readonly key: string
  readonly value: string
}

/** Controls whose change redraws the form (the rest are typed text). */
export const FOLLOW_UP_REDRAW_CONTROLS: ReadonlySet<string> = new Set([
  "worked",
  "blocked",
  "line-toggle",
  "line-type",
  "contact-direction",
  "contact-add",
  "contact-remove",
  "suggest-accept",
  "suggest-dismiss",
])

/** The draft after one control's change. Ticking to-dos is handled by the caller, which also adds its cost code line. */
export function followUpAction(
  draft: DailyLogFollowUpDraft,
  rules: Pick<DailyLogFollowUpRules, "todoMode" | "todoTypes">,
  action: FollowUpAction,
  newKey: () => string,
): DailyLogFollowUpDraft {
  const { control, key, value } = action
  const updateLine = (patch: Partial<{ recordType: string; assigneeName: string; costCode: string }>): DailyLogFollowUpDraft => {
    const current = lineChoice(draft, rules, key)
    const recordType = DAILY_LOG_TODO_TYPES.find((type) => type === (patch.recordType ?? current.recordType)) ?? current.recordType
    const next = {
      recordType,
      assigneeName: patch.recordType !== undefined && recordType !== current.recordType ? "" : patch.assigneeName ?? current.assigneeName,
      costCode: patch.costCode ?? current.costCode,
    }
    return { ...draft, lineTodos: { ...draft.lineTodos, [key]: next } }
  }
  const updateContact = (patch: Partial<DailyLogFollowUpDraft["contacts"][number]>): DailyLogFollowUpDraft => ({
    ...draft,
    contacts: draft.contacts.map((row) => (row.key === key ? { ...row, ...patch } : row)),
  })
  switch (control) {
    case "worked":
      return toggleWorkedTodo(draft, key)
    case "blocked": {
      if (value !== "still" && value !== "cleared") return draft
      if (draft.blocked[key] === value) {
        return { ...draft, blocked: Object.fromEntries(Object.entries(draft.blocked).filter(([todoId]) => todoId !== key)) }
      }
      return { ...draft, blocked: { ...draft.blocked, [key]: value } }
    }
    case "line-toggle":
      return toggleLineTodo(draft, rules, key)
    case "line-type":
      return updateLine({ recordType: value })
    case "line-assignee":
      return updateLine({ assigneeName: value })
    case "line-code":
      return updateLine({ costCode: value })
    case "contact-who":
      return updateContact({ contactId: value })
    case "contact-type":
      return updateContact({ interactionType: value })
    case "contact-time":
      return updateContact({ time: value })
    case "contact-summary":
      return updateContact({ summary: value })
    case "contact-todo":
      return updateContact({ followUpTodo: value === "true" })
    case "contact-direction":
      return value === "inbound" || value === "outbound" ? updateContact({ direction: value }) : draft
    case "contact-add":
      return { ...draft, contacts: [...draft.contacts, emptyClientContactRow(newKey())] }
    case "contact-remove":
      return { ...draft, contacts: draft.contacts.filter((row) => row.key !== key) }
    case "suggest-accept":
      return { ...draft, contacts: [emptyClientContactRow(newKey(), value, "site_visit")] }
    case "suggest-dismiss":
      return { ...draft, suggestionDismissed: true }
    default:
      return draft
  }
}

function data(control: string, key: string, escape: Escape): string {
  return `data-fu="${control}" data-fu-key="${escape(key)}"`
}

function whoFor(todo: DailyLogOpenTodo): string {
  const kind = todo.recordType === "subcontractor_task" ? "Sub" : todo.recordType === "supplier_task" ? "Supplier" : "Staff"
  const who = todo.assigneeName || todo.companyName
  return who ? `${kind} · ${who}` : kind
}

function statusLabel(status: DailyLogOpenTodo["status"]): string {
  return status === "in_progress" ? "In progress" : status === "blocked" ? "Blocked" : "Open"
}

function shortDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function codeLabel(code: string | null, costCodes: readonly DailyLogCostCodeOption[]): string | null {
  if (!code) return null
  return costCodes.find((option) => option.code === code)?.label ?? code
}

export function blockedTodosHtml(setup: FieldDailyLogFollowUpSetup, draft: DailyLogFollowUpDraft, escape: Escape): string {
  if (!setup.rules.carryBlocked) return ""
  const blocked = setup.openTodos.filter((todo) => todo.status === "blocked")
  if (blocked.length === 0) return ""
  const rows = blocked.map((todo) => {
    const answer = draft.blocked[todo.id]
    const button = (value: "still" | "cleared", label: string): string =>
      `<button type="button" class="kind-chip${answer === value ? " selected" : ""}" aria-pressed="${answer === value}" ${data("blocked", todo.id, escape)} data-fu-value="${value}">${label}</button>`
    return `<div class="followup-row">
      <p class="followup-title">${escape(todo.title)}</p>
      <p class="field-hint">${escape(whoFor(todo))} · blocked since ${escape(shortDate(todo.changedOn))}</p>
      <div class="followup-actions" role="group" aria-label="${escape(`Is "${todo.title}" still blocked?`)}">${button("still", "Still blocked")}${button("cleared", "Cleared today")}</div>
    </div>`
  })
  return `<section class="followup-blocked" aria-label="Blocked to-dos"><p class="field-label">Blocked to-dos</p>${rows.join("")}</section>`
}

export function todoChecklistHtml(
  setup: FieldDailyLogFollowUpSetup,
  draft: DailyLogFollowUpDraft,
  costCodes: readonly DailyLogCostCodeOption[],
  escape: Escape,
): string {
  const { rules } = setup
  const todos = setup.openTodos.filter((todo) => todo.status !== "blocked" || !rules.carryBlocked)
  if (todos.length === 0) return ""
  const rows = todos.map((todo) => {
    const checked = draft.worked.includes(todo.id)
    const status = checked && todo.status === "open" && rules.workedMovesToInProgress ? "Open → In progress" : statusLabel(todo.status)
    const code = rules.todoCostCodes ? codeLabel(todo.costCode, costCodes) : null
    return `<label class="followup-check">
      <input type="checkbox" ${checked ? "checked" : ""} ${data("worked", todo.id, escape)} />
      <span><span class="followup-title">${escape(todo.title)}</span>
      <span class="field-hint">${escape(whoFor(todo))} · ${escape(status)}${code ? ` · ${escape(code)}` : ""}</span></span>
    </label>`
  })
  return `<fieldset class="followup-list">
    <legend class="field-label">Open to-dos on this job</legend>
    <p class="field-hint">Tick what you worked on.${rules.tickAddsLine ? " A to-do with a cost code adds a line below for its hours." : ""} Ticking never marks a to-do finished.</p>
    ${rows.join("")}
  </fieldset>`
}

function optionsHtml(options: readonly { readonly value: string; readonly label: string }[], selected: string, blank: string, escape: Escape): string {
  return `<option value="">${escape(blank)}</option>${options
    .map((option) => `<option value="${escape(option.value)}" ${option.value === selected ? "selected" : ""}>${escape(option.label)}</option>`)
    .join("")}`
}

export function lineTodosHtml(
  source: "issues" | "notes",
  text: string,
  setup: FieldDailyLogFollowUpSetup,
  draft: DailyLogFollowUpDraft,
  costCodes: readonly DailyLogCostCodeOption[],
  escape: Escape,
): string {
  const { rules } = setup
  const lines = followUpLines(text)
  if (rules.todoMode === "off" || rules.todoTypes.length === 0 || lines.length === 0) return ""
  const rows = lines.map((line) => {
    const key = lineTodoKey(source, line)
    const flagged = isLineFlagged(draft, rules.todoMode, key)
    const choice = lineChoice(draft, rules, key)
    const people = setup.assignees.filter((person) => person.kind === choice.recordType).map((person) => ({ value: person.name, label: person.name }))
    const details = flagged
      ? `<div class="followup-details">
          <label class="field">Type<select ${data("line-type", key, escape)}>${rules.todoTypes
            .map((type) => `<option value="${type}" ${type === choice.recordType ? "selected" : ""}>${escape(DAILY_LOG_TODO_TYPE_LABELS[type])}</option>`)
            .join("")}</select></label>
          <label class="field">Assign to<select ${data("line-assignee", key, escape)}>${optionsHtml(people, choice.assigneeName, "Office assigns", escape)}</select></label>
          ${rules.crewPicksCostCode && costCodes.length > 0
            ? `<label class="field">Cost code<select ${data("line-code", key, escape)}>${optionsHtml(costCodes.map((option) => ({ value: option.code, label: option.label })), choice.costCode, "No cost code", escape)}</select></label>`
            : ""}
        </div>`
      : ""
    return `<div class="followup-row${flagged ? " flagged" : ""}">
      <div class="followup-line"><span>${escape(line)}</span>
      <button type="button" class="kind-chip${flagged ? " selected" : ""}" aria-pressed="${flagged}" ${data("line-toggle", key, escape)}>${flagged ? "To-do ✓" : "Make to-do"}</button></div>
      ${details}
    </div>`
  })
  return `<div class="followup-list" id="log-${source}-todos">${rows.join("")}</div>`
}

export function clientContactsHtml(
  setup: FieldDailyLogFollowUpSetup,
  draft: DailyLogFollowUpDraft,
  visitorLog: string,
  errors: ReadonlyMap<string, string>,
  escape: Escape,
): string {
  const { rules } = setup
  if (!rules.clientContact) return ""
  const contacts = setup.clientContacts
  const suggested = rules.clientContactSuggest && !draft.suggestionDismissed && draft.contacts.length === 0
    ? clientContactsNamedIn(visitorLog, contacts)[0]
    : undefined
  const suggestion = suggested
    ? `<div class="followup-suggest"><span>Visitors mentions ${escape(suggested.name)}. Log it as client contact?</span>
        <div class="followup-actions">
          <button type="button" class="text-button" ${data("suggest-dismiss", "", escape)}>Not now</button>
          <button type="button" class="kind-chip selected" ${data("suggest-accept", "", escape)} data-fu-value="${escape(suggested.id)}">Log it</button>
        </div></div>`
    : ""
  const rows = draft.contacts.map((row, index) => {
    const err = (field: string): string => {
      const message = errors.get(`clientContacts.${index}.${field}`)
      return message ? `<span class="field-error" id="log-contact-${index}-${field}-error">${escape(message)}</span>` : ""
    }
    const invalid = (field: string): string => (errors.has(`clientContacts.${index}.${field}`) ? ` aria-invalid="true" aria-describedby="log-contact-${index}-${field}-error"` : "")
    const hint = summaryCountHint(row.summary, rules.minimumSummaryCharacters)
    const direction = (value: "outbound" | "inbound", label: string): string =>
      `<button type="button" class="kind-chip${row.direction === value ? " selected" : ""}" aria-pressed="${row.direction === value}" ${data("contact-direction", row.key, escape)} data-fu-value="${value}">${label}</button>`
    return `<div class="followup-row">
      <label class="field">Who<select id="log-contact-${index}-contactId" ${data("contact-who", row.key, escape)}${invalid("contactId")}>${optionsHtml(
        contacts.map((contact) => ({ value: contact.id, label: contact.role ? `${contact.name} · ${contact.role}` : contact.name })),
        row.contactId,
        "Choose a client contact",
        escape,
      )}</select>${err("contactId")}</label>
      <div class="work-line-row">
        <label class="field">Time<input id="log-contact-${index}-time" type="time" value="${escape(row.time)}" ${data("contact-time", row.key, escape)}${invalid("time")} />${err("time")}</label>
        <label class="field">Type<select ${data("contact-type", row.key, escape)}>${DAILY_LOG_INTERACTION_TYPES.map(
          (type) => `<option value="${type.id}" ${type.id === row.interactionType ? "selected" : ""}>${escape(type.label)}</option>`,
        ).join("")}</select></label>
      </div>
      <div class="followup-actions" role="group" aria-label="Who reached out">${direction("outbound", "We reached them")}${direction("inbound", "They reached us")}</div>
      <label class="field">What happened<textarea id="log-contact-${index}-summary" placeholder="Who you spoke with, what was said or sent, next step" ${data("contact-summary", row.key, escape)}${invalid("summary")}>${escape(row.summary)}</textarea>
      ${err("summary") || `<span class="field-hint" data-fu-hint="${escape(row.key)}">${escape(hint ?? "✓ Counts as client contact")}</span>`}</label>
      <label class="followup-check"><input type="checkbox" ${row.followUpTodo ? "checked" : ""} ${data("contact-todo", row.key, escape)} /><span>Make a follow-up to-do from this</span></label>
      <button type="button" class="text-button remove-line" ${data("contact-remove", row.key, escape)}>Remove client contact ${index + 1}</button>
    </div>`
  })
  return `<section class="followup-list" aria-label="Client contact">
    <p class="field-label">Client contact</p>
    <p class="field-hint">Talked with, texted or met the client today? Log it here. It counts as client contact for follow-up.</p>
    ${contacts.length === 0 ? `<p class="field-hint">This job has no client contacts yet; the office adds them in Compass.</p>` : ""}
    ${suggestion}${rows.join("")}
    ${contacts.length > 0 ? `<button type="button" class="secondary" ${data("contact-add", "", escape)}>Add client contact</button>` : ""}
  </section>`
}

/** The hint under a contact's summary while it's typed (no redraw). */
export function summaryHintText(summary: string, minimum: number): string {
  return summaryCountHint(summary, minimum) ?? "✓ Counts as client contact"
}
