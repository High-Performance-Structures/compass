"use client"

import * as React from "react"
import { IconTrash } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  deleteMachine,
  deleteServiceItem,
  saveMachine,
  saveServiceItem,
  type EquipmentWorkspace,
  type MachineInput,
  type MachineView,
  type ServiceInput,
} from "@/app/actions/equipment"
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
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { serviceDueLabel } from "@/lib/equipment/model"

const NO_RATE = "__none__"

function machineInput(machine: MachineView | null): MachineInput {
  const dollars = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2))
  return {
    name: machine?.name ?? "",
    sageEquipmentNumber: machine?.sageEquipmentNumber ?? "",
    rateBookEntryId: machine?.rateBookEntryId ?? "",
    standbyRate: dollars(machine?.standbyRateCents ?? null),
    idleRate: dollars(machine?.idleRateCents ?? null),
    hourMeter: machine?.hourMeter === null || machine?.hourMeter === undefined ? "" : String(machine.hourMeter),
    active: machine?.active ?? true,
    notes: machine?.notes ?? "",
  }
}

const EMPTY_SERVICE: ServiceInput = { name: "", everyHours: "", everyDays: "", lastDoneHours: "", lastDoneOn: "" }

/**
 * Sets up a machine: its name, Sage equipment number, rate book entry (the
 * running rate), standby and idle rates, hour meter, and service schedule.
 */
export function MachineSetupDialog({
  workspace,
  machine,
  open,
  onOpenChange,
}: {
  readonly workspace: EquipmentWorkspace
  /** The machine being changed; null to add one. */
  readonly machine: MachineView | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [input, setInput] = React.useState<MachineInput>(() => machineInput(machine))
  const [service, setService] = React.useState<ServiceInput>(EMPTY_SERVICE)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    setInput(machineInput(machine))
    setService(EMPTY_SERVICE)
  }, [open, machine])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveMachine(machine?.id ?? null, input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(machine ? "Machine saved." : "Machine added. Open its settings (gear) to add its service schedule.")
      onOpenChange(false)
      router.refresh()
    })
  }

  function addService(): void {
    if (!machine) return
    startTransition(async () => {
      const result = await saveServiceItem(machine.id, null, service)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setService(EMPTY_SERVICE)
      toast.success("Service added to the schedule.")
      router.refresh()
    })
  }

  function removeService(itemId: string): void {
    startTransition(async () => {
      const result = await deleteServiceItem(itemId)
      if (!result.success) toast.error(result.error)
      else router.refresh()
    })
  }

  function remove(): void {
    if (!machine) return
    startTransition(async () => {
      const result = await deleteMachine(machine.id)
      setConfirmDelete(false)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Machine removed.")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{machine ? `Set up ${machine.name}` : "Add a machine"}</DialogTitle>
            <DialogDescription>Its running rate comes from the rate book, the same rate shop tickets bill.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="machine-name">Name</Label>
                <Input id="machine-name" value={input.name} placeholder="Kubota SVL75-2 track loader" onChange={(event) => setInput({ ...input, name: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="machine-sage">Sage equipment #</Label>
                <Input id="machine-sage" value={input.sageEquipmentNumber} onChange={(event) => setInput({ ...input, sageEquipmentNumber: event.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="machine-rate">Rate book entry</Label>
              <SearchableCombobox
                id="machine-rate"
                ariaLabel="Rate book entry"
                options={[{ value: NO_RATE, label: "None (hours aren't priced)" }, ...workspace.rateBookMachines]}
                value={input.rateBookEntryId || NO_RATE}
                onValueChange={(value) => setInput({ ...input, rateBookEntryId: value === NO_RATE ? "" : value })}
                placeholder="Choose a Machine rate"
                searchPlaceholder="Search the rate book..."
                emptyMessage="No Machine entries in the rate book."
                className="h-9"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="machine-standby">Standby rate ($/hr)</Label>
                <Input id="machine-standby" inputMode="decimal" placeholder="Not billed" value={input.standbyRate} onChange={(event) => setInput({ ...input, standbyRate: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="machine-idle">Idle rate ($/hr)</Label>
                <Input id="machine-idle" inputMode="decimal" placeholder="Not billed" value={input.idleRate} onChange={(event) => setInput({ ...input, idleRate: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="machine-meter">Hour meter</Label>
                <Input id="machine-meter" inputMode="decimal" value={input.hourMeter} onChange={(event) => setInput({ ...input, hourMeter: event.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="machine-notes">Notes</Label>
              <Textarea id="machine-notes" value={input.notes} onChange={(event) => setInput({ ...input, notes: event.target.value })} />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={input.active} onCheckedChange={(active) => setInput({ ...input, active })} />
              Active (offered when logging)
            </label>
            <DialogFooter className="sm:justify-between">
              {machine ? (
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
                  <IconTrash className="size-4" />
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : machine ? "Save machine" : "Add machine"}
              </Button>
            </DialogFooter>
          </form>

          {machine ? (
            <section aria-labelledby="machine-services" className="grid gap-3 border-t pt-4">
              <h3 id="machine-services" className="text-sm font-semibold">Service schedule</h3>
              {machine.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">No services yet. Add oil changes, greasing, inspections and so on.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {machine.services.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0">
                      <span>
                        <span className="font-medium">{item.name}</span>
                        <span className="text-muted-foreground">
                          {" "}every {[item.everyHours !== null ? `${item.everyHours} h` : null, item.everyDays !== null ? `${item.everyDays} days` : null].filter(Boolean).join(" or ")}
                          {" · "}
                          {serviceDueLabel("due", item.due)}
                        </span>
                      </span>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item.name}`} disabled={pending} onClick={() => removeService(item.id)}>
                        <IconTrash className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_5rem_5rem_6rem_9rem_auto] sm:items-end">
                <div className="grid gap-1">
                  <Label htmlFor="service-name" className="text-xs">Service</Label>
                  <Input id="service-name" value={service.name} placeholder="Oil change" onChange={(event) => setService({ ...service, name: event.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-hours" className="text-xs">Every h</Label>
                  <Input id="service-hours" inputMode="decimal" value={service.everyHours} placeholder="250" onChange={(event) => setService({ ...service, everyHours: event.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-days" className="text-xs">Every days</Label>
                  <Input id="service-days" inputMode="numeric" value={service.everyDays} onChange={(event) => setService({ ...service, everyDays: event.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-last-hours" className="text-xs">Last at h</Label>
                  <Input id="service-last-hours" inputMode="decimal" value={service.lastDoneHours} onChange={(event) => setService({ ...service, lastDoneHours: event.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-last-on" className="text-xs">Last on</Label>
                  <Input id="service-last-on" type="date" value={service.lastDoneOn} onChange={(event) => setService({ ...service, lastDoneOn: event.target.value })} />
                </div>
                <Button type="button" variant="outline" disabled={pending} onClick={addService}>
                  Add
                </Button>
              </div>
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {machine?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A machine with log entries can&apos;t be removed; turn off Active to retire it and keep its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
