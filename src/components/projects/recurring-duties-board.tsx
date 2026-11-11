"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  deleteRecurringDuty,
  markRecurringDutyDone,
  saveRecurringDuty,
  undoRecurringDutyDone,
  type RecurringDutyInput,
} from "@/app/actions/recurring-duties"
import type { ColumnDef } from "@tanstack/react-table"
import { RecordDrawer } from "@/components/record-drawer"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { DutyOption } from "@/lib/internal-duties/model"
import { nextPeriod, periodLabel, type DutyCadence } from "@/lib/internal-duties/recurring"
import { statusText, TONE_CLASS } from "@/lib/internal-duties/recurring-display"
import type { RecurringDutyView } from "@/lib/internal-duties/recurring-data"
import { cn } from "@/lib/utils"

const CADENCE_LABEL: { readonly [K in DutyCadence]: string } = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }

const CADENCE_ORDER: { readonly [K in DutyCadence]: number } = { monthly: 1, quarterly: 2, yearly: 3 }

const STATUS_ORDER: { readonly [K in RecurringDutyView["status"]["kind"] | "off"]: number } = {
  behind: 1,
  due_soon: 2,
  current: 3,
  not_started: 4,
  off: 5,
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function shortDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Periods offered when marking done: what's owed, then the next one. */
function periodChoices(duty: RecurringDutyView): readonly string[] {
  if (duty.status.kind === "behind") {
    const after = nextPeriod(duty.status.owed[duty.status.owed.length - 1] ?? "", duty.cadence)
    return after ? [...duty.status.owed, after] : duty.status.owed
  }
  if (duty.status.kind === "current" || duty.status.kind === "due_soon") return [duty.status.nextPeriod]
  return []
}

function dutyName(duty: RecurringDutyView): string {
  return duty.accountName ? `${duty.title} · ${duty.accountName}` : duty.title
}

type DoneForm = { readonly dutyId: string; readonly period: string; readonly completedOn: string; readonly hours: string; readonly notes: string }
type EditForm = { readonly dutyId: string | null } & Omit<RecurringDutyInput, "dueDay"> & { readonly dueDay: string }

/** The recurring duties sheet's columns ("recurring-duties.workspace"). */
export function recurringDutyColumns({
  canEdit,
  canManage,
  pending,
  onDone,
  onEdit,
  onUndo,
}: {
  readonly canEdit: boolean
  readonly canManage: boolean
  readonly pending: boolean
  readonly onDone: (duty: RecurringDutyView) => void
  readonly onEdit: (duty: RecurringDutyView) => void
  readonly onUndo: (duty: RecurringDutyView) => void
}): ColumnDef<RecurringDutyView>[] {
  return [
    {
      id: "duty",
      accessorFn: dutyName,
      header: "Duty",
      cell: ({ row: { original: duty } }) =>
        canManage ? (
          <button type="button" className="text-left font-medium hover:underline" onClick={() => onEdit(duty)}>
            {dutyName(duty)}
          </button>
        ) : (
          <span className="font-medium">{dutyName(duty)}</span>
        ),
    },
    {
      id: "cadence",
      accessorFn: (duty) => `${CADENCE_ORDER[duty.cadence]}-${String(duty.dueDay).padStart(2, "0")}`,
      header: "How often",
      cell: ({ row: { original: duty } }) => (
        <span className={cn(!duty.active && "text-muted-foreground")}>
          {CADENCE_LABEL[duty.cadence]}, by the {duty.dueDay}
        </span>
      ),
    },
    {
      id: "lastDone",
      accessorFn: (duty) => duty.lastDone?.completedOn ?? undefined,
      header: "Last done",
      cell: ({ row: { original: duty } }) =>
        duty.lastDone ? (
          <span className={cn(!duty.active && "text-muted-foreground")}>
            {periodLabel(duty.lastDone.period)} <span className="text-muted-foreground">({shortDate(duty.lastDone.completedOn)})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Not yet</span>
        ),
    },
    {
      id: "owner",
      accessorFn: (duty) => duty.ownerName ?? undefined,
      header: "Owner",
      cell: ({ row: { original: duty } }) =>
        duty.ownerName ? (
          <span className={cn(!duty.active && "text-muted-foreground")}>{duty.ownerName}</span>
        ) : (
          <span className="text-muted-foreground">No owner</span>
        ),
    },
    {
      id: "status",
      // Most urgent first: behind, due soon, current, not started, turned off.
      accessorFn: (duty) => (duty.active ? STATUS_ORDER[duty.status.kind] : STATUS_ORDER.off),
      header: "Status",
      cell: ({ row: { original: duty } }) => {
        const status = statusText(duty)
        return (
          <span className={cn("font-medium", duty.active ? TONE_CLASS[status.tone] : "text-muted-foreground")}>
            {duty.active ? status.text : "Turned off"}
          </span>
        )
      },
    },
    {
      id: "actions",
      cell: ({ row: { original: duty } }) => (
        <div className="flex justify-end gap-1">
          {canEdit && duty.active ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onDone(duty)}>
              Mark done
            </Button>
          ) : null}
          {canEdit && duty.lastDone ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => onUndo(duty)}
            >
              Undo last
            </Button>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onEdit(duty)}>
              Edit
            </Button>
          ) : null}
        </div>
      ),
    },
  ]
}

/** The Mark done form for one duty, shown above the sheet. */
function DoneDutyForm({
  duty,
  done,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  readonly duty: RecurringDutyView
  readonly done: DoneForm
  readonly pending: boolean
  readonly onChange: (done: DoneForm) => void
  readonly onCancel: () => void
  readonly onSubmit: () => void
}): React.ReactElement {
  const choices = periodChoices(duty)
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label={`Mark ${dutyName(duty)} done`}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="rd-period">Period</Label>
        {choices.length > 0 ? (
          <Select value={done.period} onValueChange={(value) => onChange({ ...done, period: value })}>
            <SelectTrigger id="rd-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((period) => (
                <SelectItem key={period} value={period}>
                  {periodLabel(period)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="rd-period"
            type="month"
            value={done.period}
            onChange={(event) => onChange({ ...done, period: event.target.value })}
            aria-describedby="rd-period-help"
          />
        )}
        {choices.length === 0 ? (
          <p id="rd-period-help" className="text-sm text-muted-foreground">
            The most recent period finished; tracking starts from there.
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rd-on">Done on</Label>
        <Input id="rd-on" type="date" value={done.completedOn} onChange={(event) => onChange({ ...done, completedOn: event.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rd-hours">Hours (optional)</Label>
        <Input
          id="rd-hours"
          inputMode="decimal"
          value={done.hours}
          onChange={(event) => onChange({ ...done, hours: event.target.value.replace(/[^0-9.]/g, "") })}
        />
      </div>
      <div className="grid gap-1.5 lg:col-span-2">
        <Label htmlFor="rd-notes">Notes</Label>
        <Textarea id="rd-notes" rows={2} value={done.notes} onChange={(event) => onChange({ ...done, notes: event.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2 lg:col-span-5">
        <Button type="submit" size="sm" disabled={pending || !done.period}>
          Mark done
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        {duty.dutyCode ? (
          <p className="text-sm text-muted-foreground">Hours go on the duty log as {duty.dutyCode}.</p>
        ) : null}
      </div>
    </form>
  )
}

export function RecurringDutiesBoard({
  projectId,
  duties,
  dutyOptions,
  staff,
  canEdit,
  canManage,
  currentUserId,
}: {
  readonly projectId: string
  readonly duties: readonly RecurringDutyView[]
  readonly dutyOptions: readonly DutyOption[]
  readonly staff: readonly { readonly value: string; readonly label: string }[]
  readonly canEdit: boolean
  readonly canManage: boolean
  readonly currentUserId: string
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [done, setDone] = React.useState<DoneForm | null>(null)
  const [edit, setEdit] = React.useState<EditForm | null>(null)
  const [showInactive, setShowInactive] = React.useState(false)
  const visible = React.useMemo(() => duties.filter((duty) => duty.active || showInactive), [duties, showInactive])

  function startDone(duty: RecurringDutyView): void {
    const choices = periodChoices(duty)
    setEdit(null)
    setDone({ dutyId: duty.id, period: choices[0] ?? "", completedOn: today(), hours: "", notes: "" })
  }

  function startEdit(duty: RecurringDutyView | null): void {
    setDone(null)
    setEdit(
      duty
        ? {
            dutyId: duty.id,
            title: duty.title,
            accountName: duty.accountName ?? "",
            cadence: duty.cadence,
            dueDay: String(duty.dueDay),
            dutyCode: duty.dutyCode ?? "",
            ownerUserId: duty.ownerUserId ?? "",
            active: duty.active,
          }
        : { dutyId: null, title: "", accountName: "", cadence: "monthly", dueDay: "15", dutyCode: "", ownerUserId: currentUserId, active: true },
    )
  }

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>, message: string, after?: () => void): void {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error("error" in result && result.error ? result.error : "Couldn't save that.")
        return
      }
      toast.success(message)
      after?.()
      router.refresh()
    })
  }

  const doneDuty = done ? duties.find((duty) => duty.id === done.dutyId) ?? null : null

  const columns = React.useMemo(
    () =>
      recurringDutyColumns({
        canEdit,
        canManage,
        pending,
        onDone: startDone,
        onEdit: startEdit,
        onUndo: (duty) => {
          const last = duty.lastDone
          if (last) run(() => undoRecurringDutyDone(projectId, last.id), `${periodLabel(last.period)} unmarked`)
        },
      }),
    // startDone, startEdit and run read only state setters and the props listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canManage, currentUserId, pending, projectId],
  )

  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: (duty) => duty.id,
    resetKey: String(showInactive),
    sheetId: "recurring-duties.workspace",
  })

  return (
    <section aria-labelledby="recurring-duties" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recurring-duties" className="text-sm font-semibold">
          Recurring duties
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {duties.some((duty) => !duty.active) ? (
            <div className="flex items-center gap-2 text-sm">
              <Switch id="recurring-show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
              <Label htmlFor="recurring-show-inactive">Show turned off</Label>
            </div>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(null)}>
              Add recurring duty
            </Button>
          ) : null}
        </div>
      </div>

      {/* Adding or editing a duty happens in the record drawer, over the list. */}
      <RecordDrawer
        open={edit !== null}
        onOpenChange={(open) => {
          if (!open) setEdit(null)
        }}
        title={edit?.dutyId ? "Edit recurring duty" : "New recurring duty"}
      >
        {edit ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                const { dutyId, dueDay, ...rest } = edit
                run(() => saveRecurringDuty(projectId, dutyId, { ...rest, dueDay: Number(dueDay) }), dutyId ? "Recurring duty saved" : "Recurring duty added", () => setEdit(null))
              }}
              aria-label={edit.dutyId ? "Edit recurring duty" : "New recurring duty"}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="rd-title">Name</Label>
                <Input id="rd-title" value={edit.title} placeholder="Bank reconciliation" onChange={(event) => setEdit({ ...edit, title: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rd-account">Account (optional)</Label>
                <Input id="rd-account" value={edit.accountName} placeholder="FSB" onChange={(event) => setEdit({ ...edit, accountName: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rd-cadence">How often</Label>
                <Select value={edit.cadence} onValueChange={(value) => setEdit({ ...edit, cadence: value === "quarterly" ? "quarterly" : value === "yearly" ? "yearly" : "monthly" })}>
                  <SelectTrigger id="rd-cadence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rd-due">Due day of the following month</Label>
                <Input id="rd-due" inputMode="numeric" value={edit.dueDay} onChange={(event) => setEdit({ ...edit, dueDay: event.target.value.replace(/\D/g, "") })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rd-code">Time logged as</Label>
                <SearchableCombobox
                  id="rd-code"
                  ariaLabel="Time logged as"
                  placeholder="No duty"
                  options={dutyOptions.map((duty) => ({ value: duty.code, label: `${duty.code} ${duty.label}` }))}
                  value={edit.dutyCode}
                  onValueChange={(value) => setEdit({ ...edit, dutyCode: value })}
                  className="w-full"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rd-owner">Owner</Label>
                <SearchableCombobox
                  id="rd-owner"
                  ariaLabel="Owner"
                  placeholder="No owner"
                  options={staff}
                  value={edit.ownerUserId}
                  onValueChange={(value) => setEdit({ ...edit, ownerUserId: value })}
                  className="w-full"
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch id="rd-active" checked={edit.active} onCheckedChange={(value) => setEdit({ ...edit, active: value })} />
                <Label htmlFor="rd-active">Active</Label>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEdit(null)}>
                  Cancel
                </Button>
                {edit.dutyId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={pending}
                    onClick={() => {
                      const id = edit.dutyId
                      if (id) run(() => deleteRecurringDuty(projectId, id), "Recurring duty removed (turned off if it had history)", () => setEdit(null))
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </form>
        ) : null}
      </RecordDrawer>

      <RecordDrawer
        open={doneDuty !== null}
        onOpenChange={(open) => {
          if (!open) setDone(null)
        }}
        title={doneDuty ? `Mark done: ${dutyName(doneDuty)}` : "Mark done"}
      >
        {doneDuty && done ? (
            <DoneDutyForm
              duty={doneDuty}
              done={done}
              pending={pending}
              onChange={setDone}
              onCancel={() => setDone(null)}
              onSubmit={() => {
                const { dutyId, ...rest } = done
                run(() => markRecurringDutyDone(projectId, dutyId, rest), `${periodLabel(done.period)} marked done`, () => setDone(null))
              }}
            />
        ) : null}
      </RecordDrawer>

      <RecordTable
        table={table}
        itemLabel="recurring duties"
        emptyMessage="No recurring duties yet."
        rowIdPrefix="recurring-duty"
        onRowOpen={canManage ? startEdit : undefined}
      />
    </section>
  )
}
