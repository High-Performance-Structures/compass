"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconChevronDown, IconSearch } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  updateStaffMessages,
  type StaffMessageAssigneeDto,
  type StaffMessageDeskRecordDto,
} from "@/app/actions/staff-message-desk"
import { AgingTowers, type AgingTower } from "@/components/staff-message-desk/aging-towers"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  STAFF_MESSAGE_AGING,
  STAFF_MESSAGE_AGING_LABEL,
  STAFF_MESSAGE_STATUSES,
  STAFF_MESSAGE_STATUS_LABEL,
  idleLabel,
  staffMessageAging,
  type StaffMessageAging,
  type StaffMessageAgingLevel,
  type StaffMessageAgingThresholds,
} from "@/lib/staff-message-desk/triage"
import { cn } from "@/lib/utils"

type DeskFilter = "open" | "mine" | "attention" | "closed" | "all"

const FILTERS: readonly { readonly id: DeskFilter; readonly label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Assigned to me" },
  { id: "attention", label: "Needs attention" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
]

const AGING_RANK: Readonly<Record<StaffMessageAgingLevel, number>> = { stale: 0, aging: 1, needs_response: 2, fresh: 3 }

const AGING_BADGE: Readonly<Record<StaffMessageAgingLevel, string>> = {
  fresh: "",
  needs_response: "border-info text-info",
  aging: "border-warning text-warning",
  stale: "border-destructive text-destructive",
}

const STATUS_OPTIONS = STAFF_MESSAGE_STATUSES.map((status) => ({ value: status, label: STAFF_MESSAGE_STATUS_LABEL[status] }))

function businessDays(days: number): string {
  return `${days} business ${days === 1 ? "day" : "days"}`
}

function timestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

type Row = StaffMessageDeskRecordDto & { readonly aging: StaffMessageAging }

function MessageRow({
  row,
  selected,
  onToggle,
  assignees,
  expanded,
  onExpand,
  onUpdate,
  pending,
}: {
  readonly row: Row
  readonly selected: boolean
  readonly onToggle: () => void
  readonly assignees: readonly StaffMessageAssigneeDto[]
  readonly expanded: boolean
  readonly onExpand: () => void
  readonly onUpdate: (input: { readonly status?: string; readonly assigneeUserId?: string; readonly note?: string }, done?: () => void) => void
  readonly pending: boolean
}): React.ReactElement {
  const [note, setNote] = React.useState("")
  const [reassignTo, setReassignTo] = React.useState("")
  const closed = row.status === "closed"
  const flag = row.aging.level
  return (
    <article
      id={`message-${row.id}`}
      className={cn("border-b py-3 last:border-b-0", flag === "stale" && "border-l-2 border-l-destructive pl-3", flag === "aging" && "border-l-2 border-l-warning pl-3")}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 rounded border accent-primary"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.subject}`}
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onExpand} aria-expanded={expanded}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("font-semibold", closed && "text-muted-foreground line-through decoration-muted-foreground/40")}>{row.subject}</h3>
            <Badge variant="outline">{row.sourceType === "call" ? "Call" : "Message"}</Badge>
            <Badge variant={row.status === "new" ? "default" : "secondary"}>{STAFF_MESSAGE_STATUS_LABEL[row.status]}</Badge>
            {flag !== "fresh" ? (
              <Badge variant="outline" className={AGING_BADGE[flag]}>
                {STAFF_MESSAGE_AGING_LABEL[flag]} · {idleLabel(row.aging.idleDays)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.callerName}
            {row.callerCompany ? ` · ${row.callerCompany}` : ""}
            {row.callerPhone ? ` · ${row.callerPhone}` : ""}
            {row.callerEmail ? ` · ${row.callerEmail}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.assigneeName} · received {timestamp(row.createdAt)} · last activity {timestamp(row.lastActivityAt)}
          </p>
        </button>
        <IconChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-4 pl-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <p className="whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">{row.body}</p>
            {row.history.length > 0 ? (
              <ol className="space-y-2 border-t pt-3 text-sm" aria-label="Message history">
                {row.history.map((event) => (
                  <li key={event.id}>
                    <p className="text-xs text-muted-foreground">
                      {timestamp(event.createdAt)} · {event.actorName}
                    </p>
                    {event.note ? <p className="whitespace-pre-wrap">{event.note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="border-t pt-3 text-xs text-muted-foreground">No follow-up recorded yet.</p>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {row.status !== "in_progress" && !closed ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => onUpdate({ status: "in_progress" })}>
                  Start
                </Button>
              ) : null}
              {row.status !== "waiting_on_contact" && !closed ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => onUpdate({ status: "waiting_on_contact" })}>
                  Waiting on contact
                </Button>
              ) : null}
              {closed ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => onUpdate({ status: "in_progress" })}>
                  Reopen
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => onUpdate({ status: "closed", note: note || undefined }, () => setNote(""))}>
                  Close
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Textarea
                rows={3}
                maxLength={4000}
                value={note}
                disabled={pending}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Follow-up note: who you called, what was decided, what's next"
                aria-label={`Follow-up note for ${row.subject}`}
              />
              <Button size="sm" variant="secondary" disabled={pending || !note.trim()} onClick={() => onUpdate({ note }, () => setNote(""))}>
                Add note
              </Button>
            </div>
            {assignees.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <SearchableCombobox
                  className="h-8 w-[200px] bg-background"
                  popoverClassName="min-w-[14rem]"
                  value={reassignTo}
                  onValueChange={setReassignTo}
                  options={assignees.filter((assignee) => assignee.id !== row.assigneeUserId).map((assignee) => ({ value: assignee.id, label: assignee.name, description: assignee.email }))}
                  ariaLabel={`Reassign ${row.subject}`}
                  placeholder="Reassign to…"
                  searchPlaceholder="Search staff..."
                  emptyMessage="No matching staff."
                  disabled={pending}
                />
                <Button size="sm" variant="outline" disabled={pending || !reassignTo} onClick={() => onUpdate({ assigneeUserId: reassignTo }, () => setReassignTo(""))}>
                  Reassign
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

/**
 * The Message Desk list: aging towers, filters, selection with bulk status
 * and reassignment, and per-message follow-up with history.
 */
export function MessageDeskBoard({
  records,
  assignees,
  viewerId,
  nowIso,
  thresholds = STAFF_MESSAGE_AGING,
}: {
  readonly records: readonly StaffMessageDeskRecordDto[]
  readonly assignees: readonly StaffMessageAssigneeDto[]
  readonly viewerId: string
  readonly nowIso: string
  readonly thresholds?: StaffMessageAgingThresholds
}): React.ReactElement {
  const router = useRouter()
  const [filter, setFilter] = React.useState<DeskFilter>("open")
  const [agingFilter, setAgingFilter] = React.useState<StaffMessageAgingLevel | null>(null)
  const [query, setQuery] = React.useState("")
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set())
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [bulkStatus, setBulkStatus] = React.useState("")
  const [bulkAssignee, setBulkAssignee] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  const rows = React.useMemo<readonly Row[]>(() => {
    const now = new Date(nowIso)
    return records.map((record) => ({ ...record, aging: staffMessageAging(record, now, thresholds) }))
  }, [nowIso, records, thresholds])

  const open = rows.filter((row) => row.status !== "closed")
  const towers: readonly AgingTower[] = [
    { level: "stale", label: "Stale", hint: `No activity for ${businessDays(thresholds.staleDays)} or more`, count: open.filter((row) => row.aging.level === "stale").length },
    { level: "aging", label: "Aging", hint: `No activity for ${businessDays(thresholds.agingDays)} or more`, count: open.filter((row) => row.aging.level === "aging").length },
    { level: "needs_response", label: "Needs first response", hint: `New for more than ${businessDays(thresholds.firstResponseDays)}`, count: open.filter((row) => row.aging.level === "needs_response").length },
    { level: "fresh", label: "On track", hint: "Open with recent activity", count: open.filter((row) => row.aging.level === "fresh").length },
  ]

  const normalizedQuery = query.trim().toLowerCase()
  const visible = rows
    .filter((row) => {
      if (filter === "open" && row.status === "closed") return false
      if (filter === "mine" && (row.assigneeUserId !== viewerId || row.status === "closed")) return false
      if (filter === "attention" && (row.status === "closed" || row.aging.level === "fresh")) return false
      if (filter === "closed" && row.status !== "closed") return false
      if (agingFilter && (row.status === "closed" || row.aging.level !== agingFilter)) return false
      if (!normalizedQuery) return true
      return `${row.subject} ${row.callerName} ${row.callerCompany ?? ""} ${row.callerPhone ?? ""} ${row.callerEmail ?? ""} ${row.body} ${row.assigneeName}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
    // Most urgent first, then oldest activity first so nothing hides at the bottom.
    .sort((a, b) =>
      (a.status === "closed" ? 1 : 0) - (b.status === "closed" ? 1 : 0) ||
      AGING_RANK[a.aging.level] - AGING_RANK[b.aging.level] ||
      (a.status === "closed" ? b.lastActivityAt.localeCompare(a.lastActivityAt) : a.lastActivityAt.localeCompare(b.lastActivityAt)),
    )

  const selectedVisible = visible.filter((row) => selectedIds.has(row.id)).map((row) => row.id)
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length

  function run(
    ids: readonly string[],
    input: { readonly status?: string; readonly assigneeUserId?: string; readonly note?: string },
    done?: () => void,
  ): void {
    startTransition(async () => {
      const result = await updateStaffMessages({ ids, ...input })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.data.updated === 1 ? "Message updated." : `${result.data.updated} messages updated.`)
      done?.()
      router.refresh()
    })
  }

  return (
    <section className="space-y-4" aria-labelledby="active-staff-messages">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <h2 id="active-staff-messages" className="text-lg font-semibold">Messages</h2>
        <p className="text-xs text-muted-foreground">
          {open.length} open · first response within {businessDays(thresholds.firstResponseDays)}
        </p>
      </div>

      <AgingTowers towers={towers} activeLevel={agingFilter} onSelect={(level) => {
        setAgingFilter(level)
        if (level) setFilter("open")
      }} />

      <div className="flex flex-wrap items-center gap-2 border-y py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Message filter">
          {FILTERS.map((option) => (
            <Button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              size="sm"
              variant={filter === option.id ? "secondary" : "ghost"}
              onClick={() => {
                setFilter(option.id)
                setAgingFilter(null)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" className="h-8 pl-8" aria-label="Search messages" />
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border accent-primary"
              checked={allVisibleSelected}
              onChange={() =>
                setSelectedIds((current) => {
                  const next = new Set(current)
                  for (const row of visible) {
                    if (allVisibleSelected) next.delete(row.id)
                    else next.add(row.id)
                  }
                  return next
                })
              }
            />
            {selectedVisible.length > 0 ? `${selectedVisible.length} selected` : `Select all ${visible.length}`}
          </label>
          {selectedVisible.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" role="region" aria-label="Update selected messages">
              <SearchableCombobox
                className="h-8 w-[180px] bg-background"
                value={bulkStatus}
                onValueChange={setBulkStatus}
                options={STATUS_OPTIONS}
                ariaLabel="New status for selected messages"
                placeholder="Set status…"
                disabled={pending}
              />
              <Button size="sm" variant="outline" disabled={pending || !bulkStatus} onClick={() => run(selectedVisible, { status: bulkStatus }, () => {
                setBulkStatus("")
                setSelectedIds(new Set())
              })}>
                Apply
              </Button>
              {assignees.length > 0 ? (
                <>
                  <SearchableCombobox
                    className="h-8 w-[200px] bg-background"
                    popoverClassName="min-w-[14rem]"
                    value={bulkAssignee}
                    onValueChange={setBulkAssignee}
                    options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.name, description: assignee.email }))}
                    ariaLabel="Reassign selected messages"
                    placeholder="Reassign to…"
                    searchPlaceholder="Search staff..."
                    emptyMessage="No matching staff."
                    disabled={pending}
                  />
                  <Button size="sm" variant="outline" disabled={pending || !bulkAssignee} onClick={() => run(selectedVisible, { assigneeUserId: bulkAssignee }, () => {
                    setBulkAssignee("")
                    setSelectedIds(new Set())
                  })}>
                    Reassign
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {records.length === 0
            ? "No message records yet."
            : filter === "attention" || agingFilter
              ? "Nothing needs attention. Every open message has recent follow-up."
              : "No messages match this view."}
        </p>
      ) : (
        <div>
          {visible.map((row) => (
            <MessageRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              onToggle={() =>
                setSelectedIds((current) => {
                  const next = new Set(current)
                  if (next.has(row.id)) next.delete(row.id)
                  else next.add(row.id)
                  return next
                })
              }
              assignees={assignees}
              expanded={expandedId === row.id}
              onExpand={() => setExpandedId((current) => (current === row.id ? null : row.id))}
              onUpdate={(input, done) => run([row.id], input, done)}
              pending={pending}
            />
          ))}
        </div>
      )}
    </section>
  )
}
