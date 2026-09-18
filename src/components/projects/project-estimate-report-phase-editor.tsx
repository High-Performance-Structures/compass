"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { deleteProjectEstimateReportPhase, saveProjectEstimateReportPhase } from "@/app/actions/project-estimate-report-phases"
import type { ProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import type { EstimateReportPhase } from "@/lib/estimates/report-phases"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type PhaseDraft = {
  readonly id: string | null
  readonly divisionCode: string
  readonly name: string
  readonly description: string
  readonly itemize: boolean
  readonly sortOrder: number
  readonly lineIds: readonly string[]
}

function newDraft(workspace: ProjectEstimateWorkspace): PhaseDraft {
  return {
    id: null, divisionCode: "", name: "", description: "", itemize: false,
    sortOrder: Math.max(0, ...workspace.reportPhases.map((phase) => phase.sortOrder)) + 1,
    lineIds: [],
  }
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

export function ProjectEstimateReportPhaseEditor({ projectId, estimateId, workspace, editable }: {
  readonly projectId: string
  readonly estimateId: string
  readonly workspace: ProjectEstimateWorkspace
  readonly editable: boolean
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = useState<PhaseDraft | null>(null)
  const [deleting, setDeleting] = useState<EstimateReportPhase | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const divisions = new Map<string, string>()
  for (const cost of workspace.costCodes) divisions.set(cost.divisionCode, cost.divisionName)
  for (const line of workspace.lines) divisions.set(line.divisionCode, line.divisionName)
  const phaseNames = new Map(workspace.reportPhases.map((phase) => [phase.id, phase.name]))
  const selectedLines = workspace.lines.filter((line) => draft?.lineIds.includes(line.id))
  const visibleSubtotal = selectedLines.filter((line) => line.ownerVisible).reduce((sum, line) => sum + line.lineTotalCents, 0)

  function edit(phase: EstimateReportPhase): void {
    setMessage(null)
    setDraft({ ...phase, lineIds: workspace.lines.filter((line) => line.reportPhaseId === phase.id).map((line) => line.id) })
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!draft) return
    setMessage(null)
    startTransition(async () => {
      const result = await saveProjectEstimateReportPhase(projectId, estimateId, draft.id, draft)
      setMessage(result.success ? "Report phase saved. CSI codes and costs are unchanged." : result.error)
      if (result.success) { setDraft(null); router.refresh() }
    })
  }

  function remove(): void {
    if (!deleting) return
    const phase = deleting
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectEstimateReportPhase(projectId, estimateId, phase.id)
      setMessage(result.success ? "Phase deleted. Its lines are back in the default CSI grouping; costs were preserved." : result.error)
      if (result.success) { setDraft(null); router.refresh() }
      setDeleting(null)
    })
  }

  return (
    <section className="mt-5 space-y-3 border-t pt-4" aria-labelledby="report-phases-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="report-phases-heading" className="text-sm font-semibold">Custom report phases</h3>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Split any CSI division into as many client-facing phases as needed, in any department.
            Each phase has its own name, scope description, and itemize choice. CSI divisions keep
            their usual order; custom phases print within each division, followed by unassigned lines.
          </p>
        </div>
        {editable && <Button type="button" variant="outline" disabled={pending} onClick={() => { setMessage(null); setDraft(newDraft(workspace)) }}>Add report phase</Button>}
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
      {workspace.reportPhases.length === 0 && !draft && <p className="text-xs text-muted-foreground">No custom phases. Your current report format is unchanged.</p>}
      {workspace.reportPhases.map((phase) => {
        const lines = workspace.lines.filter((line) => line.reportPhaseId === phase.id)
        const subtotal = lines.filter((line) => line.ownerVisible).reduce((sum, line) => sum + line.lineTotalCents, 0)
        return (
          <div key={phase.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{phase.sortOrder}. {phase.name}</p>
              {phase.description && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{phase.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">CSI {phase.divisionCode} · {phase.itemize ? "Itemized for client" : "Lump sum for client"} · {lines.length} lines · {money(subtotal)}{lines.length === 0 ? " · Empty phases do not print" : ""}</p>
            </div>
            {editable && <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => edit(phase)}>Edit</Button>
              {workspace.canDelete && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setDeleting(phase)}>Delete</Button>}
            </div>}
          </div>
        )
      })}
      {draft && editable && <form className="space-y-4 border-t pt-4" onSubmit={save}>
        <h4 className="text-sm font-medium">{draft.id ? "Edit report phase" : "New report phase"}</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-phase-source">Source CSI division</Label>
            <Select value={draft.divisionCode} disabled={pending} onValueChange={(divisionCode) => setDraft({ ...draft, divisionCode, lineIds: [] })}>
              <SelectTrigger id="report-phase-source"><SelectValue placeholder="Choose division" /></SelectTrigger>
              <SelectContent>{[...divisions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([code, name]) => <SelectItem key={code} value={code}>{code} · {name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-phase-name">Customer-facing phase name</Label>
            <Input id="report-phase-name" required maxLength={160} value={draft.name} disabled={pending} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Fox Blocks insulating concrete forms" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-phase-order">Order within CSI division</Label>
            <Input id="report-phase-order" type="number" min={1} step={1} required value={draft.sortOrder} disabled={pending} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-phase-description">Scope description (shown beneath the phase name)</Label>
          <Textarea id="report-phase-description" maxLength={6000} value={draft.description} disabled={pending} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe what is included in this phase." />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="report-phase-itemize" checked={draft.itemize} disabled={pending} onCheckedChange={(value) => setDraft({ ...draft, itemize: value === true })} />
          <Label htmlFor="report-phase-itemize" className="leading-5">Itemize costs for the client, including assembly breakdowns. Unchecked shows only the phase description and subtotal.</Label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Estimate lines included in this phase</legend>
          <p className="text-xs text-muted-foreground">Each line belongs to one report phase. Selecting a line from another phase moves it here. Assembly breakdowns stay with their parent line; internal-only lines stay hidden.</p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {workspace.lines.filter((line) => line.divisionCode === draft.divisionCode).map((line) => (
              <div key={line.id} className="flex items-start gap-2 border-b py-2">
                <Checkbox id={`report-phase-line-${line.id}`} checked={draft.lineIds.includes(line.id)} disabled={pending} onCheckedChange={(value) => setDraft({ ...draft, lineIds: value === true ? [...draft.lineIds, line.id] : draft.lineIds.filter((id) => id !== line.id) })} />
                <Label htmlFor={`report-phase-line-${line.id}`} className="flex-1 text-sm leading-5">
                  {line.costCode} · {line.description} · {money(line.lineTotalCents)}
                  <span className="block text-xs font-normal text-muted-foreground">{line.reportPhaseId ? phaseNames.get(line.reportPhaseId) ?? "Default CSI grouping" : "Default CSI grouping"}{!line.ownerVisible ? " · Internal only" : ""}</span>
                </Label>
              </div>
            ))}
          </div>
          {draft.divisionCode && !workspace.lines.some((line) => line.divisionCode === draft.divisionCode) && <p className="text-xs text-muted-foreground">No lines in this division yet. You can save an empty phase and assign lines later.</p>}
          <p className="text-sm">Client-visible phase subtotal: {money(visibleSubtotal)}</p>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !draft.divisionCode}>Save phase</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(null)}>Cancel</Button>
        </div>
      </form>}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !pending) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report phase “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Only the report phase is deleted. All estimate lines, assembly breakdowns, and costs are preserved and return to their original CSI grouping. The phase deletion is recorded in the project activity log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={remove}>Delete phase only</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
