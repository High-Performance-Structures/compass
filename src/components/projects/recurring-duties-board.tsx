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
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { DutyOption } from "@/lib/internal-duties/model"
import { nextPeriod, periodLabel, type DutyCadence } from "@/lib/internal-duties/recurring"
import { statusText, TONE_CLASS } from "@/lib/internal-duties/recurring-display"
import type { RecurringDutyView } from "@/lib/internal-duties/recurring-data"
import { cn } from "@/lib/utils"

const CADENCE_LABEL: { readonly [K in DutyCadence]: string } = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }

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
  const visible = duties.filter((duty) => duty.active || showInactive)

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
          {canManage && !edit ? (
            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(null)}>
              Add recurring duty
            </Button>
          ) : null}
        </div>
      </div>

      {edit ? (
        <form
          className="grid gap-3 border-y py-3 sm:grid-cols-2 lg:grid-cols-4"
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

      {visible.length === 0 ? (
        <p className="border-t py-4 text-sm text-muted-foreground">No recurring duties yet.</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Duty</th>
                <th className="py-2 pr-3 font-medium">How often</th>
                <th className="py-2 pr-3 font-medium">Last done</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((duty) => {
                const status = statusText(duty)
                const choices = periodChoices(duty)
                return (
                  <React.Fragment key={duty.id}>
                    <tr className={cn("border-b align-top", !duty.active && "text-muted-foreground")}>
                      <td className="py-2 pr-3 font-medium">{dutyName(duty)}</td>
                      <td className="py-2 pr-3">
                        {CADENCE_LABEL[duty.cadence]}, by the {duty.dueDay}
                      </td>
                      <td className="py-2 pr-3">
                        {duty.lastDone ? (
                          <>
                            {periodLabel(duty.lastDone.period)} <span className="text-muted-foreground">({shortDate(duty.lastDone.completedOn)})</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Not yet</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{duty.ownerName ?? <span className="text-muted-foreground">No owner</span>}</td>
                      <td className={cn("py-2 pr-3 font-medium", TONE_CLASS[status.tone])}>{duty.active ? status.text : "Turned off"}</td>
                      <td className="py-2">
                        <div className="flex justify-end gap-1">
                          {canEdit && duty.active ? (
                            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startDone(duty)}>
                              Mark done
                            </Button>
                          ) : null}
                          {canEdit && duty.lastDone ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                const last = duty.lastDone
                                if (last) run(() => undoRecurringDutyDone(projectId, last.id), `${periodLabel(last.period)} unmarked`)
                              }}
                            >
                              Undo last
                            </Button>
                          ) : null}
                          {canManage ? (
                            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startEdit(duty)}>
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {done?.dutyId === duty.id ? (
                      <tr className="border-b">
                        <td colSpan={6} className="py-3">
                          <form
                            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                            aria-label={`Mark ${dutyName(duty)} done`}
                            onSubmit={(event) => {
                              event.preventDefault()
                              const { dutyId, ...rest } = done
                              run(() => markRecurringDutyDone(projectId, dutyId, rest), `${periodLabel(done.period)} marked done`, () => setDone(null))
                            }}
                          >
                            <div className="grid gap-1.5">
                              <Label htmlFor="rd-period">Period</Label>
                              {choices.length > 0 ? (
                                <Select value={done.period} onValueChange={(value) => setDone({ ...done, period: value })}>
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
                                  onChange={(event) => setDone({ ...done, period: event.target.value })}
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
                              <Input id="rd-on" type="date" value={done.completedOn} onChange={(event) => setDone({ ...done, completedOn: event.target.value })} />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor="rd-hours">Hours (optional)</Label>
                              <Input
                                id="rd-hours"
                                inputMode="decimal"
                                value={done.hours}
                                onChange={(event) => setDone({ ...done, hours: event.target.value.replace(/[^0-9.]/g, "") })}
                              />
                            </div>
                            <div className="grid gap-1.5 lg:col-span-2">
                              <Label htmlFor="rd-notes">Notes</Label>
                              <Input id="rd-notes" value={done.notes} onChange={(event) => setDone({ ...done, notes: event.target.value })} />
                            </div>
                            <div className="flex flex-wrap gap-2 lg:col-span-5">
                              <Button type="submit" size="sm" disabled={pending || !done.period}>
                                Mark done
                              </Button>
                              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDone(null)}>
                                Cancel
                              </Button>
                              {duty.dutyCode ? (
                                <p className="text-sm text-muted-foreground">Hours go on the duty log as {duty.dutyCode}.</p>
                              ) : null}
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
