"use client"

/*
 * The pay request's G703 billing grid (the "Billing" work area): lines grouped
 * by division, assembly or cost code. Each group folds to one line with its
 * totals and percent box, so a whole group can be billed without opening it;
 * groups with an over-billed line or a failed save open by themselves. The
 * column header stays put while the grid scrolls.
 */

import { useId, useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconChevronRight, IconDeviceFloppy } from "@tabler/icons-react"

import {
  setProjectOwnerPayApplicationPercentComplete,
  updateProjectOwnerPayApplicationLine,
  type ProjectOwnerPayApplicationLine,
} from "@/app/actions/project-financial-workflows"
import type { PayApplicationShopTicketState } from "@/lib/financials/pay-application-shop-tickets"
import {
  lineChangeOrderKey,
  lineChangeOrderLabel,
  overBilledAmount,
  overBilledLines,
  type LineChangeOrder,
} from "@/lib/financials/pay-application-line-checks"
import { payRequestGroupsOpenByDefault } from "@/lib/financials/pay-request-work-areas"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { formatCents, formatDollars } from "@/lib/format"
import { cn } from "@/lib/utils"

export function fieldNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").replaceAll(/[$,\s]/g, "")
  if (!raw) return 0
  // Accounting-style credits such as (3,230.00) read as negative amounts.
  const credit = /^\((.*)\)$/.exec(raw)
  const value = credit ? -Number(credit[1]) : Number(raw)
  return Number.isFinite(value) ? value : null
}

export type ShopTicketProvenance = PayApplicationShopTicketState["lineProvenance"][number]

const LINE_GRID =
  "lg:grid-cols-[minmax(14rem,1.6fr)_repeat(8,minmax(6.5rem,.7fr))_auto]"

function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1_000) / 10 : 0
}

function PayApplicationLineEditor({
  projectId,
  applicationId,
  line,
  editable,
  onMessage,
  onSaveFailed,
  shopTickets,
  changeOrders,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly line: ProjectOwnerPayApplicationLine
  readonly editable: boolean
  readonly onMessage: (message: string) => void
  /** Keeps the row's group open so the error stays in view. */
  readonly onSaveFailed: () => void
  readonly shopTickets: ShopTicketProvenance | undefined
  readonly changeOrders: readonly LineChangeOrder[]
}): React.ReactElement {
  const overBilled = overBilledAmount(line)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [ownerVisible, setOwnerVisible] = useState(line.ownerVisible)
  // A failed save keeps the typed values and shows why on this row, so the
  // error is not lost in the page-level message far above a long G703.
  const [error, setError] = useState<string | null>(null)
  const impliedRetainage =
    line.totalCompletedStored > 0
      ? (line.retainageHeld / line.totalCompletedStored) * 100
      : 0

  function fail(message: string): void {
    setError(message)
    onSaveFailed()
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const percent = fieldNumber(formData, "percentComplete")
    const percentChanged =
      percent !== null && Math.abs(percent - percentOf(line.totalCompletedStored, line.adjustedEstimate)) > 0.05
    setError(null)
    startTransition(async () => {
      const result = await updateProjectOwnerPayApplicationLine(
        projectId,
        applicationId,
        line.id,
        {
          currentWorkCompleted: fieldNumber(formData, "currentWorkCompleted"),
          storedMaterials: fieldNumber(formData, "storedMaterials"),
          retainagePercent: fieldNumber(formData, "retainagePercent"),
          ownerVisible,
        }
      )
      if (!result.success) {
        fail(result.error)
        onMessage(`${line.costCode} was not saved: ${result.error}`)
        return
      }
      if (!percentChanged) {
        onMessage(`${line.costCode} saved.`)
        router.refresh()
        return
      }
      const billed = await setProjectOwnerPayApplicationPercentComplete(projectId, applicationId, {
        scope: "line",
        key: line.id,
        percentComplete: percent,
      })
      if (!billed.success) fail(billed.error)
      onMessage(billed.success ? `${line.costCode} billed to ${percent}% complete.` : billed.error)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={save}
      className={`grid gap-2 border-b px-3 py-3 text-sm ${LINE_GRID} lg:items-center`}
    >
      <div className="min-w-0">
        <p className="font-medium">{line.costCode} · {line.description}</p>
        <p className="text-xs text-muted-foreground">
          {line.assemblyName ?? `${line.divisionCode} · ${line.divisionName}`}
        </p>
        {shopTickets && (
          <p className="text-xs text-muted-foreground">
            includes {formatCents(shopTickets.amountCents)} from {shopTickets.ticketNumbers.join(", ")}
          </p>
        )}
        {changeOrders.map((change) => (
          <p key={`${change.number}:${change.title}`} className="text-xs text-muted-foreground">
            {lineChangeOrderLabel(change, formatDollars)}
          </p>
        ))}
      </div>
      <span className="text-right">{formatDollars(line.adjustedEstimate)}</span>
      <span className="text-right">{formatDollars(line.previousWorkCompleted)}</span>
      <Input
        key={line.currentWorkCompleted}
        name="currentWorkCompleted"
        inputMode="decimal"
        defaultValue={line.currentWorkCompleted || ""}
        disabled={!editable}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${line.id}-error` : undefined}
        aria-label={`Current work for ${line.costCode}`}
      />
      <Input
        name="storedMaterials"
        inputMode="decimal"
        defaultValue={line.storedMaterials || ""}
        disabled={!editable}
        aria-label={`Stored materials for ${line.costCode}`}
      />
      <Input
        name="retainagePercent"
        inputMode="decimal"
        defaultValue={impliedRetainage || ""}
        disabled={!editable}
        aria-label={`Retainage percent for ${line.costCode}`}
      />
      <Input
        key={line.totalCompletedStored}
        name="percentComplete"
        inputMode="decimal"
        defaultValue={percentOf(line.totalCompletedStored, line.adjustedEstimate) || ""}
        disabled={!editable}
        aria-label={`Percent complete to date for ${line.costCode}`}
      />
      <span className="text-right">{formatDollars(line.totalCompletedStored)}</span>
      <span className="text-right">{formatDollars(line.balanceToFinish)}</span>
      <div className="flex items-center justify-end gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Checkbox
            checked={ownerVisible}
            onCheckedChange={(checked) => setOwnerVisible(checked === true)}
            disabled={!editable}
          />
          Owner
        </label>
        {editable && (
          <Button type="submit" size="icon" variant="outline" disabled={isPending}>
            <IconDeviceFloppy className="size-4" />
            <span className="sr-only">Save {line.costCode}</span>
          </Button>
        )}
      </div>
      {overBilled > 0 && (
        <p className="flex items-center gap-1 text-sm text-destructive lg:col-span-full">
          <IconAlertTriangle className="size-4" />
          Billed {formatDollars(overBilled)} more than its scheduled value of {formatDollars(line.adjustedEstimate)}.
        </p>
      )}
      {error && (
        <p id={`${line.id}-error`} role="alert" className="text-sm text-destructive lg:col-span-full">
          {error}
        </p>
      )}
    </form>
  )
}

const GROUP_BY_OPTIONS = ["division", "assembly", "cost_code"] as const

type GroupBy = (typeof GROUP_BY_OPTIONS)[number]

const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  division: "Division",
  assembly: "Assembly",
  cost_code: "Cost code",
}

type LineGroup = {
  /** Unique across groupings, for fold state. */
  readonly id: string
  readonly scope: GroupBy
  /** Division code, assembly key ("" = outside any assembly), or cost code. */
  readonly key: string
  readonly label: string
  readonly lines: readonly ProjectOwnerPayApplicationLine[]
}

function lineGroups(lines: readonly ProjectOwnerPayApplicationLine[], groupBy: GroupBy): readonly LineGroup[] {
  const groups = new Map<string, { label: string; sort: number; lines: ProjectOwnerPayApplicationLine[] }>()
  lines.forEach((line, index) => {
    const key =
      groupBy === "division" ? line.divisionCode : groupBy === "assembly" ? line.assemblyKey ?? "" : line.costCode
    const label =
      groupBy === "division"
        ? `${line.divisionCode} · ${line.divisionName}`
        : groupBy === "assembly"
          ? line.assemblyName ?? "Other work"
          : `${line.costCode} · ${line.description}`
    const sort = groupBy === "assembly" ? (line.assemblyKey ? line.assemblySort : 1_000_000) : index
    const group = groups.get(key) ?? { label, sort, lines: [] }
    group.lines.push(line)
    groups.set(key, group)
  })
  return [...groups.entries()]
    .sort(([, left], [, right]) => left.sort - right.sort)
    .map(([key, group]) => ({ id: `${groupBy}:${key}`, scope: groupBy, key, label: group.label, lines: group.lines }))
}

/** Group row: bill every line in a division, assembly or cost code to one percent complete. */
function PayApplicationGroupRow({
  projectId,
  applicationId,
  group,
  editable,
  open,
  linesId,
  onToggle,
  onMessage,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly group: LineGroup
  readonly editable: boolean
  readonly open: boolean
  /** Element id of the group's lines, for aria-controls. */
  readonly linesId: string
  readonly onToggle: () => void
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Shown on the group row too: the page-level message may be far above.
  const [error, setError] = useState<string | null>(null)
  const scheduled = group.lines.reduce((sum, line) => sum + line.adjustedEstimate, 0)
  const completed = group.lines.reduce((sum, line) => sum + line.totalCompletedStored, 0)
  const current = percentOf(completed, scheduled)
  const overBilledCount = overBilledLines(group.lines).length
  const noun = GROUP_BY_LABELS[group.scope].toLowerCase()

  function bill(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const percent = fieldNumber(new FormData(event.currentTarget), "groupPercent")
    if (percent === null) {
      setError(`Enter the ${noun}'s percent complete as a number.`)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await setProjectOwnerPayApplicationPercentComplete(projectId, applicationId, {
        scope: group.scope,
        key: group.key,
        percentComplete: percent,
      })
      if (!result.success) setError(result.error)
      onMessage(result.success ? `${group.label} billed to ${percent}% complete.` : result.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={linesId}
        className="flex min-w-0 items-start gap-2 text-left"
      >
        <IconChevronRight
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block font-semibold">{group.label}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {formatDollars(completed)} of {formatDollars(scheduled)} · {current}% complete to date · {group.lines.length}{" "}
            {group.lines.length === 1 ? "line" : "lines"}
          </span>
          {overBilledCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <IconAlertTriangle className="size-3.5" aria-hidden />
              {overBilledCount === 1 ? "1 line" : `${overBilledCount} lines`} billed past the scheduled value
            </span>
          )}
        </span>
      </button>
      {editable && (
        <form onSubmit={bill} className="flex items-center gap-2">
          <Input
            key={current}
            name="groupPercent"
            inputMode="decimal"
            defaultValue={current || ""}
            className="w-24 text-right"
            aria-label={`Percent complete to date for ${group.label}`}
            aria-invalid={error ? true : undefined}
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            Bill {noun}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function PayApplicationBillingGrid({
  projectId,
  applicationId,
  lines,
  editable,
  shopTicketProvenance,
  lineChangeOrders,
  onMessage,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly lines: readonly ProjectOwnerPayApplicationLine[]
  readonly editable: boolean
  readonly shopTicketProvenance: readonly ShopTicketProvenance[]
  readonly lineChangeOrders: Readonly<Record<string, readonly LineChangeOrder[]>>
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const baseId = useId()
  const provenanceByLine = new Map(shopTicketProvenance.map((entry) => [entry.lineId, entry]))
  const hasAssemblies = lines.some((line) => line.assemblyKey !== null)
  const [groupBy, setGroupBy] = useState<GroupBy>(hasAssemblies ? "assembly" : "division")
  const groups = lineGroups(lines, groupBy)
  const autoOpen = payRequestGroupsOpenByDefault(groups)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(autoOpen))
  // A save that over-bills a line (or a refresh that brings one in) opens its
  // group, without closing groups the person opened themselves. Adjusting
  // state during render is React's pattern for reacting to changed props.
  const autoOpenSignature = autoOpen.join("|")
  const [seenAutoOpen, setSeenAutoOpen] = useState(autoOpenSignature)
  if (autoOpenSignature !== seenAutoOpen) {
    setSeenAutoOpen(autoOpenSignature)
    setOpenIds((previous) => new Set([...previous, ...autoOpen]))
  }

  function openGroup(id: string): void {
    setOpenIds((previous) => (previous.has(id) ? previous : new Set([...previous, id])))
  }

  function toggleGroup(id: string): void {
    setOpenIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function chooseGroupBy(next: GroupBy): void {
    setGroupBy(next)
    // A new grouping starts folded again, apart from groups needing attention.
    const nextAutoOpen = payRequestGroupsOpenByDefault(lineGroups(lines, next))
    setOpenIds(new Set(nextAutoOpen))
    setSeenAutoOpen(nextAutoOpen.join("|"))
  }

  const allOpen = groups.length > 0 && groups.every((group) => openIds.has(group.id))
  const noneOpen = groups.every((group) => !openIds.has(group.id))

  return (
    <section className="clarity-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="text-muted-foreground">Bill by</span>
        {GROUP_BY_OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={groupBy === option ? "default" : "outline"}
            disabled={option === "assembly" && !hasAssemblies}
            onClick={() => chooseGroupBy(option)}
          >
            {GROUP_BY_LABELS[option]}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={allOpen} onClick={() => setOpenIds(new Set(groups.map((group) => group.id)))}>
            Expand all
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={noneOpen} onClick={() => setOpenIds(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>
      {/*
        One box scrolls both ways so the sticky header has a vertical scroll
        container to stick to: with overflow-x alone the box still clips
        vertically and the header would scroll off with the page.
      */}
      <div className="max-h-[calc(100dvh-8rem)] overflow-auto">
        <div className="min-w-[1180px]">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(14rem,1.6fr)_repeat(8,minmax(6.5rem,.7fr))_auto] gap-2 border-b bg-muted px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
            <span>Cost code</span>
            <span className="text-right">Adjusted</span>
            <span className="text-right">Previous</span>
            <span>Current work</span>
            <span>Stored</span>
            <span>Retainage %</span>
            <span>% to date</span>
            <span className="text-right">Total</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Visibility</span>
          </div>
          {groups.map((group, index) => {
            const open = openIds.has(group.id)
            const linesId = `${baseId}-group-${index}`
            return (
              <div key={group.id}>
                <PayApplicationGroupRow
                  projectId={projectId}
                  applicationId={applicationId}
                  group={group}
                  editable={editable}
                  open={open}
                  linesId={linesId}
                  onToggle={() => toggleGroup(group.id)}
                  onMessage={onMessage}
                />
                {/* Folded rows stay mounted, so typed values and row errors survive a fold. */}
                <div id={linesId} hidden={!open}>
                  {group.lines.map((line) => (
                    <PayApplicationLineEditor
                      key={line.id}
                      projectId={projectId}
                      applicationId={applicationId}
                      line={line}
                      editable={editable}
                      onMessage={onMessage}
                      onSaveFailed={() => openGroup(group.id)}
                      shopTickets={provenanceByLine.get(line.id)}
                      changeOrders={lineChangeOrders[lineChangeOrderKey(line.costCode, line.assemblyKey)] ?? []}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
