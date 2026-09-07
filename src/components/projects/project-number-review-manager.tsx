"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  IconAlertTriangle,
  IconArrowMerge,
  IconEdit,
  IconHash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getProjectMergeImpact,
  mergeDuplicateProjects,
} from "@/app/actions/project-duplicates"
import { correctProjectNumberForReview } from "@/app/actions/project-profile"
import type { ProjectListItem } from "@/app/actions/projects"
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
import type { ProjectMergeImpact } from "@/lib/project-merge-impact"
import {
  projectNumberReviewIssue,
  type ProjectNumberReviewIssue,
} from "@/lib/project-number-review"
import { cn } from "@/lib/utils"

type ReviewProject = {
  readonly project: ProjectListItem
  readonly issue: ProjectNumberReviewIssue
}

type ReviewMode = "correct" | "merge"

type MergeImpactState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly impact: ProjectMergeImpact }
  | { readonly status: "error"; readonly error: string }

function reviewProjects(projects: readonly ProjectListItem[]): readonly ReviewProject[] {
  return projects.flatMap((project) => {
    const issue = projectNumberReviewIssue(project.projectNumber, project.name)
    return issue ? [{ project, issue }] : []
  })
}

function projectLabel(project: ProjectListItem): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

function MergeImpact({ state }: { readonly state: MergeImpactState }): React.ReactElement {
  if (state.status === "loading") {
    return (
      <p className="text-xs text-muted-foreground">
        Inventorying documents, activity, and project records…
      </p>
    )
  }
  if (state.status === "error") {
    return <p className="text-xs text-destructive">{state.error}</p>
  }
  if (state.status !== "ready") {
    return (
      <p className="text-xs text-muted-foreground">
        Select the approved project to inventory everything that will move.
      </p>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">Records moving to the kept project</p>
      {state.impact.totalRecordCount > 0 ? (
        <div className="grid gap-1 sm:grid-cols-2">
          {state.impact.categories.map((category) => (
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
        <p className="text-xs text-muted-foreground">
          No linked content or activity records need to move.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        The transfer and registry merge are atomic. If any linked record cannot
        move safely, Compass keeps both projects unchanged.
      </p>
    </div>
  )
}

export function ProjectNumberReviewManager({
  projects,
  reviewProjectId,
  onReviewProjectHandled,
}: {
  readonly projects: readonly ProjectListItem[]
  readonly reviewProjectId: string | null
  readonly onReviewProjectHandled: () => void
}): React.ReactElement | null {
  const router = useRouter()
  const issues = useMemo(() => reviewProjects(projects), [projects])
  const [open, setOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [mode, setMode] = useState<ReviewMode>("correct")
  const [approvedProjectNumber, setApprovedProjectNumber] = useState("")
  const [keptProjectId, setKeptProjectId] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [mergeImpact, setMergeImpact] = useState<MergeImpactState>({
    status: "idle",
  })
  const [isPending, startTransition] = useTransition()

  const selected =
    issues.find((item) => item.project.id === selectedProjectId) ??
    issues[0] ??
    null
  const exactMergeTargets = selected
    ? projects.filter(
        (project) =>
          project.id !== selected.project.id &&
          selected.issue.suggestedProjectNumber !== null &&
          project.projectNumber?.trim().toUpperCase() ===
            selected.issue.suggestedProjectNumber,
      )
    : []
  const effectiveKeptProjectId = exactMergeTargets.some(
    (project) => project.id === keptProjectId,
  )
    ? keptProjectId
    : exactMergeTargets[0]?.id ?? ""

  const selectIssue = useCallback(
    (next: ReviewProject): void => {
      setSelectedProjectId(next.project.id)
      setApprovedProjectNumber(next.issue.suggestedProjectNumber ?? "")
      const target = projects.find(
        (project) =>
          project.id !== next.project.id &&
          next.issue.suggestedProjectNumber !== null &&
          project.projectNumber?.trim().toUpperCase() ===
            next.issue.suggestedProjectNumber,
      )
      setKeptProjectId(target?.id ?? "")
      setMode(target ? "merge" : "correct")
      setConfirmed(false)
    },
    [projects],
  )

  useEffect(() => {
    if (!reviewProjectId) return
    const next = issues.find((item) => item.project.id === reviewProjectId)
    onReviewProjectHandled()
    if (!next) return
    selectIssue(next)
    setOpen(true)
  }, [issues, onReviewProjectHandled, reviewProjectId, selectIssue])

  useEffect(() => {
    if (!open || mode !== "merge" || !selected || !effectiveKeptProjectId) {
      setMergeImpact({ status: "idle" })
      return
    }
    let cancelled = false
    setMergeImpact({ status: "loading" })
    async function loadImpact(): Promise<void> {
      if (!selected) return
      const result = await getProjectMergeImpact({
        keptProjectId: effectiveKeptProjectId,
        removedProjectId: selected.project.id,
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
  }, [effectiveKeptProjectId, mode, open, selected])

  if (issues.length === 0) return null

  function openFirst(): void {
    const first = issues[0]
    if (!first) return
    selectIssue(first)
    setOpen(true)
  }

  function correctNumber(): void {
    if (!selected || !confirmed) return
    startTransition(async () => {
      const result = await correctProjectNumberForReview({
        projectId: selected.project.id,
        approvedProjectNumber,
        reason: "number_review",
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setConfirmed(false)
      toast.success("Project number corrected and registry sync started.")
      router.refresh()
    })
  }

  function mergeIntoApprovedProject(): void {
    if (!selected || !confirmed || !effectiveKeptProjectId) return
    startTransition(async () => {
      const result = await mergeDuplicateProjects({
        keptProjectId: effectiveKeptProjectId,
        removedProjectId: selected.project.id,
        confirmationProjectId: selected.project.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setConfirmed(false)
      toast.success("Project records merged and the registry was updated.")
      router.push(`/dashboard/projects/${result.keptProjectId}`)
      router.refresh()
    })
  }

  return (
    <>
      <section className="flex flex-col gap-3 border border-destructive/30 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <IconHash className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <h2 className="text-sm font-semibold">
              {issues.length} project number{issues.length === 1 ? "" : "s"} need review
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Buildertrend placeholders and extra cutover segments do not match
              the approved registry format.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={openFirst}>
          <IconEdit className="size-4" />
          Review numbers
        </Button>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review project number</DialogTitle>
            <DialogDescription>
              Correct the existing registry record or merge it into the exact
              approved project already using the suggested base number.
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="min-w-0 space-y-5">
              {issues.length > 1 ? (
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="number-review-project">Project to review</Label>
                  <Select
                    value={selected.project.id}
                    onValueChange={(projectId) => {
                      const next = issues.find(
                        (item) => item.project.id === projectId,
                      )
                      if (next) selectIssue(next)
                    }}
                  >
                    <SelectTrigger id="number-review-project" className="w-full min-w-0">
                      <SelectValue className="min-w-0 truncate" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[calc(100vw-2rem)]">
                      {issues.map((item) => (
                        <SelectItem key={item.project.id} value={item.project.id}>
                          {projectLabel(item.project)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="min-w-0 border-y py-3">
                <p className="break-words text-sm font-semibold">
                  {selected.issue.currentProjectNumber}
                </p>
                <p className="mt-1 break-words text-sm">{selected.project.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.issue.reason === "buildertrend_placeholder"
                    ? "This Buildertrend placeholder must be replaced with an approved Compass project number."
                    : "Compass found one or more extra segments after the approved department, sequence, and suffix format."}
                </p>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("correct")
                    setConfirmed(false)
                  }}
                  className={cn(
                    "min-w-0 border p-3 text-left transition-colors",
                    mode === "correct"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <IconEdit className="size-4 shrink-0" />
                    Correct this project
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Keep this project and retain its old number as an alias.
                  </span>
                </button>
                <button
                  type="button"
                  disabled={exactMergeTargets.length === 0}
                  onClick={() => {
                    setMode("merge")
                    setConfirmed(false)
                  }}
                  className={cn(
                    "min-w-0 border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    mode === "merge"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <IconArrowMerge className="size-4 shrink-0" />
                    Merge into existing project
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {exactMergeTargets.length > 0
                      ? "An exact approved base-number record is available."
                      : "No project uses the suggested approved base number."}
                  </span>
                </button>
              </div>

              {mode === "correct" ? (
                <div className="space-y-2">
                  <Label htmlFor="approved-project-number">
                    Approved project number
                  </Label>
                  <Input
                    id="approved-project-number"
                    value={approvedProjectNumber}
                    onChange={(event) => {
                      setApprovedProjectNumber(event.target.value.toUpperCase())
                      setConfirmed(false)
                    }}
                    placeholder="N-1000-00"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    {selected.issue.suggestedProjectNumber
                      ? "Suggested from the governed number at the start of the imported project name. Verify it before confirming; Compass will not apply it automatically."
                      : "No governed number could be recovered from this import. Enter and verify the approved number; Compass will not invent one automatically."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="approved-merge-project">
                      Approved project to keep
                    </Label>
                    <Select
                      value={effectiveKeptProjectId}
                      onValueChange={(projectId) => {
                        setKeptProjectId(projectId)
                        setConfirmed(false)
                      }}
                    >
                      <SelectTrigger id="approved-merge-project" className="w-full min-w-0">
                        <SelectValue placeholder="Select approved project" />
                      </SelectTrigger>
                      <SelectContent className="max-w-[calc(100vw-2rem)]">
                        {exactMergeTargets.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {projectLabel(project)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <MergeImpact state={mergeImpact} />
                </div>
              )}

              <label className="flex min-w-0 items-start gap-3 border-t pt-4 text-sm">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0 break-words">
                  {mode === "correct"
                    ? `I verified ${approvedProjectNumber || "the approved number"}. Update the registry and retain ${selected.issue.currentProjectNumber} as a historical alias.`
                    : `I verified this is the same project. Transfer all linked records and remove ${selected.issue.currentProjectNumber} from the active registry.`}
                </span>
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconAlertTriangle className="size-4" />
              No project-number review is available.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {mode === "correct" ? (
              <Button
                type="button"
                onClick={correctNumber}
                disabled={isPending || !selected || !confirmed || !approvedProjectNumber}
              >
                <IconEdit className="size-4" />
                {isPending ? "Updating…" : "Update registry"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={mergeIntoApprovedProject}
                disabled={
                  isPending ||
                  !selected ||
                  !confirmed ||
                  !effectiveKeptProjectId ||
                  mergeImpact.status !== "ready"
                }
              >
                <IconArrowMerge className="size-4" />
                {isPending ? "Merging…" : "Merge projects"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
