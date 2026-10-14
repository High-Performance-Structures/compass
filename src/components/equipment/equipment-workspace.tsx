"use client"

import * as React from "react"
import { IconPencil, IconPlus, IconSettings, IconTrash } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  deleteMachineLogEntry,
  reviewMachineLogEntries,
  type EquipmentWorkspace,
  type MachineLogEntryView,
  type MachineView,
} from "@/app/actions/equipment"
import { MachineLogEntryDialog } from "@/components/equipment/machine-log-entry-dialog"
import { MachineSetupDialog } from "@/components/equipment/machine-setup-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCents, formatNumber, MACHINE_LOG_KIND_LABELS, serviceDueLabel, type MachineLogKind } from "@/lib/equipment/model"
import { cn } from "@/lib/utils"

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** One line on what an entry is: "6 running, 1 standby · H-215-660" or "18.4 gal · $72.50". */
function entrySummary(entry: MachineLogEntryView): string {
  const parts: string[] = []
  if (entry.kind === "hours") {
    const hours = [
      entry.runningHours ? `${formatNumber(entry.runningHours)} running` : null,
      entry.standbyHours ? `${formatNumber(entry.standbyHours)} standby` : null,
      entry.idleHours ? `${formatNumber(entry.idleHours)} idle` : null,
    ].filter(Boolean)
    parts.push(`${hours.join(", ")} h`)
  } else {
    if (entry.serviceName) parts.push(entry.serviceName)
    if (entry.gallons) parts.push(`${formatNumber(entry.gallons)} gal`)
    if (entry.amountCents !== null) parts.push(formatCents(entry.amountCents))
    if (entry.shopHours) parts.push(`${formatNumber(entry.shopHours)} shop h`)
  }
  if (entry.projectLabel) parts.push(entry.projectLabel)
  return parts.join(" · ")
}

/** Where an approved entry goes in Sage (written in a later step). */
function sageDestination(kind: MachineLogKind): string {
  switch (kind) {
    case "hours":
      return "Sage: daily field report, equipment line"
    case "maintenance":
    case "repair":
      return "Sage: payable invoice equipment line; shop hours on payroll as repaired equipment"
    case "fuel":
    case "other":
      return "Sage: payable invoice, equipment cost line"
  }
}

function soonestService(machine: MachineView): MachineView["services"][number] | undefined {
  const rank = { due: 0, soon: 1, ok: 2 } as const
  return machine.services.toSorted(
    (a, b) => rank[a.due.state] - rank[b.due.state] || (a.due.hoursLeft ?? Infinity) - (b.due.hoursLeft ?? Infinity),
  )[0]
}

/** Office view of the machine log: machines, approvals, hours by job, recent entries. */
export function EquipmentWorkspaceView({ workspace }: { readonly workspace: EquipmentWorkspace }): React.ReactElement {
  const router = useRouter()
  const [entryDialog, setEntryDialog] = React.useState<{ readonly key: number; readonly kind: MachineLogKind; readonly entry: MachineLogEntryView | null } | null>(null)
  const openEntryDialog = (kind: MachineLogKind, entry: MachineLogEntryView | null): void => setEntryDialog({ key: Date.now(), kind, entry })
  const [machineDialog, setMachineDialog] = React.useState<{ readonly machine: MachineView | null } | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [removing, setRemoving] = React.useState<MachineLogEntryView | null>(null)
  const [pending, startTransition] = React.useTransition()
  const editingMachine = machineDialog?.machine ? (workspace.machines.find((item) => item.id === machineDialog.machine?.id) ?? null) : null

  function review(ids: readonly string[], decision: "approved" | "rejected"): void {
    startTransition(async () => {
      const result = await reviewMachineLogEntries(ids, decision)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.data.count} ${result.data.count === 1 ? "entry" : "entries"} ${decision}.`)
      setSelected(new Set())
      router.refresh()
    })
  }

  function remove(entry: MachineLogEntryView): void {
    startTransition(async () => {
      const result = await deleteMachineLogEntry(entry.id)
      setRemoving(null)
      if (!result.success) toast.error(result.error)
      else router.refresh()
    })
  }

  const totals = [
    { label: "Running hours", value: formatNumber(workspace.totals.runningHours) },
    { label: "Fuel", value: formatCents(workspace.totals.fuelCents) },
    { label: "Service & repairs", value: formatCents(workspace.totals.serviceCents) },
    { label: "Services due", value: String(workspace.totals.servicesDue), urgent: workspace.totals.servicesDue > 0 },
  ]

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Machine hours are priced from the rate book. Entries wait here for approval; approved entries are what go to Sage.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => openEntryDialog("hours", null)}>
            <IconPlus className="size-4" />
            Log machine entry
          </Button>
          {workspace.canManage ? (
            <Button type="button" size="sm" onClick={() => setMachineDialog({ machine: null })}>
              <IconPlus className="size-4" />
              Add machine
            </Button>
          ) : null}
        </div>
      </div>

      <section aria-label={`Totals for ${workspace.month}`} className="grid grid-cols-2 border-y sm:grid-cols-4">
        {totals.map((total) => (
          <div key={total.label} className="border-r px-4 py-3 last:border-r-0">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{total.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", total.urgent && "text-destructive")}>{total.value}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="machines-heading" className="grid gap-2">
        <h2 id="machines-heading" className="text-base font-semibold">Machines</h2>
        {workspace.machines.length === 0 ? (
          <p className="border-y py-6 text-center text-sm text-muted-foreground">
            No machines yet.{workspace.canManage ? " Add each machine and link it to its rate book entry." : " Ask the office to add them."}
          </p>
        ) : (
          <div className="overflow-x-auto border-y">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Machine</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Sage #</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Rate book</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Hour meter</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Last job</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Next service</th>
                  {workspace.canManage ? <th className="w-10 py-2"><span className="sr-only">Set up</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {workspace.machines.map((machine) => {
                  const next = soonestService(machine)
                  return (
                    <tr key={machine.id} className={cn("border-b last:border-b-0", !machine.active && "text-muted-foreground")}>
                      <td className="py-2.5 pr-3 font-medium">
                        {machine.name}
                        {!machine.active ? <Badge variant="outline" className="ml-2">Retired</Badge> : null}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{machine.sageEquipmentNumber ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        {machine.rateBookName ? `${machine.rateBookName} · ${formatCents(machine.runningRateCents ?? 0)}/hr` : <span className="text-muted-foreground">Not linked</span>}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {machine.hourMeter !== null ? `${formatNumber(machine.hourMeter)} h` : "—"}
                        {machine.hourMeterOn ? <span className="text-xs text-muted-foreground"> · {shortDate(machine.hourMeterOn)}</span> : null}
                      </td>
                      <td className="py-2.5 pr-3">{machine.locationLabel ?? "—"}</td>
                      <td className={cn("py-2.5 pr-3", next?.due.state === "due" && "font-medium text-destructive", next?.due.state === "soon" && "font-medium")}>
                        {next ? serviceDueLabel(next.name, next.due) : <span className="text-muted-foreground">No schedule</span>}
                      </td>
                      {workspace.canManage ? (
                        <td className="py-2.5">
                          <Button type="button" variant="ghost" size="icon" aria-label={`Set up ${machine.name}`} onClick={() => setMachineDialog({ machine })}>
                            <IconSettings className="size-4" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="approvals-heading" className="grid content-start gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="approvals-heading" className="text-base font-semibold">
              Waiting for approval <span className="text-muted-foreground">({workspace.pending.length})</span>
            </h2>
            {workspace.canManage && workspace.pending.length > 0 ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={pending || selected.size === 0} onClick={() => review([...selected], "rejected")}>
                  Reject selected
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => review(selected.size > 0 ? [...selected] : workspace.pending.map((entry) => entry.id), "approved")}
                >
                  {selected.size > 0 ? `Approve ${selected.size}` : "Approve all"}
                </Button>
              </div>
            ) : null}
          </div>
          {workspace.pending.length === 0 ? (
            <p className="border-y py-4 text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <ul className="border-y">
              {workspace.pending.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 border-b py-3 last:border-b-0">
                  {workspace.canManage ? (
                    <Checkbox
                      className="mt-1"
                      aria-label={`Select ${entry.machineName} ${shortDate(entry.entryDate)}`}
                      checked={selected.has(entry.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(entry.id)
                          else next.delete(entry.id)
                          return next
                        })
                      }
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{entry.machineName}</span> · {MACHINE_LOG_KIND_LABELS[entry.kind]} · {entrySummary(entry)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(entry.entryDate)} · {entry.loggedBy}
                      {entry.chargeCents !== null ? ` · ${formatCents(entry.chargeCents)} at rate book rates` : ""}
                      {entry.notes ? ` · ${entry.notes}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{sageDestination(entry.kind)}</p>
                  </div>
                  {entry.canChange ? (
                    <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon" aria-label="Change entry" onClick={() => openEntryDialog(entry.kind, entry)}>
                        <IconPencil className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove entry" disabled={pending} onClick={() => setRemoving(entry)}>
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="by-job-heading" className="grid content-start gap-2">
          <h2 id="by-job-heading" className="text-base font-semibold">Machine hours by job this month</h2>
          {workspace.hoursByJob.length === 0 ? (
            <p className="border-y py-4 text-sm text-muted-foreground">No machine hours logged this month.</p>
          ) : (
            <ul className="border-y text-sm">
              {workspace.hoursByJob.map((row) => (
                <li key={row.label} className="flex justify-between gap-3 border-b py-2 last:border-b-0">
                  <span className="min-w-0 truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatNumber(row.runningHours)} h{row.otherHours ? ` + ${formatNumber(row.otherHours)} standby/idle` : ""} · {formatCents(row.chargeCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Priced at the rate book rates shop tickets use.</p>
        </section>
      </div>

      <section aria-labelledby="recent-heading" className="grid gap-2">
        <h2 id="recent-heading" className="text-base font-semibold">Last 60 days</h2>
        {workspace.entries.length === 0 ? (
          <p className="border-y py-4 text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto border-y">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Date</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Machine</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Entry</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">By</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Status</th>
                  <th className="w-20 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {workspace.entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{shortDate(entry.entryDate)}</td>
                    <td className="py-2 pr-3">{entry.machineName}</td>
                    <td className="py-2 pr-3">
                      {MACHINE_LOG_KIND_LABELS[entry.kind]} · {entrySummary(entry)}
                    </td>
                    <td className="py-2 pr-3">{entry.loggedBy}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={entry.status === "approved" ? "secondary" : "outline"} className={cn(entry.status === "rejected" && "text-destructive")}>
                        {entry.status === "pending" ? "Waiting" : entry.status === "approved" ? "Approved" : "Rejected"}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {entry.canChange ? (
                        <div className="flex">
                          <Button type="button" variant="ghost" size="icon" aria-label="Change entry" onClick={() => openEntryDialog(entry.kind, entry)}>
                            <IconPencil className="size-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove entry" disabled={pending} onClick={() => setRemoving(entry)}>
                            <IconTrash className="size-4" />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {entryDialog ? (
        // Keyed per open so each window starts fresh on the kind its button asked for.
        <MachineLogEntryDialog
          key={entryDialog.key}
          workspace={workspace}
          onClose={() => setEntryDialog(null)}
          initialKind={entryDialog.kind}
          entry={entryDialog.entry}
        />
      ) : null}
      <AlertDialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? `${MACHINE_LOG_KIND_LABELS[removing.kind]} for ${removing.machineName} on ${shortDate(removing.entryDate)}: ${entrySummary(removing)}.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => (removing ? remove(removing) : null)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <MachineSetupDialog
        workspace={workspace}
        machine={editingMachine}
        open={machineDialog !== null}
        onOpenChange={(open) => {
          if (!open) setMachineDialog(null)
        }}
      />
    </div>
  )
}
