"use client"

import { useState, useTransition } from "react"
import { IconRestore, IconTrash } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { permanentlyDeleteArchivedRegistryProject, restoreArchivedRegistryProject, type ArchivedRegistryProject } from "@/app/actions/project-registry-archive"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Pending = { readonly kind: "restore" | "delete"; readonly project: ArchivedRegistryProject } | null

export function ProjectRegistryArchive({ projects }: { readonly projects: readonly ArchivedRegistryProject[] }): React.ReactElement {
  const router = useRouter(); const [pending, setPending] = useState<Pending>(null); const [confirmation, setConfirmation] = useState(""); const [isPending, startTransition] = useTransition()
  const required = pending?.kind === "delete" ? "DELETE" : "RESTORE"
  function submit(): void {
    if (!pending || confirmation !== required) return
    startTransition(async () => {
      const input = { projectId: pending.project.projectId, confirmationProjectId: pending.project.projectId, confirmation }
      const result = pending.kind === "delete" ? await permanentlyDeleteArchivedRegistryProject(input) : await restoreArchivedRegistryProject(input)
      if (!result.success) { toast.error(result.error); return }
      toast.success(pending.kind === "delete" ? "Project permanently deleted; its number remains retired." : "Project restored to the registry.")
      setPending(null); setConfirmation(""); router.refresh()
    })
  }
  return <>
    {projects.length === 0 ? <div className="border p-6 text-sm text-muted-foreground">No projects have been removed from the registry.</div> : <div className="divide-y border">{projects.map((project) => <div key={project.projectId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{project.projectNumber ? `${project.projectNumber} — ` : ""}{project.name}</p><p className="text-xs text-muted-foreground">Removed {new Date(project.removedAt).toLocaleString()}{project.removedBy ? ` by ${project.removedBy}` : ""}. Number remains retired.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setPending({ kind: "restore", project }); setConfirmation("") }}><IconRestore className="size-4" />Restore</Button><Button size="sm" variant="destructive" onClick={() => { setPending({ kind: "delete", project }); setConfirmation("") }}><IconTrash className="size-4" />Delete permanently</Button></div></div>)}</div>}
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}><DialogContent><DialogHeader><DialogTitle>{pending?.kind === "delete" ? "Permanently delete project" : "Restore project"}</DialogTitle><DialogDescription>{pending?.kind === "delete" ? "Deletion is allowed only when no linked project records remain. The retired project number will not become available." : "Restore the project, its former status, and its retired project number."}</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="archive-confirmation">Type {required} to confirm</Label><Input id="archive-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} /></div><DialogFooter><Button variant="outline" onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.kind === "delete" ? "destructive" : "default"} disabled={isPending || confirmation !== required} onClick={submit}>{isPending ? "Working…" : required}</Button></DialogFooter></DialogContent></Dialog>
  </>
}
