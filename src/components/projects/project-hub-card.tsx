"use client"

import { Suspense, use, useEffect, useState, useTransition } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  IconAlertTriangle,
  IconBuilding,
  IconCheck,
  IconCopy,
  IconHash,
} from "@tabler/icons-react"

import { updateProjectJobStatus } from "@/app/actions/project-profile"
import type { ProjectListItem } from "@/app/actions/projects"
import {
  projectHubHealth,
  projectHubPhoto,
  type ProjectHubSignals,
} from "@/components/projects/project-hub-signals"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  projectClientStatusLabel,
} from "@/lib/project-profile"
import { projectDepartment, type ProjectDepartmentFilter } from "@/lib/project-views"
import { cn } from "@/lib/utils"

export type ProjectLayout = "cards" | "list"

function departmentAccent(department: ProjectDepartmentFilter): string {
  if (department === "O" || department === "D") return "border-l-brand-orc-brown"
  if (department === "H") return "border-l-brand-hps-field"
  if (department === "N") return "border-l-brand-nutech-gold"
  return "border-l-muted-foreground"
}

function projectDisplayName(project: ProjectListItem): string {
  return project.projectNumber ?? project.name
}

function projectSubtitle(project: ProjectListItem): string {
  if (project.projectNumber) return project.name
  return project.clientName ?? "Project"
}

/** A muted bar in place of job-health text while the overview streams in. */
function SignalPending({ className }: { readonly className: string }): React.ReactElement {
  return <span aria-hidden="true" className={cn("inline-block animate-pulse rounded-sm bg-muted align-middle", className)} />
}

function ProjectHealth({
  projectId,
  signals,
}: {
  readonly projectId: string
  readonly signals: Promise<ProjectHubSignals>
}): React.ReactElement {
  const health = projectHubHealth(use(signals), projectId)

  if (!health) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <IconCheck className="size-3.5" />
        No priority flags
      </span>
    )
  }

  if (health.openRfiCount > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-brand-compass-red">
        <IconAlertTriangle className="size-3.5" />
        {health.openRfiCount} pending RFI{health.openRfiCount === 1 ? "" : "s"}
      </span>
    )
  }

  if (health.openPoCount > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-brand-nutech-gold-foreground">
        <IconAlertTriangle className="size-3.5" />
        {health.openPoCount} open PO{health.openPoCount === 1 ? "" : "s"}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
      <IconCheck className="size-3.5" />
      On track · {health.progress}%
    </span>
  )
}

/** The next schedule item, or the fallback text when there is none. */
function ProjectNextStep({
  projectId,
  signals,
  prefix,
  fallback,
}: {
  readonly projectId: string
  readonly signals: Promise<ProjectHubSignals>
  readonly prefix: string
  readonly fallback: string
}): React.ReactElement {
  const title = projectHubHealth(use(signals), projectId)?.nextTaskTitle ?? null
  return <>{title !== null ? `${prefix}${title}` : fallback}</>
}

function ProjectCardPhotoPlaceholder(): React.ReactElement {
  return (
    <div className="flex h-20 items-center justify-center bg-gradient-to-br from-muted to-muted/40 sm:h-24">
      <IconBuilding className="size-6 text-muted-foreground/40" />
    </div>
  )
}

function ProjectCardPhoto({
  projectId,
  signals,
}: {
  readonly projectId: string
  readonly signals: Promise<ProjectHubSignals>
}): React.ReactElement {
  const photo = projectHubPhoto(use(signals), projectId)
  if (!photo) return <ProjectCardPhotoPlaceholder />
  return (
    <Link
      href={`/dashboard/projects/${projectId}`}
      className="relative block h-20 overflow-hidden bg-muted sm:h-24"
    >
      <Image
        src={photo.imageUrl}
        alt={photo.caption ?? photo.fileName}
        fill
        sizes="(min-width: 1536px) 18vw, (min-width: 1280px) 23vw, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
        unoptimized
        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </Link>
  )
}

export function ProjectCard({
  project,
  signals,
  layout,
  canUpdateProjectStatus,
  isPossibleDuplicate,
  needsNumberReview,
  onReviewDuplicate,
  onReviewProjectNumber,
}: {
  readonly project: ProjectListItem
  readonly signals: Promise<ProjectHubSignals>
  readonly layout: ProjectLayout
  readonly canUpdateProjectStatus: boolean
  readonly isPossibleDuplicate: boolean
  readonly needsNumberReview: boolean
  readonly onReviewDuplicate: (projectId: string) => void
  readonly onReviewProjectNumber: (projectId: string) => void
}): React.ReactElement {
  const department = projectDepartment(project)

  if (layout === "list") {
    return (
      <div
        className={cn(
          "group relative grid min-w-0 gap-3 border-l-4 bg-background px-4 py-3 transition-colors hover:bg-muted/50 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(14rem,1fr)_auto]",
          departmentAccent(department)
        )}
      >
        <Link
          href={`/dashboard/projects/${project.id}`}
          aria-label={`Open ${project.name}`}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
        <div className="pointer-events-none min-w-0">
          <p className="truncate text-sm font-semibold">{projectDisplayName(project)}</p>
          <p className="truncate text-xs text-muted-foreground">{projectSubtitle(project)}</p>
        </div>
        <div className="pointer-events-none min-w-0">
          <p className="truncate text-sm">
            <Suspense fallback={<SignalPending className="h-3 w-32" />}>
              <ProjectNextStep projectId={project.id} signals={signals} prefix="" fallback={project.clientName ?? "No next schedule item"} />
            </Suspense>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {department === "OTHER" ? "Unassigned department" : department}
          </p>
        </div>
        <div className="pointer-events-none flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <Badge variant="secondary">{project.jobStatusLabel}</Badge>
            <Badge variant="outline">{projectClientStatusLabel(project.clientStatus)}</Badge>
          </div>
          <Suspense fallback={<SignalPending className="h-3.5 w-24" />}>
            <ProjectHealth projectId={project.id} signals={signals} />
          </Suspense>
        </div>
        {isPossibleDuplicate ? (
          <button
            type="button"
            onClick={() => onReviewDuplicate(project.id)}
            title={`Review duplicate matches for ${project.name}`}
            aria-label={`Review duplicate matches for ${project.name}`}
            className="relative z-10 flex items-center gap-1 text-xs font-medium text-brand-nutech-gold-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconCopy className="size-3.5" />
            Possible duplicate
          </button>
        ) : null}
        {needsNumberReview ? (
          <button
            type="button"
            onClick={() => onReviewProjectNumber(project.id)}
            title={`Review project number for ${project.name}`}
            aria-label={`Review project number for ${project.name}`}
            className="relative z-10 flex items-center gap-1 text-xs font-medium text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconHash className="size-3.5" />
            Number needs review
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <article
      className={cn(
        "group min-w-0 overflow-hidden border border-l-4 bg-background transition-shadow hover:shadow-md",
        departmentAccent(department)
      )}
    >
      <Suspense fallback={<ProjectCardPhotoPlaceholder />}>
        <ProjectCardPhoto projectId={project.id} signals={signals} />
      </Suspense>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {project.projectNumber ?? "Compass project"}
            </p>
            <h2 className="mt-0.5 truncate text-sm font-semibold">
              {project.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isPossibleDuplicate ? (
              <button
                type="button"
                onClick={() => onReviewDuplicate(project.id)}
                title={`Review duplicate matches for ${project.name}`}
                aria-label={`Review duplicate matches for ${project.name}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-brand-nutech-gold-foreground transition-colors hover:bg-brand-nutech-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconCopy className="size-4" />
              </button>
            ) : null}
            {needsNumberReview ? (
              <button
                type="button"
                onClick={() => onReviewProjectNumber(project.id)}
                title={`Review project number for ${project.name}`}
                aria-label={`Review project number for ${project.name}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconHash className="size-4" />
              </button>
            ) : null}
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-xs"
            >
              {department === "OTHER" ? "Other" : department}
            </Badge>
          </div>
        </div>

        <p className="mt-2 truncate text-xs text-muted-foreground">
          <Suspense fallback={<SignalPending className="h-3 w-32" />}>
            <ProjectNextStep projectId={project.id} signals={signals} prefix="Next: " fallback={project.clientName ?? "No next phase recorded"} />
          </Suspense>
        </p>
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ProjectJobStatusSelect
              project={project}
              canUpdate={canUpdateProjectStatus}
            />
            <Badge variant="outline">{projectClientStatusLabel(project.clientStatus)}</Badge>
          </div>
          <div className="mt-2">
            <Suspense fallback={<SignalPending className="h-3.5 w-24" />}>
            <ProjectHealth projectId={project.id} signals={signals} />
          </Suspense>
          </div>
        </div>

        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-between px-0 text-xs text-primary hover:bg-transparent hover:text-primary/80"
        >
          <Link href={`/dashboard/projects/${project.id}`}>
            Open project hub
            <span aria-hidden="true">→</span>
          </Link>
        </Button>
      </div>
    </article>
  )
}

function ProjectJobStatusSelect({
  project,
  canUpdate,
}: {
  readonly project: ProjectListItem
  readonly canUpdate: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selectedStatusId, setSelectedStatusId] = useState(project.jobStatusId)

  useEffect(() => {
    setSelectedStatusId(project.jobStatusId)
  }, [project.jobStatusId])

  if (!canUpdate) {
    return <Badge variant="secondary">{project.jobStatusLabel}</Badge>
  }

  const selectedStatusLabel =
    PROJECT_JOB_STATUS_DEFINITIONS.find(
      (status) => status.id === selectedStatusId,
    )?.label ?? project.jobStatusLabel

  function changeStatus(jobStatusId: string): void {
    if (jobStatusId === selectedStatusId) return
    const previousStatusId = selectedStatusId
    setSelectedStatusId(jobStatusId)
    startTransition(async () => {
      const result = await updateProjectJobStatus({
        projectId: project.id,
        jobStatusId,
      })
      if (!result.success) {
        setSelectedStatusId(previousStatusId)
        toast.error(result.error ?? "Unable to update project status.")
        return
      }

      const nextStatusLabel =
        PROJECT_JOB_STATUS_DEFINITIONS.find(
          (status) => status.id === jobStatusId,
        )?.label ?? "selected status"
      toast.success(`${project.name} moved to ${nextStatusLabel}.`)
      router.refresh()
    })
  }

  return (
    <SearchableCombobox
      className="h-6 w-auto max-w-full border-0 bg-secondary px-2 text-xs font-medium shadow-none"
      value={selectedStatusId}
      // Each choice saves immediately; ignore the picker's empty reset.
      onValueChange={(value) => {
        if (value !== "") changeStatus(value)
      }}
      disabled={pending}
      options={PROJECT_JOB_STATUS_DEFINITIONS.map((status) => ({
        value: status.id,
        label: status.label,
        selectedLabel:
          status.id === selectedStatusId
            ? pending
              ? "Saving…"
              : selectedStatusLabel
            : undefined,
      }))}
      ariaLabel={`Update status for ${project.name}`}
      placeholder={selectedStatusLabel}
      searchPlaceholder="Search job statuses..."
      emptyMessage="No matching job statuses."
    />
  )
}
