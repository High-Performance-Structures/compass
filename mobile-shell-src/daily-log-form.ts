/**
 * Field Mode's daily log form. What a person types lives in a draft that is
 * saved on the phone, so redrawing the screen (a photo added, the connection
 * changing, a sync finishing) never clears it. The form shows which fields
 * are required and, when something is missing on save, keeps everything and
 * points to what needs attention.
 */
import { z } from "zod/v4"

import {
  DAILY_LOG_FIELD_LABELS,
  DAILY_LOG_OPTIONAL_FIELDS,
  DEFAULT_DAILY_LOG_REQUIREMENTS,
  emptyWorkLine,
  isRequired,
  localDateInputValue,
  parseWorkLineHours,
  type DailyLogOptionalField,
  type DailyLogRequirements,
  type DailyLogWorkLineDraft,
} from "../src/lib/daily-logs/daily-log-form"
import type { FieldDailyLogForm } from "../src/lib/field/types"
import {
  blockedTodosHtml,
  clientContactsHtml,
  emptyFollowUpDraft,
  followUpDraftSchema,
  lineTodosHtml,
  todoChecklistHtml,
} from "./daily-log-followups"

export { localDateInputValue }

export const LOG_DRAFT_KEY_PREFIX = "compass_field_log_draft_v1"

export const logDraftSchema = z.object({
  logDate: z.string(),
  workCompleted: z.string(),
  workLines: z.array(z.object({ costCode: z.string(), hours: z.string(), description: z.string(), todoId: z.string().optional() })).min(1),
  crewPresent: z.string(),
  materialsUsed: z.string(),
  issues: z.string(),
  safetyIncidents: z.string(),
  visitorLog: z.string(),
  notes: z.string(),
  // Drafts saved before logs tied into to-dos start with nothing ticked.
  followUps: followUpDraftSchema.default(emptyFollowUpDraft),
})

export type LogDraft = z.infer<typeof logDraftSchema>

/** Whether the save button reads "Save" or confirms the last save. */
export type LogSaveState = "idle" | "saved" | "synced"

export function logDraftKey(projectId: string): string {
  return `${LOG_DRAFT_KEY_PREFIX}.${projectId}`
}

export function emptyLogDraft(today: string = localDateInputValue()): LogDraft {
  return {
    logDate: today,
    workCompleted: "",
    workLines: [emptyWorkLine()],
    crewPresent: "",
    materialsUsed: "",
    issues: "",
    safetyIncidents: "",
    visitorLog: "",
    notes: "",
    followUps: emptyFollowUpDraft(),
  }
}

/** Requirements for a project; a packet from before cost codes keeps the old rules. */
export function logRequirements(form: FieldDailyLogForm | null): DailyLogRequirements {
  if (!form) return { requireCostCodeTime: false, requiredFields: DEFAULT_DAILY_LOG_REQUIREMENTS.requiredFields }
  // With no codes on the phone yet, a cost code can't be required.
  return form.costCodes.length > 0 ? form.requirements : { ...form.requirements, requireCostCodeTime: false }
}

/** Sets one field from a form control's name: "workCompleted" or "workLines.2.hours". */
export function updateLogDraft(draft: LogDraft, name: string, value: string): LogDraft {
  const line = /^workLines\.(\d+)\.(costCode|hours|description)$/.exec(name)
  if (line) {
    const index = Number(line[1])
    const part = line[2]
    if (part !== "costCode" && part !== "hours" && part !== "description") return draft
    return {
      ...draft,
      workLines: draft.workLines.map((item, itemIndex) => (itemIndex === index ? { ...item, [part]: value } : item)),
    }
  }
  if (name === "logDate" || name === "workCompleted" || isOptionalField(name)) return { ...draft, [name]: value }
  return draft
}

function isOptionalField(name: string): name is DailyLogOptionalField {
  return DAILY_LOG_OPTIONAL_FIELDS.some((field) => field === name)
}

export function addWorkLine(draft: LogDraft): LogDraft {
  return { ...draft, workLines: [...draft.workLines, emptyWorkLine()] }
}

export function removeWorkLine(draft: LogDraft, index: number): LogDraft {
  const remaining = draft.workLines.filter((_, lineIndex) => lineIndex !== index)
  return { ...draft, workLines: remaining.length > 0 ? remaining : [emptyWorkLine()] }
}

/** Lines with anything in them, for the queued log. */
export function filledWorkLines(lines: readonly DailyLogWorkLineDraft[]): DailyLogWorkLineDraft[] {
  return lines.filter((line) => line.costCode.trim() || line.hours.trim() || line.description.trim())
}

export function totalHoursLabel(lines: readonly DailyLogWorkLineDraft[]): string {
  const total = lines.reduce((sum, line) => {
    const hours = parseWorkLineHours(line.hours)
    return hours.ok ? sum + hours.hours : sum
  }, 0)
  return `${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} hours`
}

/** The control to focus for an error. */
export function errorControlId(key: string): string {
  const line = /^workLines\.(\d+)\.(costCode|hours)$/.exec(key)
  if (line) return `log-line-${line[1]}-${line[2]}`
  const contact = /^clientContacts\.(\d+)\.(contactId|time|summary)$/.exec(key)
  if (contact) return `log-contact-${contact[1]}-${contact[2]}`
  if (key === "workLines") return "log-line-0-costCode"
  return `log-${key}`
}

type Escape = (value: string) => string

const OPTIONAL_FIELD_UI: { readonly [K in DailyLogOptionalField]: { readonly placeholder: string; readonly multiline: boolean } } = {
  crewPresent: { placeholder: "Crew, subs, suppliers", multiline: false },
  materialsUsed: { placeholder: "What was delivered or used", multiline: true },
  issues: { placeholder: "Leave blank if none", multiline: true },
  safetyIncidents: { placeholder: "Incidents, or no incidents", multiline: true },
  visitorLog: { placeholder: "Owners, inspectors, suppliers", multiline: false },
  notes: { placeholder: "Follow-ups and next steps", multiline: true },
}

function requiredTag(required: boolean): string {
  return required ? `<span class="required-tag">Required</span>` : ""
}

function errorText(errors: ReadonlyMap<string, string>, key: string, escape: Escape): string {
  const message = errors.get(key)
  return message ? `<span class="field-error" id="log-${escape(key)}-error">${escape(message)}</span>` : ""
}

function invalidAttrs(errors: ReadonlyMap<string, string>, key: string, escape: Escape): string {
  return errors.has(key) ? ` aria-invalid="true" aria-describedby="log-${escape(key)}-error"` : ""
}

function costCodeOptions(form: FieldDailyLogForm, selected: string, escape: Escape): string {
  const groups = new Map<string, string[]>()
  for (const option of form.costCodes) {
    const items = groups.get(option.group) ?? []
    items.push(`<option value="${escape(option.code)}" ${option.code === selected ? "selected" : ""}>${escape(option.label)}</option>`)
    groups.set(option.group, items)
  }
  // A code saved in the draft that has since left the list stays visible.
  const known = form.costCodes.some((option) => option.code === selected)
  const kept = selected && !known ? `<option value="${escape(selected)}" selected>${escape(selected)}</option>` : ""
  const body = [...groups.entries()]
    .map(([group, items]) => (group ? `<optgroup label="${escape(group)}">${items.join("")}</optgroup>` : items.join("")))
    .join("")
  return `<option value="">Choose a cost code</option>${kept}${body}`
}

function workLinesHtml(draft: LogDraft, form: FieldDailyLogForm | null, required: boolean, errors: ReadonlyMap<string, string>, escape: Escape): string {
  if (!form) {
    return `<div class="work-lines"><p class="field-label">Cost codes and time</p><p class="field-hint">Cost codes download with the project. Refresh the project while you have service to add them.</p></div>`
  }
  if (form.costCodes.length === 0) {
    return `<div class="work-lines"><p class="field-label">Cost codes and time</p><p class="field-hint">This job's cost codes are added in Compass in the browser.</p></div>`
  }
  const rows = draft.workLines
    .map((line, index) => {
      const codeKey = `workLines.${index}.costCode`
      const hoursKey = `workLines.${index}.hours`
      const todoTitle = line.todoId ? form.followUps?.openTodos.find((todo) => todo.id === line.todoId)?.title : undefined
      return `<div class="work-line">
        ${todoTitle ? `<p class="field-hint">For the to-do: ${escape(todoTitle)}</p>` : ""}
        <label class="field">Cost code ${index + 1}<select id="log-line-${index}-costCode" name="${codeKey}"${invalidAttrs(errors, codeKey, escape)}>${costCodeOptions(form, line.costCode, escape)}</select>${errorText(errors, codeKey, escape)}</label>
        <div class="work-line-row">
          <label class="field hours-field">Hours<input id="log-line-${index}-hours" name="${hoursKey}" inputmode="decimal" placeholder="e.g. 2.5" value="${escape(line.hours)}"${invalidAttrs(errors, hoursKey, escape)} />${errorText(errors, hoursKey, escape)}</label>
          <label class="field">What was done<input name="workLines.${index}.description" maxlength="500" placeholder="Brief description" value="${escape(line.description)}" /></label>
        </div>
        <button class="text-button remove-line" type="button" data-remove-work-line="${index}">Remove cost code ${index + 1}</button>
      </div>`
    })
    .join("")
  return `<fieldset class="work-lines"${errors.has("workLines") ? ` aria-describedby="log-workLines-error"` : ""}>
    <legend class="field-label">Cost codes and time${requiredTag(required)}</legend>
    ${rows}
    ${errorText(errors, "workLines", escape)}
    <div class="work-lines-footer"><button class="secondary" type="button" data-add-work-line>Add cost code</button><span class="field-hint" data-total-hours>Total ${escape(totalHoursLabel(draft.workLines))}</span></div>
  </fieldset>`
}

function optionalFieldHtml(field: DailyLogOptionalField, draft: LogDraft, requirements: DailyLogRequirements, errors: ReadonlyMap<string, string>, escape: Escape): string {
  const ui = OPTIONAL_FIELD_UI[field]
  const control = ui.multiline
    ? `<textarea id="log-${field}" name="${field}" placeholder="${escape(ui.placeholder)}"${invalidAttrs(errors, field, escape)}>${escape(draft[field])}</textarea>`
    : `<input id="log-${field}" name="${field}" placeholder="${escape(ui.placeholder)}" value="${escape(draft[field])}"${invalidAttrs(errors, field, escape)} />`
  return `<label class="field"><span>${escape(DAILY_LOG_FIELD_LABELS[field])}${requiredTag(isRequired(requirements, field))}</span>${control}${errorText(errors, field, escape)}</label>`
}

export function saveButtonLabel(state: LogSaveState, online: boolean): string {
  if (state === "synced") return "✓ Saved and synced"
  if (state === "saved") return online ? "✓ Saved, syncing" : "✓ Saved on this phone"
  return online ? "Save and sync" : "Save for sync"
}

/** The form's fields (everything but attachments and the save button). */
export function logFieldsHtml(input: {
  readonly draft: LogDraft
  readonly form: FieldDailyLogForm | null
  readonly errors: ReadonlyMap<string, string>
  readonly escape: Escape
}): string {
  const { draft, form, errors, escape } = input
  const requirements = logRequirements(form)
  const setup = form?.followUps ?? null
  const summary = errors.size > 0
    ? `<p class="form-alert" role="alert">${escape(errors.size === 1 ? "1 required item needs attention. Everything you entered is still here." : `${errors.size} required items need attention. Everything you entered is still here.`)}</p>`
    : ""
  return `${summary}
    <label class="field"><span>Date${requiredTag(true)}</span><input id="log-logDate" name="logDate" type="date" value="${escape(draft.logDate)}"${invalidAttrs(errors, "logDate", escape)} />${errorText(errors, "logDate", escape)}</label>
    ${setup ? blockedTodosHtml(setup, draft.followUps, escape) : ""}
    ${setup ? todoChecklistHtml(setup, draft.followUps, form?.costCodes ?? [], escape) : ""}
    ${workLinesHtml(draft, form, requirements.requireCostCodeTime, errors, escape)}
    <label class="field"><span>What did we complete?${requiredTag(true)}</span><textarea id="log-workCompleted" name="workCompleted" placeholder="Describe today's work"${invalidAttrs(errors, "workCompleted", escape)}>${escape(draft.workCompleted)}</textarea>${errorText(errors, "workCompleted", escape)}</label>
    ${DAILY_LOG_OPTIONAL_FIELDS.map((field) => {
      const html = optionalFieldHtml(field, draft, requirements, errors, escape)
      if (!setup) return html
      if (field === "issues" || field === "notes") {
        return html + lineTodosHtml(field, draft[field], setup, draft.followUps, form?.costCodes ?? [], escape)
      }
      if (field === "visitorLog") return html + clientContactsHtml(setup, draft.followUps, draft.visitorLog, errors, escape)
      return html
    }).join("")}`
}

export function errorMap(errors: readonly { readonly key: string; readonly message: string }[]): ReadonlyMap<string, string> {
  return new Map(errors.map((error) => [error.key, error.message]))
}
