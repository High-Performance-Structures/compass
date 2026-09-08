"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  IconAlertTriangle,
  IconArrowMerge,
  IconCopy,
  IconEdit,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  confirmProjectsAreDistinct,
  getProjectMergeImpact,
  mergeDuplicateProjects,
  scanProjectDuplicates,
} from "@/app/actions/project-duplicates"
import { correctProjectNumberForReview } from "@/app/actions/project-profile"
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
import { Input } from "@/components/ui/input"
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
import type { ProjectMergeImpact } from "@/lib/project-merge-impact"
import { cn } from "@/lib/utils"

type MergeImpactState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly impact: ProjectMergeImpact }
  | { readonly status: "error"; readonly error: string }

type CollisionResolutionMode = "merge" | "renumber"

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

function strongestCandidateForProject(
  candidates: readonly ProjectDuplicateCandidate[],
  projectId: string,
): ProjectDuplicateCandidate | null {
  let strongestCandidate: ProjectDuplicateCandidate | null = null

  for (const candidate of candidates) {
    const includesProject =
      candidate.first.id === projectId || candidate.second.id === projectId
    if (
      includesProject &&
      (!strongestCandidate || candidate.score > strongestCandidate.score)
    ) {
      strongestCandidate = candidate
    }
  }

  return strongestCandidate
}

export function ProjectDuplicateManager({
  candidates,
  reviewProjectId,
  onReviewProjectHandled,
  onCandidatesScanned,
}: {
  readonly candidates: readonly ProjectDuplicateCandidate[]
  readonly reviewProjectId: string | null
  readonly onReviewProjectHandled: () => void
  readonly onCandidatesScanned: (
    candidates: readonly ProjectDuplicateCandidate[],
  ) => void
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
  const [collisionResolutionMode, setCollisionResolutionMode] =
    useState<CollisionResolutionMode>("merge")
  const [replacementProjectNumber, setReplacementProjectNumber] = useState("")
  const [mergeImpact, setMergeImpact] = useState<MergeImpactState>({
    status: "idle",
  })
  const [isPending, startTransition] = useTransition()
  const [isScanning, startScanTransition] = useTransition()
  const [lastScanSummary, setLastScanSummary] = useState<string | null>(null)

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
  const selectedCandidateKey = selectedCandidate
    ? candidateKey(selectedCandidate)
    : ""
  const hasNumberCollision =
    selectedCandidate?.reasons.some(
      (reason) => reason.code === "project_department_sequence",
    ) ?? false

  useEffect(() => {
    if (!reviewProjectId) return

    const candidate = strongestCandidateForProject(
      visibleCandidates,
      reviewProjectId,
    )
    onReviewProjectHandled()
    if (!candidate) return

    setSelectedKey(candidateKey(candidate))
    setKeptProjectId(candidate.first.id)
    setCollisionResolutionMode("merge")
    setReplacementProjectNumber("")
    setConfirmed(false)
    setOpen(true)
  }, [onReviewProjectHandled, reviewProjectId, visibleCandidates])

  useEffect(() => {
    if (
      !open ||
      collisionResolutionMode !== "merge" ||
      !selectedCandidateKey ||
      !removedProjectId
    ) {
      setMergeImpact({ status: "idle" })
      return
    }

    let cancelled = false
    setMergeImpact({ status: "loading" })
    async function loadImpact(): Promise<void> {
      const result = await getProjectMergeImpact({
        keptProjectId: effectiveKeptProjectId,
        removedProjectId,
      })
      if (cancelled) return
      setMergeImpact(
        result.success
          ? { status: "ready", impact: result.impact }
          : { status: "error", error: result.error },
      )
    }
    loadImpact()

    return () => {
      cancelled = true
    }
  }, [
    collisionResolutionMode,
    effectiveKeptProjectId,
    open,
    removedProjectId,
    selectedCandidateKey,
  ])

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

  function renumberSelected(): void {
    if (
      !selectedCandidate ||
      !hasNumberCollision ||
      !confirmed ||
      !removedProjectId ||
      !replacementProjectNumber
    ) {
      return
    }
    startTransition(async () => {
      const result = await correctProjectNumberForReview({
        projectId: removedProjectId,
        approvedProjectNumber: replacementProjectNumber,
        reason: "number_collision",
        conflictingProjectId: effectiveKeptProjectId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setConfirmed(false)
      toast.success("Project number reassigned and the registry was updated.")
      router.refresh()
    })
  }

  function scanForDuplicates(): void {
    startScanTransition(async () => {
      const result = await scanProjectDuplicates()
      if (!result.success) {
        toast.error(result.error)
        return
      }

      setDismissedKeys(new Set())
      onCandidatesScanned(result.candidates)
      const reviewedSummary =
        result.previouslyReviewedCount > 0
          ? ` ${result.previouslyReviewedCount} previously reviewed ${result.previouslyReviewedCount === 1 ? "pair remains" : "pairs remain"} hidden.`
          : ""
      const limitedSummary =
        result.matchCount > result.candidates.length
          ? ` Showing the first ${result.candidates.length}.`
          : ""
      setLastScanSummary(
        `Scanned ${result.scannedProjectCount} registry projects and found ${result.matchCount} unresolved ${result.matchCount === 1 ? "match" : "matches"}.${reviewedSummary}${limitedSummary}`,
      )
      toast.success("Duplicate scan complete.")
    })
  }

  return (
    <>
      <section
        className={cn(
          "flex flex-col gap-3 border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          visibleCandidates.length > 0
            ? "border-brand-nutech-gold/40 bg-brand-nutech-gold/5"
            : "border-border bg-muted/20",
        )}
      >
        <div className="flex items-start gap-3">
          {visibleCandidates.length > 0 ? (
            <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-nutech-gold-foreground" />
          ) : (
            <IconRefresh className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          )}
          <div>
            <h2 className="text-sm font-semibold">
              {visibleCandidates.length > 0
                ? `${visibleCandidates.length} possible duplicate or number collision${visibleCandidates.length === 1 ? "" : "s"}`
                : "No possible duplicates found"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {visibleCandidates.length > 0
                ? "Review the matches and resolve reused department-sequence numbers."
                : "Scan the current registry whenever new projects have been added or updated."}
            </p>
            {lastScanSummary ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {lastScanSummary}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={scanForDuplicates}
            disabled={isScanning || isPending}
          >
            <IconRefresh className={cn("size-4", isScanning && "animate-spin")} />
            {isScanning ? "Scanning…" : "Scan for duplicates"}
          </Button>
          {visibleCandidates.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const first = visibleCandidates[0]
                setSelectedKey(first ? candidateKey(first) : "")
                setKeptProjectId(first?.first.id ?? "")
                setCollisionResolutionMode("merge")
                setReplacementProjectNumber("")
                setConfirmed(false)
                setOpen(true)
              }}
            >
              <IconArrowMerge className="size-4" />
              Review and resolve
            </Button>
          ) : null}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review possible duplicate projects</DialogTitle>
            <DialogDescription>
              {hasNumberCollision
                ? "Confirm whether the records are the same project. If they are separate, keep one number and assign a new sequence to the other project."
                : "Confirm that the records are separate, or select which registry record Compass should keep."}
            </DialogDescription>
          </DialogHeader>

          {selectedCandidate ? (
            <div className="space-y-5">
              {visibleCandidates.length > 1 ? (
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="duplicate-candidate">Potential match</Label>
                  <Select
                    value={candidateKey(selectedCandidate)}
                    onValueChange={(value) => {
                      const next = visibleCandidates.find(
                        (candidate) => candidateKey(candidate) === value,
                      )
                      setSelectedKey(value)
                      setKeptProjectId(next?.first.id ?? "")
                      setCollisionResolutionMode("merge")
                      setReplacementProjectNumber("")
                      setConfirmed(false)
                    }}
                  >
                    <SelectTrigger
                      id="duplicate-candidate"
                      className="w-full min-w-0"
                      title={`${projectLabel(selectedCandidate, selectedCandidate.first.id)} / ${projectLabel(selectedCandidate, selectedCandidate.second.id)}`}
                    >
                      <SelectValue className="min-w-0 truncate" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      align="start"
                      className="max-w-[calc(100vw-2rem)]"
                    >
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

              <div className="min-w-0 space-y-2">
                <Label htmlFor="kept-project">
                  {collisionResolutionMode === "merge"
                    ? "Merge into project"
                    : "Project keeping the current number"}
                </Label>
                <Select
                  value={effectiveKeptProjectId}
                  onValueChange={(value) => {
                    setKeptProjectId(value)
                    setReplacementProjectNumber("")
                    setConfirmed(false)
                  }}
                >
                  <SelectTrigger id="kept-project" className="w-full min-w-0">
                    <SelectValue className="min-w-0 truncate" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    align="start"
                    className="max-w-[calc(100vw-2rem)]"
                  >
                    {[selectedCandidate.first, selectedCandidate.second].map(
                      (project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {projectLabel(selectedCandidate, project.id)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {collisionResolutionMode === "merge"
                    ? "All linked records will move into this project. The other registry record will be archived for recovery."
                    : "The other project will receive the new approved project number entered below."}
                </p>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {[selectedCandidate.first, selectedCandidate.second].map(
                  (project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setKeptProjectId(project.id)
                        setReplacementProjectNumber("")
                        setConfirmed(false)
                      }}
                      className={`min-w-0 overflow-hidden border p-3 text-left transition-colors ${
                        effectiveKeptProjectId === project.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                        <IconCopy className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">
                          {project.projectNumber ?? "No project number"}
                        </span>
                      </span>
                      <span className="mt-1 block break-words text-sm">
                        {project.name}
                      </span>
                      <span className="mt-1 block break-words text-xs text-muted-foreground">
                        {project.clientName ?? "No client"}
                        {project.address ? ` · ${project.address}` : ""}
                      </span>
                      <span className="mt-3 block text-xs font-medium text-primary">
                        {effectiveKeptProjectId === project.id
                          ? hasNumberCollision &&
                            collisionResolutionMode === "renumber"
                            ? "Keep this number"
                            : "Keep this project"
                          : hasNumberCollision &&
                              collisionResolutionMode === "renumber"
                            ? "Assign a new number"
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

              {hasNumberCollision ? (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCollisionResolutionMode("merge")
                      setConfirmed(false)
                    }}
                    className={cn(
                      "min-w-0 border p-3 text-left transition-colors",
                      collisionResolutionMode === "merge"
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <IconArrowMerge className="size-4 shrink-0" />
                      Same project
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Merge all linked records into the selected project.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCollisionResolutionMode("renumber")
                      setConfirmed(false)
                    }}
                    className={cn(
                      "min-w-0 border p-3 text-left transition-colors",
                      collisionResolutionMode === "renumber"
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <IconEdit className="size-4 shrink-0" />
                      Separate projects
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Keep both projects and assign a new sequence to one.
                    </span>
                  </button>
                </div>
              ) : null}

              {collisionResolutionMode === "merge" ? (
                <div className="min-w-0 border-b pb-3 text-sm">
                <p className="font-medium">Records moving to the kept project</p>
                {mergeImpact.status === "loading" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inventorying documents, activity, and project records…
                  </p>
                ) : null}
                {mergeImpact.status === "error" ? (
                  <p className="mt-1 text-xs text-destructive">
                    {mergeImpact.error} Merging is disabled until the inventory succeeds.
                  </p>
                ) : null}
                {mergeImpact.status === "ready" ? (
                  mergeImpact.impact.totalRecordCount > 0 ? (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {mergeImpact.impact.categories.map((category) => (
                        <p
                          key={category.id}
                          className="flex min-w-0 justify-between gap-3 text-xs text-muted-foreground"
                        >
                          <span className="min-w-0 truncate">{category.label}</span>
                          <span className="shrink-0 tabular-nums">
                            {category.recordCount}
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No linked content or activity records need to move.
                    </p>
                  )
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  The transfer and registry merge are atomic. If any linked record
                  cannot move safely, Compass keeps both projects unchanged.
                </p>
                </div>
              ) : (
                <div className="min-w-0 space-y-2 border-b pb-3">
                  <Label htmlFor="replacement-project-number">
                    New approved project number
                  </Label>
                  <Input
                    id="replacement-project-number"
                    value={replacementProjectNumber}
                    onChange={(event) => {
                      setReplacementProjectNumber(event.target.value.toUpperCase())
                      setConfirmed(false)
                    }}
                    placeholder="H-426-515"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a new department-sequence-suffix number for the project
                    marked “Assign a new number.” The department stays the same,
                    and the old number remains as a historical alias.
                  </p>
                </div>
              )}

              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  id="confirm-project-merge"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  disabled={
                    collisionResolutionMode === "merge" &&
                    mergeImpact.status !== "ready"
                  }
                />
                <Label
                  htmlFor="confirm-project-merge"
                  className="min-w-0 break-words text-sm font-normal leading-5"
                >
                  {collisionResolutionMode === "merge"
                    ? `I confirm that ${projectLabel(selectedCandidate, removedProjectId)} will be removed from the active registry and its linked documents, activity, and project records will be transferred to the kept project. Its archived registry record remains available for recovery.`
                    : `I verified these are separate projects. Update ${projectLabel(selectedCandidate, removedProjectId)} to ${replacementProjectNumber || "the new approved number"} and keep the other project's number unchanged.`}
                </Label>
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            {!hasNumberCollision ? (
              <Button
                type="button"
                variant="outline"
                onClick={dismissSelected}
                disabled={isPending || !selectedCandidate}
              >
                Not duplicates
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
            {collisionResolutionMode === "merge" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={mergeSelected}
                disabled={
                  isPending ||
                  !selectedCandidate ||
                  !confirmed ||
                  mergeImpact.status !== "ready"
                }
              >
                <IconArrowMerge className="size-4" />
                {isPending ? "Saving…" : "Merge projects"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={renumberSelected}
                disabled={
                  isPending ||
                  !selectedCandidate ||
                  !confirmed ||
                  !replacementProjectNumber
                }
              >
                <IconEdit className="size-4" />
                {isPending ? "Updating…" : "Update registry"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
