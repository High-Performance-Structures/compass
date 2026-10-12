"use client"

import * as React from "react"
import { IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import { getSageLaborHours, requestSageLaborHours, type SageLaborView } from "@/app/actions/shop-ticket-sage-labor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

/** Hours from Sage added to the ticket: one labor line per cost code. */
/** Hours a ticket bills from one timecard line, with that line's cost code. */
export type SageHoursClaim = { readonly hours: number; readonly costCode: string | null }

export type SageHoursSelection = {
  readonly costCode: string
  readonly sageCostCodeName: string | null
  readonly hours: number
  readonly claims: readonly { readonly laborLineId: string; readonly hours: number }[]
}

const POLL_MS = 5000
/** The bridge checks every minute; stop waiting after a few tries. */
const GIVE_UP_MS = 4 * 60 * 1000

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function formatHours(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Hours from Sage timecards on this project's job in the labor dates, by cost
 * code. Hours already on another ticket, or already added to this one, are
 * not offered again.
 */
export function ShopTicketSageHours({
  projectId,
  ticketId,
  laborFrom,
  laborTo,
  claims,
  onLoadedClaims,
  onAdd,
}: {
  readonly projectId: string
  readonly ticketId: string | null
  readonly laborFrom: string
  readonly laborTo: string
  /** Hours per timecard line this ticket bills, as currently edited. */
  readonly claims: ReadonlyMap<string, number> | null
  /** The ticket's saved claims, the first time they load. */
  readonly onLoadedClaims: (claims: ReadonlyMap<string, SageHoursClaim>) => void
  readonly onAdd: (selections: readonly SageHoursSelection[]) => void
}): React.ReactElement {
  const [view, setView] = React.useState<SageLaborView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [waitingSince, setWaitingSince] = React.useState<number | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = React.useTransition()
  const datesSet = laborFrom !== "" && laborTo !== ""

  const load = React.useCallback(async (): Promise<SageLaborView | null> => {
    const result = await getSageLaborHours(projectId, ticketId, laborFrom, laborTo)
    if (!result.success) {
      setError(result.error)
      return null
    }
    setError(null)
    setView(result.view)
    return result.view
  }, [laborFrom, laborTo, projectId, ticketId])

  // Show hours fetched earlier for these dates, and pick up the ticket's saved claims.
  React.useEffect(() => {
    if (!datesSet) return
    let cancelled = false
    void load().then((loaded) => {
      if (cancelled || !loaded || claims !== null) return
      const codeByLine = new Map(loaded.groups.flatMap((group) => group.lines.map((line) => [line.id, group.costCode] as const)))
      onLoadedClaims(
        new Map(Object.entries(loaded.ticketClaims).map(([lineId, hours]) => [lineId, { hours, costCode: codeByLine.get(lineId) ?? null }])),
      )
    })
    return () => {
      cancelled = true
    }
    // Claims are only seeded once; reloading on every claim change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesSet, load])

  // While Sage hasn't answered, check again every few seconds.
  const waiting = view?.request?.status === "queued" || view?.request?.status === "running"
  React.useEffect(() => {
    if (!waiting || waitingSince === null) return
    if (Date.now() - waitingSince > GIVE_UP_MS) {
      setWaitingSince(null)
      return
    }
    const timer = window.setTimeout(() => void load(), POLL_MS)
    return () => window.clearTimeout(timer)
  }, [load, view, waiting, waitingSince])

  function fetchFromSage(): void {
    startTransition(async () => {
      const result = await requestSageLaborHours(projectId, laborFrom, laborTo)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setWaitingSince(Date.now())
      await load()
    })
  }

  // Hours still available once this ticket's own (edited) claims are counted.
  const groups = (view?.groups ?? []).map((group) => {
    const lines = group.lines.map((line) => ({ ...line, open: round(Math.max(0, line.availableHours - (claims?.get(line.id) ?? 0))) }))
    const onTicket = round(group.lines.reduce((sum, line) => sum + (claims?.get(line.id) ?? 0), 0))
    return { ...group, key: group.costCode ?? `sage:${group.sageCostCodeName ?? ""}`, lines, onTicket, open: round(lines.reduce((sum, line) => sum + line.open, 0)) }
  })

  function addSelected(): void {
    const selections = groups.flatMap((group): SageHoursSelection[] => {
      if (!selected.has(group.key) || group.costCode === null || group.open <= 0) return []
      return [
        {
          costCode: group.costCode,
          sageCostCodeName: group.sageCostCodeName,
          hours: group.open,
          claims: group.lines.filter((line) => line.open > 0).map((line) => ({ laborLineId: line.id, hours: line.open })),
        },
      ]
    })
    if (selections.length === 0) return
    onAdd(selections)
    setSelected(new Set())
  }

  if (!datesSet) {
    return <p className="text-sm text-muted-foreground">Set the labor dates to get hours from Sage timecards.</p>
  }

  const request = view?.request ?? null
  return (
    <section aria-labelledby="sage-hours-heading" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sage-hours-heading" className="text-sm font-semibold">
          Hours from Sage
        </h3>
        <Button type="button" size="sm" variant="outline" disabled={pending || (waiting && waitingSince !== null)} onClick={fetchFromSage}>
          <IconRefresh className="size-4" />
          {request ? "Refresh from Sage" : "Get hours from Sage"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {error
          ? error
          : waiting
            ? waitingSince === null
              ? "Still waiting for Sage. Try again in a minute."
              : "Asking Sage… it checks for requests every minute."
            : request?.status === "failed"
              ? `Sage couldn't answer: ${request.error ?? "unknown error"}`
              : request?.status === "done"
                ? `Timecards from Sage job ${request.sageJobNumber ?? ""}, ${new Date(request.completedAt ?? request.requestedAt).toLocaleString()}. Hours on other tickets aren't offered again.`
                : "Get this job's timecard hours for the labor dates."}
      </p>
      {request?.status === "done" && groups.length === 0 ? (
        <p className="text-sm">No timecard hours on this job in these dates.</p>
      ) : null}
      {groups.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="w-10 py-2" />
                <th className="py-2 pr-2 font-medium">Cost code</th>
                <th className="w-24 py-2 pr-2 text-right font-medium">Available</th>
                <th className="w-24 py-2 pr-2 text-right font-medium">On this ticket</th>
                <th className="w-28 py-2 pr-2 text-right font-medium">Other tickets</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key} className="border-b align-top">
                  <td className="py-2">
                    <Checkbox
                      aria-label={`Add ${group.costCode ?? group.sageCostCodeName ?? "these"} hours`}
                      disabled={group.costCode === null || group.open <= 0}
                      checked={selected.has(group.key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(group.key)
                          else next.delete(group.key)
                          return next
                        })
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <span className="font-medium">{group.costCode ?? "No matching cost code"}</span>{" "}
                    <span className="text-muted-foreground">{group.sageCostCodeName}</span>
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">{group.lines.length} timecard {group.lines.length === 1 ? "line" : "lines"}</summary>
                      <ul className="mt-1 grid gap-0.5">
                        {group.lines.map((line) => (
                          <li key={line.id} className="tabular-nums">
                            {line.workDate} · {line.employeeName ?? "Employee"} · {formatHours(line.hours)} h
                            {line.open < line.hours ? ` (${formatHours(line.open)} open)` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatHours(group.open)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatHours(group.onTicket)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatHours(group.billedHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {groups.some((group) => group.open > 0 && group.costCode !== null) ? (
        <div>
          <Button type="button" size="sm" disabled={selected.size === 0} onClick={addSelected}>
            Add to ticket as labor
          </Button>
        </div>
      ) : null}
    </section>
  )
}
