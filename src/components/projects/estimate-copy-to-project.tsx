"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { IconFileExport } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  copyEstimateAssembliesToProject,
  getEstimateCopyTarget,
  type EstimateAssemblyCopySummary,
  type EstimateCopyTarget,
} from "@/app/actions/estimate-project-copies"
import { useProjectList } from "@/components/project-list-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UNASSIGNED_ITEMS, UNASSIGNED_NAME } from "@/lib/estimates/assembly-copy"

export type EstimateCopyGroup = {
  readonly id: string
  readonly name: string
  readonly lineCount: number
}

const NEW_DRAFT = "new"

function estimateHref(projectId: string, estimateId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/estimate?estimateId=${encodeURIComponent(estimateId)}`
}

function draftLabel(draft: EstimateCopyTarget["drafts"][number]): string {
  const kind = draft.kind === "change_order" ? "Change order estimate" : draft.kind === "phase" ? "Phase estimate" : "Estimate"
  return `${kind} ${draft.estimateNumber} v${draft.versionNumber} · ${draft.title}`
}

/**
 * "Copy to another job": copies the whole estimate or chosen assemblies into
 * an open draft (or a new draft) on another job. The source estimate is not
 * changed.
 */
export function EstimateCopyToProjectButton({
  projectId,
  estimateId,
  groups,
  unassignedCount,
  preselectedAssemblyId,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly groups: readonly EstimateCopyGroup[]
  readonly unassignedCount: number
  /** Opened from one assembly: only it starts checked. */
  readonly preselectedAssemblyId?: string
}): React.ReactElement {
  const router = useRouter()
  const projects = useProjectList()
  const choices = useMemo(
    () => [
      ...groups.filter((group) => group.lineCount > 0),
      ...(unassignedCount > 0 ? [{ id: UNASSIGNED_ITEMS, name: UNASSIGNED_NAME, lineCount: unassignedCount }] : []),
    ],
    [groups, unassignedCount],
  )
  const initialSelection = (): readonly string[] =>
    preselectedAssemblyId ? [preselectedAssemblyId] : choices.map((choice) => choice.id)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>(initialSelection)
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState<EstimateCopyTarget | null>(null)
  const [targetEstimate, setTargetEstimate] = useState<string>(NEW_DRAFT)
  const [markup, setMarkup] = useState("")
  const [loadingTarget, startLoading] = useTransition()
  const [pending, startTransition] = useTransition()

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return projects
      .filter((project) => project.id !== projectId)
      .filter((project) => `${project.projectNumber ?? ""} ${project.name} ${project.clientName ?? ""}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [projects, projectId, search])

  function reset(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) return
    setSelected(initialSelection())
    setSearch("")
    setTarget(null)
    setTargetEstimate(NEW_DRAFT)
    setMarkup("")
  }

  function chooseProject(targetProjectId: string): void {
    startLoading(async () => {
      const result = await getEstimateCopyTarget(targetProjectId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setTarget(result)
      setSearch("")
      setTargetEstimate(result.newDraftBlocked ? result.drafts[0]?.id ?? NEW_DRAFT : NEW_DRAFT)
      setMarkup(result.markupPercent === null ? "" : String(result.markupPercent))
    })
  }

  function toggle(id: string, checked: boolean): void {
    setSelected((current) => (checked ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id)))
  }

  const markupValue = markup.trim() === "" ? null : Number(markup)
  const markupInvalid = markupValue !== null && (!Number.isFinite(markupValue) || markupValue < 0 || markupValue > 1000)
  const noEstimate = target !== null && targetEstimate === NEW_DRAFT && target.newDraftBlocked !== null
  const canSubmit = target !== null && selected.length > 0 && !markupInvalid && !noEstimate && !pending

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!target) return
    startTransition(async () => {
      const result = await copyEstimateAssembliesToProject({
        sourceProjectId: projectId,
        sourceEstimateId: estimateId,
        assemblyIds: selected,
        targetProjectId: target.projectId,
        targetEstimateId: targetEstimate === NEW_DRAFT ? null : targetEstimate,
        markupPercent: markupValue,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      toast.success(`Copied to ${target.projectNumber ?? target.projectName} estimate ${result.estimateNumber}. This estimate is unchanged.`, {
        action: { label: "Open", onClick: () => router.push(estimateHref(result.projectId, result.estimateId)) },
      })
      router.refresh()
    })
  }

  const singleName = preselectedAssemblyId ? choices.find((choice) => choice.id === preselectedAssemblyId)?.name : undefined

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={choices.length === 0}>
          <IconFileExport className="size-4" />
          {preselectedAssemblyId ? "Copy to job" : "Copy to another job"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{singleName ? `Copy ${singleName} to another job` : "Copy to another job"}</DialogTitle>
            <DialogDescription>
              Adds the chosen assemblies to an estimate on another job, for example scope you&apos;ll now do as a subcontractor.
              This estimate isn&apos;t changed.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What to copy</legend>
            {choices.map((choice) => (
              <div key={choice.id} className="flex items-center gap-2">
                <Checkbox
                  id={`copy-group-${choice.id}`}
                  checked={selected.includes(choice.id)}
                  onCheckedChange={(checked) => toggle(choice.id, checked === true)}
                />
                <Label htmlFor={`copy-group-${choice.id}`} className="font-normal">
                  {choice.name}
                  <span className="text-muted-foreground"> · {choice.lineCount} {choice.lineCount === 1 ? "item" : "items"}</span>
                </Label>
              </div>
            ))}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="copy-target-search">Copy to job</Label>
            {target ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{target.projectNumber ? `${target.projectNumber} · ` : ""}{target.projectName}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTarget(null)}>Change</Button>
              </div>
            ) : (
              <>
                <Input
                  id="copy-target-search"
                  placeholder="Search by job number or name"
                  value={search}
                  autoComplete="off"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {matches.length > 0 && (
                  <ul className="divide-y rounded-lg border text-sm">
                    {matches.map((project) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                          disabled={loadingTarget}
                          onClick={() => chooseProject(project.id)}
                        >
                          {project.projectNumber ? `${project.projectNumber} · ` : ""}{project.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Need a new job? Create it with <Link className="underline" href={`/dashboard/projects/${encodeURIComponent(projectId)}#linked-jobs`}>Linked jobs</Link> on
                  this job&apos;s page (customer and site are filled in), then copy into it.
                </p>
              </>
            )}
          </div>

          {target && (
            <>
              <div className="space-y-2">
                <Label htmlFor="copy-target-estimate">Into estimate</Label>
                <Select value={targetEstimate} onValueChange={setTargetEstimate}>
                  <SelectTrigger id="copy-target-estimate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!target.newDraftBlocked && <SelectItem value={NEW_DRAFT}>New draft estimate</SelectItem>}
                    {target.drafts.map((draft) => (
                      <SelectItem key={draft.id} value={draft.id}>{draftLabel(draft)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {target.newDraftBlocked && <p className="text-xs text-muted-foreground">{target.newDraftBlocked}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="copy-markup">Markup on copied items (%)</Label>
                <Input
                  id="copy-markup"
                  inputMode="decimal"
                  placeholder="Keep each item's markup"
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                  aria-invalid={markupInvalid}
                />
                <p className="text-xs text-muted-foreground">
                  {target.markupPercent === null
                    ? "Leave blank to keep the markup from this estimate. A default per department can be set in Settings → Workflows → Estimates."
                    : "From this department's default in Settings. Leave blank to keep the markup from this estimate."}
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Quantities, units, unit costs and cost breakdowns are copied; prices are recalculated at the markup above.</li>
                <li>This job&apos;s builder fee doesn&apos;t come along; the items join the other estimate&apos;s own builder fee.</li>
                <li>The two jobs are linked, and this estimate notes where each assembly went.</li>
              </ul>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{pending ? "Copying…" : "Copy"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Copied to H-123 estimate H-123-00" notes under an assembly. */
export function EstimateAssemblyCopyNotes({
  copies,
  assemblyId,
}: {
  readonly copies: readonly EstimateAssemblyCopySummary[]
  /** Null for items not in an assembly. */
  readonly assemblyId: string | null
}): React.ReactElement | null {
  const mine = copies.filter((copy) => copy.sourceAssemblyId === assemblyId)
  if (mine.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      Copied to{" "}
      {mine.map((copy, index) => (
        <span key={copy.id}>
          {index > 0 && ", "}
          <Link className="underline" href={estimateHref(copy.targetProjectId, copy.targetEstimateId)}>
            {copy.targetEstimateNumber}
          </Link>
          {` on ${copy.createdAt.slice(0, 10)}`}
        </span>
      ))}
    </p>
  )
}
