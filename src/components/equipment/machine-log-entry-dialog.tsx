"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { getMachineCostCodeOptions, saveMachineLogEntry, type EquipmentWorkspace, type MachineLogEntryView, type MachineCostCodeOption } from "@/app/actions/equipment"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  emptyMachineLogDraft,
  formatCents,
  formatNumber,
  machineTimeChargeCents,
  MACHINE_LOG_KIND_LABELS,
  MACHINE_LOG_KINDS,
  PAID_WITH_OPTIONS,
  validateMachineLog,
  type MachineLogDraft,
  type MachineLogKind,
} from "@/lib/equipment/model"
import { cn } from "@/lib/utils"

function draftFromEntry(entry: MachineLogEntryView): MachineLogDraft {
  const text = (value: number | null): string => (value === null ? "" : String(value))
  return {
    kind: entry.kind,
    machineId: entry.machineId,
    entryDate: entry.entryDate,
    projectId: entry.projectId ?? "",
    operatorName: entry.operatorName ?? "",
    costCode: entry.costCode ?? "",
    runningHours: text(entry.runningHours),
    standbyHours: text(entry.standbyHours),
    idleHours: text(entry.idleHours),
    hourMeter: text(entry.hourMeter),
    gallons: text(entry.gallons),
    amount: entry.amountCents === null ? "" : (entry.amountCents / 100).toFixed(2),
    vendor: entry.vendor ?? "",
    paidWith: entry.paidWith ?? "",
    serviceItemId: entry.serviceItemId ?? "",
    shopHours: text(entry.shopHours),
    notes: entry.notes ?? "",
  }
}

function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }): React.ReactElement | null {
  return message ? <p id={id} className="text-xs text-destructive">{message}</p> : null
}

/**
 * Logs machine hours, a fill-up, a service, a repair or another cost, or
 * changes an entry. Shows what is required for the chosen kind and, for
 * hours, what the time charges the job. Mounted fresh for every open (the
 * caller keys it), so it never carries over the last entry's kind.
 */
export function MachineLogEntryDialog({
  workspace,
  onClose,
  initialKind,
  entry,
}: {
  readonly workspace: EquipmentWorkspace
  readonly onClose: () => void
  readonly initialKind: MachineLogKind
  /** The entry being changed; null for a new one. */
  readonly entry: MachineLogEntryView | null
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState<MachineLogDraft>(() =>
    entry ? draftFromEntry(entry) : emptyMachineLogDraft(initialKind, workspace.today),
  )
  const [errors, setErrors] = React.useState<ReadonlyMap<string, string>>(new Map())
  const [pending, startTransition] = React.useTransition()

  const [projectCodes, setProjectCodes] = React.useState<{ readonly projectId: string; readonly options: readonly MachineCostCodeOption[] } | null>(null)
  React.useEffect(() => {
    if (!draft.projectId) return
    let cancelled = false
    const projectId = draft.projectId
    void getMachineCostCodeOptions(projectId).then((result) => {
      if (cancelled) return
      if (!result.success) toast.error(result.error)
      setProjectCodes({ projectId, options: result.success ? result.data : workspace.costCodes })
    }, () => {
      if (cancelled) return
      toast.error("Couldn't load project cost codes.")
      setProjectCodes({ projectId, options: workspace.costCodes })
    })
    return () => { cancelled = true }
  }, [draft.projectId, workspace.costCodes])
  const costCodes = projectCodes?.projectId === draft.projectId ? projectCodes.options : workspace.costCodes
  // Keep an older job-only selection while its project catalog is loading.
  const selectedCode = draft.costCode && !costCodes.some((code) => code.value === draft.costCode)
    ? [{ value: draft.costCode, label: draft.costCode }]
    : []
  const loadingCodes = Boolean(draft.projectId && projectCodes?.projectId !== draft.projectId)

  const machines = workspace.machines.filter((machine) => machine.active || machine.id === draft.machineId)
  const machine = workspace.machines.find((item) => item.id === draft.machineId)
  const isHours = draft.kind === "hours"
  const isService = draft.kind === "maintenance" || draft.kind === "repair"

  function set<K extends keyof MachineLogDraft>(key: K, value: MachineLogDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current.has(key) && !(key.endsWith("Hours") && current.has("hours"))) return current
      const next = new Map(current)
      next.delete(key)
      if (key.endsWith("Hours")) next.delete("hours")
      return next
    })
  }

  const preview = React.useMemo(() => {
    if (!isHours || !machine) return null
    const hours = (value: string): number | null => {
      const parsed = Number(value)
      return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    return machineTimeChargeCents(
      { runningHours: hours(draft.runningHours), standbyHours: hours(draft.standbyHours), idleHours: hours(draft.idleHours) },
      machine,
    )
  }, [isHours, machine, draft.runningHours, draft.standbyHours, draft.idleHours])

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const checked = validateMachineLog(draft)
    if (checked.errors.length > 0) {
      setErrors(new Map(checked.errors.map((error) => [error.key, error.message])))
      const first = checked.errors[0]
      if (first) document.getElementById(`machine-log-${first.key === "hours" ? "runningHours" : first.key}`)?.focus()
      return
    }
    startTransition(async () => {
      const result = await saveMachineLogEntry(entry?.id ?? null, draft)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(entry ? "Entry updated; it's back waiting for approval." : "Logged. It's waiting for approval.")
      onClose()
      router.refresh()
    })
  }

  const invalid = (key: string): { readonly "aria-invalid"?: true; readonly "aria-describedby"?: string } =>
    errors.has(key) ? { "aria-invalid": true, "aria-describedby": `machine-log-${key}-error` } : {}
  const required = <span className="ml-1 text-xs font-normal text-destructive">Required</span>

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {entry ? "Change machine log entry" : "Log machine time or cost"}
          </DialogTitle>
          <DialogDescription>Entries wait for approval before they go to Sage.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What are you logging?</legend>
            <div className="flex flex-wrap gap-2">
              {MACHINE_LOG_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={draft.kind === kind ? "default" : "outline"}
                  aria-pressed={draft.kind === kind}
                  onClick={() => {
                    setDraft((current) => ({ ...current, kind }))
                    setErrors(new Map())
                  }}
                >
                  {MACHINE_LOG_KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="machine-log-machineId">Machine{required}</Label>
              <SearchableCombobox
                id="machine-log-machineId"
                ariaLabel="Machine"
                options={machines.map((item) => ({ value: item.id, label: item.name, description: item.rateBookName ?? undefined }))}
                value={draft.machineId}
                onValueChange={(value) => set("machineId", value)}
                placeholder={machines.length === 0 ? "Add a machine first" : "Choose a machine"}
                searchPlaceholder="Search machines..."
                emptyMessage="No matching machines."
                className={cn("h-9", errors.has("machineId") && "border-destructive")}
              />
              <FieldError id="machine-log-machineId-error" message={errors.get("machineId")} />
              {machine ? (
                <p className="text-xs text-muted-foreground">
                  {machine.runningRateCents !== null ? `Rate book: ${formatCents(machine.runningRateCents)}/hr` : "No rate book entry linked"}
                  {machine.hourMeter !== null ? ` · Hour meter ${formatNumber(machine.hourMeter)}` : ""}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="machine-log-entryDate">Date{required}</Label>
              <Input id="machine-log-entryDate" type="date" value={draft.entryDate} onChange={(event) => set("entryDate", event.target.value)} {...invalid("entryDate")} />
              <FieldError id="machine-log-entryDate-error" message={errors.get("entryDate")} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="machine-log-projectId">
              {isHours ? "Job" : "Charge to a job"}
              {isHours ? required : null}
            </Label>
            <SearchableCombobox
              id="machine-log-projectId"
              ariaLabel={isHours ? "Job" : "Charge to a job"}
              options={[...(isHours ? [] : [{ value: "", label: "No job (machine overhead)" }]), ...workspace.jobs]}
              value={draft.projectId}
              onValueChange={(value) => set("projectId", value)}
              placeholder={isHours ? "Choose the job" : "No job (machine overhead)"}
              searchPlaceholder="Search jobs..."
              emptyMessage="No matching jobs."
              className={cn("h-9", errors.has("projectId") && "border-destructive")}
            />
            <FieldError id="machine-log-projectId-error" message={errors.get("projectId")} />
          </div>

          {isHours ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="machine-log-operatorName">Operator</Label>
                  <Input id="machine-log-operatorName" value={draft.operatorName} placeholder="You, if left blank" onChange={(event) => set("operatorName", event.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="machine-log-costCode">Cost code</Label>
                  <SearchableCombobox
                    id="machine-log-costCode"
                    ariaLabel="Cost code"
                    options={[{ value: "", label: "None", onBudget: costCodes.some((code) => code.onBudget) }, ...costCodes, ...selectedCode]}
                    disabled={loadingCodes}
                    value={draft.costCode}
                    onValueChange={(value) => set("costCode", value)}
                    placeholder="Choose a cost code"
                    searchPlaceholder="Search cost codes..."
                    emptyMessage="No matching cost codes."
                    className="h-9"
                  />
                </div>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Hours{required}</legend>
                <div className="grid grid-cols-3 gap-3">
                  {(["runningHours", "standbyHours", "idleHours"] as const).map((key) => (
                    <div key={key} className="grid gap-1">
                      <Label htmlFor={`machine-log-${key}`} className="text-xs text-muted-foreground">
                        {key === "runningHours" ? "Running" : key === "standbyHours" ? "Standby" : "Idle"}
                      </Label>
                      <Input id={`machine-log-${key}`} inputMode="decimal" value={draft[key]} onChange={(event) => set(key, event.target.value)} {...invalid(key)} />
                      <FieldError id={`machine-log-${key}-error`} message={errors.get(key)} />
                    </div>
                  ))}
                </div>
                <FieldError id="machine-log-hours-error" message={errors.get("hours")} />
                {preview !== null ? (
                  <p className="text-sm text-muted-foreground">Charges the job {formatCents(preview)} at the machine&apos;s rates.</p>
                ) : null}
              </fieldset>
            </>
          ) : null}

          {draft.kind === "maintenance" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="machine-log-serviceItemId">Service done</Label>
              <Select value={draft.serviceItemId || "none"} onValueChange={(value) => set("serviceItemId", value === "none" ? "" : value)}>
                <SelectTrigger id="machine-log-serviceItemId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Something else (describe below)</SelectItem>
                  {(machine?.services ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Choosing a scheduled service resets when it&apos;s next due.</p>
            </div>
          ) : null}

          {!isHours ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {draft.kind === "fuel" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="machine-log-gallons">Gallons</Label>
                  <Input id="machine-log-gallons" inputMode="decimal" value={draft.gallons} onChange={(event) => set("gallons", event.target.value)} {...invalid("gallons")} />
                  <FieldError id="machine-log-gallons-error" message={errors.get("gallons")} />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="machine-log-amount">
                  {isService ? "Parts and outside cost" : "Total cost"}
                  {isService ? null : required}
                </Label>
                <Input id="machine-log-amount" inputMode="decimal" placeholder="$" value={draft.amount} onChange={(event) => set("amount", event.target.value)} {...invalid("amount")} />
                <FieldError id="machine-log-amount-error" message={errors.get("amount")} />
              </div>
              {isService ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="machine-log-shopHours">Our shop hours</Label>
                  <Input id="machine-log-shopHours" inputMode="decimal" value={draft.shopHours} onChange={(event) => set("shopHours", event.target.value)} {...invalid("shopHours")} />
                  <FieldError id="machine-log-shopHours-error" message={errors.get("shopHours")} />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="machine-log-paidWith">Paid with</Label>
                <Select value={draft.paidWith || "none"} onValueChange={(value) => set("paidWith", value === "none" ? "" : value)}>
                  <SelectTrigger id="machine-log-paidWith" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {PAID_WITH_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="machine-log-vendor">Vendor</Label>
                <Input id="machine-log-vendor" value={draft.vendor} onChange={(event) => set("vendor", event.target.value)} />
              </div>
            </div>
          ) : null}

          <div className="grid gap-1.5 sm:max-w-48">
            <Label htmlFor="machine-log-hourMeter">Hour meter</Label>
            <Input id="machine-log-hourMeter" inputMode="decimal" value={draft.hourMeter} onChange={(event) => set("hourMeter", event.target.value)} {...invalid("hourMeter")} />
            <FieldError id="machine-log-hourMeter-error" message={errors.get("hourMeter")} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="machine-log-notes">
              Notes
              {draft.kind === "other" || draft.kind === "repair" ? required : null}
            </Label>
            <Textarea
              id="machine-log-notes"
              value={draft.notes}
              placeholder={draft.kind === "repair" ? "What broke and what was fixed" : "Anything the office should know"}
              onChange={(event) => set("notes", event.target.value)}
              {...invalid("notes")}
            />
            <FieldError id="machine-log-notes-error" message={errors.get("notes")} />
          </div>

          {errors.size > 0 ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.size === 1 ? "1 item needs attention." : `${errors.size} items need attention.`}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : entry ? "Save changes" : "Log it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
