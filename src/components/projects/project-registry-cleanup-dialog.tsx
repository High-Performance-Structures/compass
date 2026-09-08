"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { IconArrowMerge, IconTrash } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { archiveProjectFromRegistry, getProjectMergeChoices, getProjectMergeImpact, mergeDuplicateProjects, type ProjectMergeChoice } from "@/app/actions/project-duplicates"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ProjectMergeImpact } from "@/lib/project-merge-impact"

function label(project: ProjectMergeChoice): string {
  const prefix = project.projectNumber ? `${project.projectNumber} — ` : ""
  const routed = project.mergedIntoProjectId ? " (inactive/routed)" : project.status === "INACTIVE" ? " (inactive)" : ""
  return `${prefix}${project.name}${routed}`
}

export function ProjectRegistryCleanupDialog(): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<readonly ProjectMergeChoice[]>([])
  const [destinations, setDestinations] = useState<readonly ProjectMergeChoice[]>([])
  const [sourceId, setSourceId] = useState("")
  const [destinationId, setDestinationId] = useState("")
  const [mode, setMode] = useState<"merge" | "remove">("merge")
  const [confirmed, setConfirmed] = useState(false)
  const [impact, setImpact] = useState<ProjectMergeImpact | null>(null)
  const [isPending, startTransition] = useTransition()
  const source = useMemo(() => sources.find((item) => item.id === sourceId) ?? null, [sourceId, sources])

  useEffect(() => {
    if (!open) return
    startTransition(async () => {
      const result = await getProjectMergeChoices()
      if (!result.success) { toast.error(result.error); return }
      setSources(result.sources)
      setDestinations(result.destinations)
      setSourceId(result.sources[0]?.id ?? "")
    })
  }, [open])

  useEffect(() => {
    if (!open || mode !== "merge" || !sourceId || !destinationId || sourceId === destinationId) {
      setImpact(null)
      return
    }
    let cancelled = false
    getProjectMergeImpact({ keptProjectId: destinationId, removedProjectId: sourceId }).then((result) => {
      if (!cancelled) setImpact(result.success ? result.impact : null)
    })
    return () => { cancelled = true }
  }, [destinationId, mode, open, sourceId])

  function submit(): void {
    if (!source || !confirmed) return
    startTransition(async () => {
      const result = mode === "remove"
        ? await archiveProjectFromRegistry({ projectId: source.id, confirmationProjectId: source.id })
        : await mergeDuplicateProjects({ keptProjectId: destinationId, removedProjectId: source.id, confirmationProjectId: source.id, selectionReason: "manual_registry_selection" })
      if (!result.success) { toast.error(result.error); return }
      setOpen(false)
      setConfirmed(false)
      toast.success(mode === "remove" ? "Project moved to the Executive Admin archive." : "Project records merged into the selected destination.")
      if (mode === "merge" && "keptProjectId" in result) router.push(`/dashboard/projects/${result.keptProjectId}`)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="outline"><IconArrowMerge className="size-4" />Merge or remove project</Button></DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Registry cleanup</DialogTitle><DialogDescription>Select any registry project, then merge all of its linked records into an active project or move it to the recoverable archive.</DialogDescription></DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-2"><Label>Project to merge or remove</Label><Select value={sourceId} onValueChange={(value) => { setSourceId(value); setConfirmed(false) }}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent className="max-w-[calc(100vw-2rem)]">{sources.map((item) => <SelectItem key={item.id} value={item.id}>{label(item)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className={`border p-3 text-left ${mode === "merge" ? "border-primary bg-primary/5" : ""}`} onClick={() => { setMode("merge"); setConfirmed(false) }}><span className="font-medium">Merge into a project</span><span className="mt-1 block text-xs text-muted-foreground">Move linked documents, activity, financials, contacts, and other records atomically.</span></button>
            <button type="button" className={`border p-3 text-left ${mode === "remove" ? "border-destructive bg-destructive/5" : ""}`} onClick={() => { setMode("remove"); setConfirmed(false) }}><span className="font-medium">Remove from registry</span><span className="mt-1 block text-xs text-muted-foreground">Keep a recoverable record under Executive Admin and retire its number.</span></button>
          </div>
          {mode === "merge" ? <div className="space-y-2"><Label>Project to keep</Label><Select value={destinationId} onValueChange={(value) => { setDestinationId(value); setConfirmed(false) }}><SelectTrigger className="w-full min-w-0"><SelectValue placeholder="Choose any active project" /></SelectTrigger><SelectContent className="max-w-[calc(100vw-2rem)]">{destinations.filter((item) => item.id !== sourceId).map((item) => <SelectItem key={item.id} value={item.id}>{label(item)}</SelectItem>)}</SelectContent></Select>{impact ? <p className="text-xs text-muted-foreground">{impact.totalRecordCount} linked record{impact.totalRecordCount === 1 ? "" : "s"} will move. The transfer is atomic.</p> : null}</div> : null}
          <label className="flex items-start gap-3 border-t pt-4 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><span>I confirm that {source ? label(source) : "this project"} will {mode === "merge" ? "be removed after its linked records move to the selected project" : "leave the active registry and remain recoverable by Executive Admin"}.</span></label>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="button" variant={mode === "remove" ? "destructive" : "default"} disabled={!confirmed || isPending || (mode === "merge" && (!destinationId || destinationId === sourceId))} onClick={submit}>{mode === "remove" ? <IconTrash className="size-4" /> : <IconArrowMerge className="size-4" />}{isPending ? "Working…" : mode === "remove" ? "Remove project" : "Merge projects"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
