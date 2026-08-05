"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconAlertTriangle,
  IconBuilding,
  IconBuildingCommunity,
  IconCheck,
  IconLayoutCards,
  IconList,
  IconPaint,
  IconPlus,
  IconSettings,
  IconTool,
} from "@tabler/icons-react"

import type { DashboardOverview } from "@/app/actions/dashboard-overview"
import type { ProjectListItem } from "@/app/actions/projects"
import { useActiveProject } from "@/components/project-list-provider"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OfficeMaintenanceDrawer } from "@/components/projects/office-maintenance-drawer"
import { openHpsProjectManagerWorkWindow } from "@/lib/google/project-manager-app"
import { cn } from "@/lib/utils"

type DepartmentFilter = "ALL" | "O" | "H" | "N" | "D" | "OTHER"
type StatusFilter = "active" | "warranty" | "complete" | "all"
type ProjectLayout = "cards" | "list"

type DepartmentDefinition = {
  readonly id: DepartmentFilter
  readonly label: string
  readonly icon: React.ReactNode
}

const DEPARTMENTS: readonly DepartmentDefinition[] = [
  { id: "ALL", label: "All", icon: <IconBuilding className="size-4" /> },
  { id: "O", label: "ORC", icon: <IconBuilding className="size-4" /> },
  { id: "H", label: "HPS", icon: <IconBuildingCommunity className="size-4" /> },
  { id: "N", label: "Nu-Tech", icon: <IconTool className="size-4" /> },
  { id: "D", label: "Design", icon: <IconPaint className="size-4" /> },
  { id: "OTHER", label: "Other", icon: <IconSettings className="size-4" /> },
]

const STATUS_OPTIONS: readonly {
  readonly value: StatusFilter
  readonly label: string
}[] = [
  { value: "active", label: "Active" },
  { value: "warranty", label: "Warranty" },
  { value: "complete", label: "Complete" },
  { value: "all", label: "All" },
]

function departmentForProject(project: ProjectListItem): DepartmentFilter {
  const prefix = project.projectNumber?.trim().slice(0, 1).toUpperCase()
  if (prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D") {
    return prefix
  }
  return "OTHER"
}

function statusForProject(project: ProjectListItem): StatusFilter {
  const status = project.status.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")
  if (
    status === "open" ||
    status === "active" ||
    status === "current" ||
    status === "construction" ||
    status === "in progress" ||
    status === "scheduled" ||
    status === "preconstruction"
  ) {
    return "active"
  }
  if (status.includes("warranty") || status.includes("service")) {
    return "warranty"
  }
  if (status === "closed" || status === "complete" || status === "completed") {
    return "complete"
  }
  return "all"
}

function departmentAccent(department: DepartmentFilter): string {
  if (department === "O" || department === "D") return "border-l-[#6f471f]"
  if (department === "H") return "border-l-[#3f7d4d]"
  if (department === "N") return "border-l-[#9d832c]"
  return "border-l-muted-foreground"
}

function projectDisplayName(project: ProjectListItem): string {
  return project.projectNumber ?? project.name
}

function projectSubtitle(project: ProjectListItem): string {
  if (project.projectNumber) return project.name
  return project.clientName ?? "Project"
}

function ProjectHealth({
  projectId,
  overview,
}: {
  readonly projectId: string
  readonly overview: DashboardOverview
}): React.ReactElement {
  const health = overview.projects.find((project) => project.id === projectId)

  if (!health) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconCheck className="size-3.5 text-emerald-700" />
        No priority flags
      </span>
    )
  }

  if (health.openRfiCount > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-[#8a3a2e]">
        <IconAlertTriangle className="size-3.5" />
        {health.openRfiCount} pending RFI{health.openRfiCount === 1 ? "" : "s"}
      </span>
    )
  }

  if (health.openPoCount > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-[#715d1c]">
        <IconAlertTriangle className="size-3.5" />
        {health.openPoCount} open PO{health.openPoCount === 1 ? "" : "s"}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <IconCheck className="size-3.5 text-emerald-700" />
      On track · {health.progress}%
    </span>
  )
}

function ProjectCard({
  project,
  overview,
  layout,
}: {
  readonly project: ProjectListItem
  readonly overview: DashboardOverview
  readonly layout: ProjectLayout
}): React.ReactElement {
  const department = departmentForProject(project)
  const health = overview.projects.find((item) => item.id === project.id)
  const photo = overview.fieldPhotos.find((item) => item.projectId === project.id)

  if (layout === "list") {
    return (
      <Link
        href={`/dashboard/projects/${project.id}`}
        className={cn(
          "grid min-w-0 gap-3 border-l-4 bg-background px-4 py-3 transition-colors hover:bg-muted/50 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(14rem,1fr)_auto]",
          departmentAccent(department)
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{projectDisplayName(project)}</p>
          <p className="truncate text-xs text-muted-foreground">{projectSubtitle(project)}</p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm">
            {health?.nextTask?.title ?? project.clientName ?? "No next schedule item"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {department === "OTHER" ? "Unassigned department" : department}
          </p>
        </div>
        <ProjectHealth projectId={project.id} overview={overview} />
      </Link>
    )
  }

  return (
    <article
      className={cn(
        "group min-w-0 overflow-hidden border border-l-4 bg-background transition-shadow hover:shadow-md",
        departmentAccent(department)
      )}
    >
      {photo ? (
        <Link
          href={`/dashboard/projects/${project.id}`}
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
      ) : (
        <div className="flex h-20 items-center justify-center bg-gradient-to-br from-muted to-muted/40 sm:h-24">
          <IconBuilding className="size-6 text-muted-foreground/40" />
        </div>
      )}

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {project.projectNumber ?? "Compass project"}
            </p>
            <h2 className="mt-0.5 truncate text-sm font-semibold">
              {project.name}
            </h2>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-[10px]"
          >
            {department === "OTHER" ? "Other" : department}
          </Badge>
        </div>

        <p className="mt-2 truncate text-xs text-muted-foreground">
          {health?.nextTask ? `Next: ${health.nextTask.title}` : project.clientName ?? "No next phase recorded"}
        </p>
        <div className="mt-2">
          <ProjectHealth projectId={project.id} overview={overview} />
        </div>

        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-between px-0 text-xs hover:bg-transparent"
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

function NewProjectButton(): React.ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => openHpsProjectManagerWorkWindow()}
    >
      <IconPlus className="size-4" />
      New project
    </Button>
  )
}

export function ProjectHubLaunchpad({
  projects,
  overview,
  canManageProjects,
}: {
  readonly projects: readonly ProjectListItem[]
  readonly overview: DashboardOverview
  readonly canManageProjects: boolean
}): React.ReactElement {
  const { activeProjectId } = useActiveProject()
  const [department, setDepartment] = useState<DepartmentFilter>("ALL")
  const [status, setStatus] = useState<StatusFilter>("active")
  const [layout, setLayout] = useState<ProjectLayout>("cards")

  const statusCounts = useMemo(
    () => ({
      active: projects.filter((project) => statusForProject(project) === "active").length,
      warranty: projects.filter((project) => statusForProject(project) === "warranty").length,
      complete: projects.filter((project) => statusForProject(project) === "complete").length,
      all: projects.length,
    }),
    [projects]
  )

  const departmentCounts = useMemo(() => {
    const inStatus = projects.filter(
      (project) => status === "all" || statusForProject(project) === status
    )
    return new Map(
      DEPARTMENTS.map((item) => [
        item.id,
        item.id === "ALL"
          ? inStatus.length
          : inStatus.filter((project) => departmentForProject(project) === item.id).length,
      ])
    )
  }, [projects, status])

  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          (status === "all" || statusForProject(project) === status) &&
          (department === "ALL" || departmentForProject(project) === department)
      ),
    [department, projects, status]
  )

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-4 lg:p-5">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Project Hub</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Active jobs and the issues that need attention
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageProjects ? (
            <OfficeMaintenanceDrawer projects={projects} />
          ) : null}
          {canManageProjects ? (
            <NewProjectButton />
          ) : null}
        </div>
      </header>

      <section className="space-y-3 border-b pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <p className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Departments
          </p>
          <div className="flex min-w-0 flex-1 gap-px overflow-x-auto border bg-border">
            {DEPARTMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDepartment(item.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 bg-background px-3 text-sm font-medium transition-colors hover:bg-muted",
                  department === item.id && "bg-[#2f5963] text-white hover:bg-[#2f5963]"
                )}
              >
                {item.icon}
                {item.label}
                <span className={cn("text-xs tabular-nums text-muted-foreground", department === item.id && "text-white/75")}>
                  {departmentCounts.get(item.id) ?? 0}
                </span>
              </button>
            ))}
            <div className="min-w-[17rem] flex-1 bg-background">
              <ProjectQuickSwitcher
                projects={projects}
                currentProjectId={activeProjectId}
                placeholder="Jump to project..."
                className="w-full rounded-none border-0 bg-background shadow-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <p className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "flex h-8 items-center gap-2 border px-3 text-sm transition-colors hover:bg-muted",
                  status === value && "border-[#2f5963] bg-[#2f5963]/[0.07] font-semibold"
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full border",
                    status === value && "border-[#2f5963] bg-[#2f5963]"
                  )}
                />
                {label}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {statusCounts[value]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)} projects
            </h2>
            <p className="text-xs text-muted-foreground">
              {visibleProjects.length} project{visibleProjects.length === 1 ? "" : "s"} shown · use ⌘K for global search
            </p>
          </div>
          <div className="grid grid-cols-2 border p-0.5">
            <button
              type="button"
              onClick={() => setLayout("list")}
              className={cn("flex size-8 items-center justify-center", layout === "list" && "bg-muted")}
              aria-label="List view"
            >
              <IconList className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setLayout("cards")}
              className={cn("flex size-8 items-center justify-center", layout === "cards" && "bg-muted")}
              aria-label="Card view"
            >
              <IconLayoutCards className="size-4" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            "mt-3",
            layout === "cards"
              ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
              : "divide-y border-y"
          )}
        >
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              overview={overview}
              layout={layout}
            />
          ))}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mt-3 border-y px-4 py-12 text-center">
            <p className="text-sm font-medium">No projects match these filters.</p>
            <button
              type="button"
              onClick={() => {
                setDepartment("ALL")
                setStatus("all")
              }}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : null}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>Live Compass project and job-health data</span>
        <div className="flex gap-4">
          <Link href="/dashboard" className="font-medium hover:text-foreground">
            Dashboard
          </Link>
        </div>
      </footer>
    </main>
  )
}
