"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconArrowMerge, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  confirmProjectsAreDistinct,
  mergeDuplicateProjects,
} from "@/app/actions/project-duplicates"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  projectDuplicatePairKey,
  type ProjectDuplicateCandidate,
} from "@/lib/project-duplicate-detector"

function projectLabel(candidate: ProjectDuplicateCandidate, projectId: string): string {
  const project =
    candidate.first.id === projectId ? candidate.first : candidate.second
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

function candidateKey(candidate: ProjectDuplicateCandidate): string {
  return projectDuplicatePairKey(candidate.first.id, candidate.second.id)
}

export function ProjectDuplicateManager({
  candidates,
}: {
  readonly candidates: readonly ProjectDuplicateCandidate[]
}): React.ReactElement | null {
  const router = useRouter()
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const visibleCandidates = useMemo(
    () =>
      candidates.filter((candidate) => !dismissedKeys.has(candidateKey(candidate))),
    [candidates, dismissedKeys],
  )
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState("")
  const [keptProjectId, setKeptProjectId] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectedCandidate =
    visibleCandidates.find((candidate) => candidateKey(candidate) === selectedKey) ??
    visibleCandidates[0] ??
    null
  const effectiveKeptProjectId =
    selectedCandidate &&
    (keptProjectId === selectedCandidate.first.id ||
      keptProjectId === selectedCandidate.second.id)
      ? keptProjectId
      : selectedCandidate?.first.id ?? ""
  const removedProjectId = selectedCandidate
    ? selectedCandidate.first.id === effectiveKeptProjectId
      ? selectedCandidate.second.id
      : selectedCandidate.first.id
    : ""

  if (visibleCandidates.length === 0) return null

  function dismissSelected(): void {
    if (!selectedCandidate) return
    startTransition(async () => {
      const result = await confirmProjectsAreDistinct({
        firstProjectId: selectedCandidate.first.id,
        secondProjectId: selectedCandidate.second.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDismissedKeys((current) => {
        const next = new Set(current)
        next.add(candidateKey(selectedCandidate))
        return next
      })
      setConfirmed(false)
      toast.success("Saved as two separate projects.")
      if (visibleCandidates.length <= 1) setOpen(false)
      router.refresh()
    })
  }

  function mergeSelected(): void {
    if (!selectedCandidate || !confirmed || !removedProjectId) return
    startTransition(async () => {
      const result = await mergeDuplicateProjects({
        keptProjectId: effectiveKeptProjectId,
        removedProjectId,
        confirmationProjectId: removedProjectId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setConfirmed(false)
      toast.success("Projects merged and the registry was updated.")
      router.push(`/dashboard/projects/${result.keptProjectId}`)
      router.refresh()
    })
  }

  return (
    <>
      <section className="flex flex-col gap-3 border border-brand-nutech-gold/40 bg-brand-nutech-gold/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-nutech-gold-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              {visibleCandidates.length} possible duplicate project
              {visibleCandidates.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Review the matches before relying on the project registry.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const first = visibleCandidates[0]
            setSelectedKey(first ? candidateKey(first) : "")
            setKeptProjectId(first?.first.id ?? "")
            setConfirmed(false)
            setOpen(true)
          }}
        >
          <IconArrowMerge className="size-4" />
          Review and merge
        </Button>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review possible duplicate projects</DialogTitle>
            <DialogDescription>
              Confirm that the records are separate, or select which registry
              record Compass should keep.
            </DialogDescription>
          </DialogHeader>

          {selectedCandidate ? (
            <div className="space-y-5">
              {visibleCandidates.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="duplicate-candidate">Potential match</Label>
                  <Select
                    value={candidateKey(selectedCandidate)}
                    onValueChange={(value) => {
                      const next = visibleCandidates.find(
                        (candidate) => candidateKey(candidate) === value,
                      )
                      setSelectedKey(value)
                      setKeptProjectId(next?.first.id ?? "")
                      setConfirmed(false)
                    }}
                  >
                    <SelectTrigger id="duplicate-candidate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleCandidates.map((candidate) => (
                        <SelectItem
                          key={candidateKey(candidate)}
                          value={candidateKey(candidate)}
                        >
                          {projectLabel(candidate, candidate.first.id)} / {projectLabel(candidate, candidate.second.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                {[selectedCandidate.first, selectedCandidate.second].map(
                  (project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setKeptProjectId(project.id)
                        setConfirmed(false)
                      }}
                      className={`border p-3 text-left transition-colors ${
                        effectiveKeptProjectId === project.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <IconCopy className="size-4" />
                        {project.projectNumber ?? "No project number"}
                      </span>
                      <span className="mt-1 block text-sm">{project.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {project.clientName ?? "No client"}
                        {project.address ? ` · ${project.address}` : ""}
                      </span>
                      <span className="mt-3 block text-xs font-medium text-primary">
                        {effectiveKeptProjectId === project.id
                          ? "Keep this project"
                          : "Select to keep"}
                      </span>
                    </button>
                  ),
                )}
              </div>

              <div className="border-y py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Why Compass flagged this pair ({selectedCandidate.score}% match)
                </p>
                <p className="mt-1">
                  {selectedCandidate.reasons.map((reason) => reason.label).join(" · ")}
                </p>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-project-merge"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <Label
                  htmlFor="confirm-project-merge"
                  className="text-sm font-normal leading-5"
                >
                  I confirm that {projectLabel(selectedCandidate, removedProjectId)}
                  {" "}will be removed from the active registry. Its record is
                  archived for recovery and hidden from normal project lists.
                  Its operational data remains available from a recovery link
                  on the kept project, and missing external IDs are copied.
                </Label>
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={dismissSelected}
              disabled={isPending || !selectedCandidate}
            >
              Not duplicates
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={mergeSelected}
              disabled={isPending || !selectedCandidate || !confirmed}
            >
              <IconArrowMerge className="size-4" />
              {isPending ? "Saving…" : "Merge projects"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
