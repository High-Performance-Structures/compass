"use client"

import { ON_BUDGET_GROUP, INTERNAL_CODES_GROUP } from "@/lib/daily-logs/cost-code-groups"

import * as React from "react"
import { IconBan, IconCheck, IconInfoCircle, IconPlus, IconUserCheck } from "@tabler/icons-react"

import { RecordStatusBadge } from "@/components/record-status-badge"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { FieldError } from "@/components/projects/daily-log-work-lines"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { DailyLogCostCodeOption } from "@/lib/daily-logs/daily-log-form"
import {
  clientContactsNamedIn,
  DAILY_LOG_INTERACTION_TYPES,
  DAILY_LOG_TODO_TYPE_LABELS,
  dailyLogTodoFilterOptions,
  dailyLogTodoMatchesFilter,
  emptyClientContactRow,
  followUpLines,
  isLineFlagged,
  lineChoice,
  lineTodoKey,
  summaryCountHint,
  todoTitleKey,
  toggleLineTodo,
  type DailyLogClientContactOption,
  type DailyLogClientContactRow,
  type DailyLogFollowUpDraft,
  type DailyLogFollowUpRules,
  type DailyLogLineTodoChoice,
  type DailyLogOpenTodo,
  type DailyLogTodoFilter,
  type DailyLogTodoType,
} from "@/lib/daily-logs/log-followups"
import { projectTodoTypeLabel } from "@/lib/project-todos"
import { statusLabel } from "@/lib/project-operations/status"
import { cn } from "@/lib/utils"

type Assignee = { readonly name: string; readonly kind: DailyLogTodoType }

function formatShortDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function whoFor(todo: DailyLogOpenTodo): string {
  const who = todo.assigneeName || todo.companyName
  return who ? `${projectTodoTypeLabel(todo.recordType)} · ${who}` : projectTodoTypeLabel(todo.recordType)
}

function costCodeLabel(code: string | null, costCodes: readonly DailyLogCostCodeOption[]): string | null {
  if (!code) return null
  return costCodes.find((option) => option.code === code)?.label ?? code
}

/** Blocked to-dos carried forward: the crew says whether each is still blocked. */
export function DailyLogBlockedTodos({
  todos,
  draft,
  onChange,
}: {
  readonly todos: readonly DailyLogOpenTodo[]
  readonly draft: DailyLogFollowUpDraft
  readonly onChange: (draft: DailyLogFollowUpDraft) => void
}): React.ReactElement | null {
  if (todos.length === 0) return null
  function answer(todoId: string, value: "still" | "cleared"): void {
    const current = draft.blocked[todoId]
    if (current === value) {
      onChange({ ...draft, blocked: Object.fromEntries(Object.entries(draft.blocked).filter(([id]) => id !== todoId)) })
      return
    }
    onChange({ ...draft, blocked: { ...draft.blocked, [todoId]: value } })
  }
  return (
    <section aria-labelledby="daily-log-blocked-title" className="grid gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
      <h3 id="daily-log-blocked-title" className="flex items-center gap-2 text-sm font-medium">
        <IconBan className="size-4 text-warning" aria-hidden="true" />
        Blocked to-dos
      </h3>
      {todos.map((todo) => {
        const current = draft.blocked[todo.id]
        return (
          <div key={todo.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-warning/30 pt-2 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{todo.title}</p>
              <p className="text-xs text-muted-foreground">
                {whoFor(todo)} · blocked since {formatShortDate(todo.changedOn)}
              </p>
            </div>
            <div className="flex gap-2" role="group" aria-label={`Is "${todo.title}" still blocked?`}>
              <Button type="button" size="sm" variant={current === "still" ? "default" : "outline"} aria-pressed={current === "still"} onClick={() => answer(todo.id, "still")}>
                Still blocked
              </Button>
              <Button type="button" size="sm" variant={current === "cleared" ? "default" : "outline"} aria-pressed={current === "cleared"} onClick={() => answer(todo.id, "cleared")}>
                Cleared today
              </Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/**
 * The project's open to-dos, each with two choices: Worked on (records the
 * day's work) and Completed (also moves it to the company's done status when
 * the log is saved, where the company allows it).
 */
export function DailyLogTodoChecklist({
  idPrefix,
  todos,
  costCodes,
  rules,
  worked,
  completed,
  doneLabel,
  onToggle,
  onToggleCompleted,
}: {
  readonly idPrefix: string
  readonly todos: readonly DailyLogOpenTodo[]
  readonly costCodes: readonly DailyLogCostCodeOption[]
  readonly rules: DailyLogFollowUpRules
  readonly worked: readonly string[]
  readonly completed: readonly string[]
  /** The company's name for a finished to-do. */
  readonly doneLabel: string
  readonly onToggle: (todo: DailyLogOpenTodo) => void
  readonly onToggleCompleted: (todo: DailyLogOpenTodo) => void
}): React.ReactElement | null {
  const [filter, setFilter] = React.useState<DailyLogTodoFilter>("all")
  if (todos.length === 0) return null
  const canComplete = rules.todosCanComplete
  const done = canComplete ? completed : []
  const shown = todos.filter((todo) => dailyLogTodoMatchesFilter(todo, filter, worked, done))
  const workedCount = todos.filter((todo) => worked.includes(todo.id) || done.includes(todo.id)).length
  return (
    <fieldset className="grid gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <legend className="text-sm font-medium">Open to-dos on this job</legend>
        <p className="text-xs text-muted-foreground tabular-nums">
          {workedCount} worked on{canComplete && done.length > 0 ? ` · ${done.length} completed` : ""}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Tick what was worked on today{canComplete ? ", or Completed when it's finished" : ""}.
        {rules.tickAddsLine ? " A to-do with a cost code adds a line below for its hours." : ""}
      </p>
      {todos.length > 1 && (
        <StatusFilterBar
          kind="button"
          label="Filter to-dos by status"
          options={dailyLogTodoFilterOptions(todos, worked, done, "Completed")}
          selected={filter}
          onSelect={setFilter}
        />
      )}
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No to-dos match this filter.</p>}
      <ul className="grid divide-y border-y empty:hidden">
        {shown.map((todo) => {
          const isCompleted = done.includes(todo.id)
          // A company can keep a blocked to-do blocked until the block is cleared (Settings).
          const keepsBlock = todo.status === "blocked" && rules.completeClearsBlock === false
          const checked = worked.includes(todo.id) || isCompleted
          const id = `${idPrefix}-todo-${todo.id}`
          const code = rules.todoCostCodes ? costCodeLabel(todo.costCode, costCodes) : null
          // The workflow moves the built-in "open" to "in_progress"; names come from the company's statuses.
          const label = todo.statusLabel ?? statusLabel(todo.status)
          const next = isCompleted
            ? `${label} → ${doneLabel}`
            : checked && todo.status === "open" && rules.workedMovesToInProgress ? `${label} → In progress` : label
          return (
            <li key={todo.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 py-2", checked && "bg-accent/40")}>
              <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                <span className="text-sm font-medium break-words">{todo.title}</span>
                <span className="text-xs text-muted-foreground">
                  {whoFor(todo)}
                  {next !== label ? ` · ${next}` : ""}
                  {code ? ` · ${code}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <RecordStatusBadge label={label} color={todo.statusColor ?? "gray"} />
                <span className="flex items-center gap-1.5">
                  <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(todo)} aria-label={`Worked on: ${todo.title}`} />
                  <Label htmlFor={id} className="text-xs font-normal">Worked on</Label>
                </span>
                {canComplete && keepsBlock && !isCompleted && (
                  <span className="text-xs text-muted-foreground">Clear the block to complete</span>
                )}
                {canComplete && (!keepsBlock || isCompleted) && (
                  <span className="flex items-center gap-1.5">
                    <Checkbox
                      id={`${id}-completed`}
                      checked={isCompleted}
                      onCheckedChange={() => onToggleCompleted(todo)}
                      aria-label={`Completed: ${todo.title}`}
                    />
                    <Label htmlFor={`${id}-completed`} className="text-xs font-normal">Completed</Label>
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <IconInfoCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
        {canComplete
          ? `Worked on records the work${rules.workedMovesToInProgress ? " and moves an Open to-do to In progress" : ""}. Completed also moves it to ${doneLabel} when the log is saved, signed off on this log's date.`
          : `Ticking records the work${rules.workedMovesToInProgress ? " and moves an Open to-do to In progress" : ""}. It never marks a to-do finished; a person does that on the to-do.`}
      </p>
    </fieldset>
  )
}

/** The flagged lines of Issues or Notes / next steps, each with Make to-do. */
export function DailyLogLineTodos({
  idPrefix,
  source,
  text,
  rules,
  draft,
  assignees,
  costCodes,
  onChange,
  madeTitles,
}: {
  readonly idPrefix: string
  readonly source: "issues" | "notes"
  readonly text: string
  readonly rules: DailyLogFollowUpRules
  readonly draft: DailyLogFollowUpDraft
  readonly assignees: readonly Assignee[]
  readonly costCodes: readonly DailyLogCostCodeOption[]
  readonly onChange: (draft: DailyLogFollowUpDraft) => void
  /** On a saved log: lines that are already to-dos, by todoTitleKey. */
  readonly madeTitles?: ReadonlySet<string>
}): React.ReactElement | null {
  const lines = followUpLines(text)
  const codeOptions = React.useMemo(
    () => costCodes.map((option) => ({ value: option.code, browseGroup: option.group, onBudget: option.group === ON_BUDGET_GROUP || option.group === INTERNAL_CODES_GROUP, label: option.label, keywords: `${option.code} ${option.name}`, unlisted: option.unlisted })),
    [costCodes],
  )
  if (rules.todoMode === "off" || rules.todoTypes.length === 0 || lines.length === 0) return null

  function choose(key: string, patch: Partial<DailyLogLineTodoChoice>): void {
    const current = lineChoice(draft, rules, key)
    const next = { ...current, ...patch }
    // A new type clears an assignee who isn't that kind of person.
    const keepAssignee = patch.recordType === undefined || assignees.some((person) => person.kind === next.recordType && person.name === current.assigneeName)
    onChange({ ...draft, lineTodos: { ...draft.lineTodos, [key]: keepAssignee ? next : { ...next, assigneeName: "" } } })
  }

  return (
    <ul className="grid gap-2" aria-label={source === "issues" ? "Issues as to-dos" : "Next steps as to-dos"}>
      {lines.map((line, index) => {
        const key = lineTodoKey(source, line)
        const flagged = isLineFlagged(draft, rules.todoMode, key)
        const choice = lineChoice(draft, rules, key)
        const people = assignees
          .filter((person) => person.kind === choice.recordType)
          .map((person) => ({ value: person.name, label: person.name }))
        const base = `${idPrefix}-${source}-line-${index}`
        if (madeTitles?.has(todoTitleKey(line))) {
          return (
            <li key={key} className="flex items-start justify-between gap-3 border-b pb-2">
              <p className="min-w-0 text-sm break-words whitespace-pre-wrap">{line}</p>
              <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-xs text-muted-foreground">
                <IconCheck className="size-3.5 text-success" aria-hidden="true" />
                To-do made
              </span>
            </li>
          )
        }
        return (
          <li key={key} className={cn("grid gap-2 border-b pb-2", flagged && "border-success/30")}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm break-words whitespace-pre-wrap">{line}</p>
              <Button
                type="button"
                size="sm"
                variant={flagged ? "default" : "outline"}
                aria-pressed={flagged}
                onClick={() => onChange(toggleLineTodo(draft, rules, key))}
              >
                {flagged ? "To-do ✓" : "Make to-do"}
              </Button>
            </div>
            {flagged && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label htmlFor={`${base}-type`} className="text-xs text-muted-foreground">Type</Label>
                  <Select value={choice.recordType} onValueChange={(value) => {
                    const recordType = rules.todoTypes.find((type) => type === value)
                    if (recordType) choose(key, { recordType })
                  }}>
                    <SelectTrigger id={`${base}-type`} size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {rules.todoTypes.map((type) => (
                        <SelectItem key={type} value={type}>{DAILY_LOG_TODO_TYPE_LABELS[type]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${base}-assignee`} className="text-xs text-muted-foreground">Assign to</Label>
                  <SearchableCombobox
                    id={`${base}-assignee`}
                    ariaLabel={`Assign the to-do "${line}"`}
                    options={people}
                    value={choice.assigneeName}
                    onValueChange={(assigneeName) => {
                      if (assigneeName && assigneeName !== choice.assigneeName) choose(key, { assigneeName })
                    }}
                    placeholder="Office assigns"
                    searchPlaceholder="Search people..."
                    emptyMessage="No one of that kind on this job."
                    className="h-8"
                  />
                </div>
                {rules.crewPicksCostCode && (
                  <div className="grid gap-1">
                    <Label htmlFor={`${base}-code`} className="text-xs text-muted-foreground">Cost code</Label>
                    <SearchableCombobox
                      id={`${base}-code`}
                      ariaLabel={`Cost code for the to-do "${line}"`}
                      options={codeOptions}
                      value={choice.costCode}
                      onValueChange={(costCode) => {
                        if (costCode && costCode !== choice.costCode) choose(key, { costCode })
                      }}
                      placeholder="No cost code"
                      searchPlaceholder="Search cost codes..."
                      emptyMessage="No matching cost codes."
                      className="h-8"
                    />
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function nextRowKey(): string {
  return crypto.randomUUID()
}

/** Client contact made today, saved as client interactions with the log. */
export function DailyLogClientContacts({
  idPrefix,
  rules,
  contacts,
  visitorLog,
  draft,
  errors,
  onChange,
}: {
  readonly idPrefix: string
  readonly rules: DailyLogFollowUpRules
  readonly contacts: readonly DailyLogClientContactOption[]
  readonly visitorLog: string
  readonly draft: DailyLogFollowUpDraft
  readonly errors: ReadonlyMap<string, string>
  readonly onChange: (draft: DailyLogFollowUpDraft) => void
}): React.ReactElement | null {
  if (!rules.clientContact) return null
  const contactOptions = contacts.map((contact) => ({
    value: contact.id,
    label: contact.role ? `${contact.name} · ${contact.role}` : contact.name,
    selectedLabel: contact.name,
    keywords: `${contact.name} ${contact.role ?? ""}`,
  }))
  const named = rules.clientContactSuggest && !draft.suggestionDismissed && draft.contacts.length === 0
    ? clientContactsNamedIn(visitorLog, contacts)
    : []
  const suggested = named[0]

  function update(key: string, patch: Partial<DailyLogClientContactRow>): void {
    onChange({ ...draft, contacts: draft.contacts.map((row) => (row.key === key ? { ...row, ...patch } : row)) })
  }

  return (
    <section aria-labelledby={`${idPrefix}-contacts-title`} className="grid gap-3">
      <div>
        <h3 id={`${idPrefix}-contacts-title`} className="text-sm font-medium">Client contact</h3>
        <p className="text-xs text-muted-foreground">
          Talked with, texted or met the client today? Log it here. It counts as client contact for follow-up.
        </p>
      </div>
      {contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">This job has no client contacts yet. Add them on the Contacts page.</p>
      )}
      {suggested && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
          <span className="min-w-0">
            Visitors mentions {suggested.name}{suggested.role ? `, ${suggested.role.toLowerCase()}` : ""}. Log it as client contact?
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...draft, suggestionDismissed: true })}>
              Not now
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onChange({ ...draft, contacts: [emptyClientContactRow(nextRowKey(), suggested.id, "site_visit")] })}
            >
              <IconUserCheck className="size-4" />
              Log it
            </Button>
          </div>
        </div>
      )}
      {draft.contacts.map((row, index) => {
        const base = `${idPrefix}-contact-${index}`
        const hint = summaryCountHint(row.summary, rules.minimumSummaryCharacters)
        const summaryError = errors.get(`clientContacts.${index}.summary`)
        const whoError = errors.get(`clientContacts.${index}.contactId`)
        const timeError = errors.get(`clientContacts.${index}.time`)
        return (
          <div key={row.key} className="grid gap-3 border-y py-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem]">
              <div className="grid gap-1">
                <Label htmlFor={`${base}-who`}>Who</Label>
                <SearchableCombobox
                  id={`${base}-who`}
                  ariaLabel={`Client contact ${index + 1}`}
                  ariaDescribedBy={whoError ? `${base}-who-error` : undefined}
                  options={contactOptions}
                  value={row.contactId}
                  onValueChange={(contactId) => {
                    if (contactId && contactId !== row.contactId) update(row.key, { contactId })
                  }}
                  placeholder="Choose a client contact"
                  searchPlaceholder="Search client contacts..."
                  emptyMessage="No client contacts on this job."
                  className={cn("h-9", whoError && "border-destructive")}
                />
                <FieldError id={`${base}-who-error`} message={whoError} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${base}-type`}>Type</Label>
                <Select value={row.interactionType} onValueChange={(interactionType) => update(row.key, { interactionType })}>
                  <SelectTrigger id={`${base}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAILY_LOG_INTERACTION_TYPES.map((type) => (
                      <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${base}-time`}>Time</Label>
                <Input
                  id={`${base}-time`}
                  type="time"
                  value={row.time}
                  onChange={(event) => update(row.key, { time: event.currentTarget.value })}
                  aria-invalid={timeError ? true : undefined}
                  aria-describedby={timeError ? `${base}-time-error` : undefined}
                />
                <FieldError id={`${base}-time-error`} message={timeError} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Who reached out">
              <Button type="button" size="sm" variant={row.direction === "outbound" ? "default" : "outline"} aria-pressed={row.direction === "outbound"} onClick={() => update(row.key, { direction: "outbound" })}>
                We reached them
              </Button>
              <Button type="button" size="sm" variant={row.direction === "inbound" ? "default" : "outline"} aria-pressed={row.direction === "inbound"} onClick={() => update(row.key, { direction: "inbound" })}>
                They reached us
              </Button>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${base}-summary`}>What happened</Label>
              <Textarea
                id={`${base}-summary`}
                value={row.summary}
                onChange={(event) => update(row.key, { summary: event.currentTarget.value })}
                placeholder="Who you spoke with, what was said or sent, next step"
                aria-invalid={summaryError ? true : undefined}
                aria-describedby={`${base}-summary-hint`}
              />
              <p id={`${base}-summary-hint`} className={cn("text-xs", summaryError ? "text-destructive" : hint ? "text-muted-foreground" : "text-success")}>
                {summaryError ?? hint ?? "Counts as client contact"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${base}-todo`}
                  checked={row.followUpTodo}
                  onCheckedChange={(checked) => update(row.key, { followUpTodo: checked === true })}
                />
                <Label htmlFor={`${base}-todo`} className="font-normal">Make a follow-up to-do from this</Label>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...draft, contacts: draft.contacts.filter((other) => other.key !== row.key) })}>
                Remove
              </Button>
            </div>
          </div>
        )
      })}
      {contacts.length > 0 && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...draft, contacts: [...draft.contacts, emptyClientContactRow(nextRowKey())] })}>
            <IconPlus className="size-4" />
            Add client contact
          </Button>
        </div>
      )}
    </section>
  )
}
