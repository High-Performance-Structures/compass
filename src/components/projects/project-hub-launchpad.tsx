"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import {
  IconBuilding,
  IconBuildingCommunity,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconLayoutCards,
  IconList,
  IconPaint,
  IconSelector,
  IconHome,
  IconSettings,
  IconTool,
} from "@tabler/icons-react"

import type {
  ProjectIntakeAssignee,
  ProjectListItem,
} from "@/app/actions/projects"
import { useActiveProject, useProjectList, useProjectViewPreferences } from "@/components/project-list-provider"
import { ProjectCard, type ProjectLayout } from "@/components/projects/project-hub-card"
import type { ProjectHubSignals } from "@/components/projects/project-hub-signals"
import { InternalWorkspaceCreateButton } from "@/components/projects/internal-workspace-create-button"
import { ProjectIntakeDrawer } from "@/components/projects/project-intake-drawer"
import { ProjectDuplicateManager } from "@/components/projects/project-duplicate-manager"
import { ProjectNumberReviewManager } from "@/components/projects/project-number-review-manager"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OfficeMaintenanceDrawer } from "@/components/projects/office-maintenance-drawer"
import { cn } from "@/lib/utils"
import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import { projectNumberReviewDecisionKey, projectNumberReviewIssue } from "@/lib/project-number-review"
import {
  ALL_PROJECT_HUB_STATUSES_FILTER,
  projectHubStatusFilterKey,
  projectHubStatusFilterLabel,
  projectHubStatusFilterOptions,
  projectMatchesHubTabStatus,
  type ProjectHubStatusFilter,
  type ProjectHubStatusFilterOption,
} from "@/lib/project-hub-status-filter"
import { ProjectViewControls } from "@/components/projects/project-view-controls"
import { Input } from "@/components/ui/input"
import { DEFAULT_PROJECT_VIEW, filterProjectView, parseProjectViewDefinition, projectDepartment, type ProjectDepartmentFilter, type SavedProjectView } from "@/lib/project-views"
import { PageHeader } from "@/components/page-header"

type DepartmentFilter = ProjectDepartmentFilter

function isDepartmentCode(value: DepartmentFilter): value is "O" | "H" | "N" | "D" {
  return value === "O" || value === "H" || value === "N" || value === "D"
}
type ProjectPageSize = 5 | 10 | 25 | 50 | "all"

type DepartmentDefinition = {
  readonly id: DepartmentFilter
  readonly label: string
  readonly icon: React.ReactNode
}

const DEPARTMENTS: readonly DepartmentDefinition[] = [
  { id: "ALL", label: "All", icon: <IconBuilding className="size-4" /> },
  // Department tabs show the company's short names (Settings → Company).
  { id: "O", label: "", icon: <IconBuilding className="size-4" /> },
  { id: "H", label: "", icon: <IconBuildingCommunity className="size-4" /> },
  { id: "N", label: "", icon: <IconTool className="size-4" /> },
  { id: "D", label: "", icon: <IconPaint className="size-4" /> },
  // Internal workspaces (the office, the owner's office, yards); named in Settings.
  { id: "INTERNAL", label: "", icon: <IconHome className="size-4" /> },
  { id: "OTHER", label: "Other", icon: <IconSettings className="size-4" /> },
]

const PROJECT_PAGE_SIZES: readonly ProjectPageSize[] = [5, 10, 25, 50, "all"]

function parseProjectPageSize(value: string): ProjectPageSize {
  if (value === "5") return 5
  if (value === "25") return 25
  if (value === "50") return 50
  if (value === "all") return "all"
  return 10
}


function matchesHubStatus(
  project: ProjectListItem,
  status: ProjectHubStatusFilter,
  department: DepartmentFilter,
): boolean {
  return projectMatchesHubTabStatus(project, status, department === "INTERNAL")
}

function StatusFilterItem({
  option,
  selectedKey,
  onSelect,
}: {
  readonly option: ProjectHubStatusFilterOption
  readonly selectedKey: string
  readonly onSelect: (filter: ProjectHubStatusFilter) => void
}): React.ReactElement {
  const selected = option.key === selectedKey
  return (
    <CommandItem
      value={`${option.label} ${option.key}`}
      onSelect={() => onSelect(option.filter)}
    >
      <IconCheck
        className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
      />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {option.count}
      </span>
    </CommandItem>
  )
}

export function ProjectHubLaunchpad({
  savedViews,
  signals,
  canManageProjects,
  canReviewProjectNumbers,
  canUpdateProjectStatus,
  duplicateCandidates,
  approvedProjectNumberReviewKeys,
  intakeAssignees,
  internalDepartmentName,
}: {
  readonly savedViews: { readonly views: readonly SavedProjectView[]; readonly error: string | null }
  /** Job health and field photos per project; streamed after the list renders. */
  readonly signals: Promise<ProjectHubSignals>
  readonly canManageProjects: boolean
  readonly canReviewProjectNumbers: boolean
  readonly canUpdateProjectStatus: boolean
  /** Streamed after the list renders (the registry scan is the slowest load). */
  readonly duplicateCandidates: Promise<readonly ProjectDuplicateCandidate[]>
  /** Streamed after the list renders; number-review flags wait for it. */
  readonly approvedProjectNumberReviewKeys: Promise<readonly string[]>
  readonly intakeAssignees: readonly ProjectIntakeAssignee[]
  /** The company's name for the Internal department (Settings → Company). */
  readonly internalDepartmentName: string
}): React.ReactElement {
  // The dashboard layout already loads this list (same request-cached query)
  // and shares it through ProjectListProvider, so the page does not send it twice.
  const projects = useProjectList()
  const { activeProjectId } = useActiveProject()
  const { defaultDefinition } = useProjectViewPreferences()
  const defaultView = defaultDefinition ?? DEFAULT_PROJECT_VIEW
  const defaultViewJson = JSON.stringify(defaultView)
  const departmentProfiles = useDepartmentProfiles()
  const [currentDuplicateCandidates, setCurrentDuplicateCandidates] = useState<
    readonly ProjectDuplicateCandidate[]
  >([])
  // null until the approved exceptions arrive, so no project is flagged early.
  const [approvedNumberReviewKeys, setApprovedNumberReviewKeys] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    let current = true
    void duplicateCandidates.then((candidates) => {
      if (current) setCurrentDuplicateCandidates(candidates)
    })
    return () => {
      current = false
    }
  }, [duplicateCandidates])
  useEffect(() => {
    let current = true
    void approvedProjectNumberReviewKeys.then((keys) => {
      if (current) setApprovedNumberReviewKeys(new Set(keys))
    })
    return () => {
      current = false
    }
  }, [approvedProjectNumberReviewKeys])
  const duplicateProjectIds = useMemo(
    () =>
      new Set(
        currentDuplicateCandidates.flatMap((candidate) => [
          candidate.first.id,
          candidate.second.id,
        ]),
      ),
    [currentDuplicateCandidates],
  )
  const numberReviewProjectIds = useMemo(
    () =>
      new Set(
        canReviewProjectNumbers && approvedNumberReviewKeys !== null
          ? projects
              .filter((project) => projectNumberReviewIssue(project.projectNumber, project.name) && project.projectNumber && !approvedNumberReviewKeys.has(projectNumberReviewDecisionKey(project.id, project.projectNumber)))
              .map((project) => project.id)
          : [],
      ),
    [approvedNumberReviewKeys, canReviewProjectNumbers, projects],
  )
  const [department, setDepartment] = useState<DepartmentFilter>(defaultView.department)
  const [status, setStatus] = useState<ProjectHubStatusFilter>(
    defaultView.status,
  )
  const [pageIndex, setPageIndex] = useState(0)
  const [search, setSearch] = useState("")
  const searching = search.trim().length > 0
  // Saving/resetting the personal default updates this page and the sidebar together.
  // Depend on its value so unrelated layout refreshes preserve temporary filters.
  useEffect(() => {
    const view = parseProjectViewDefinition(defaultViewJson)
    if (view) {
      setDepartment(view.department)
      setStatus(view.status)
      setPageIndex(0)
    }
  }, [defaultViewJson])
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const [layout, setLayout] = useState<ProjectLayout>("cards")
  const [pageSize, setPageSize] = useState<ProjectPageSize>(10)
  const [duplicateReviewProjectId, setDuplicateReviewProjectId] = useState<
    string | null
  >(null)
  const [numberReviewProjectId, setNumberReviewProjectId] = useState<
    string | null
  >(null)
  const handleDuplicateReviewHandled = useCallback(() => {
    setDuplicateReviewProjectId(null)
  }, [])
  const handleNumberReviewHandled = useCallback(() => {
    setNumberReviewProjectId(null)
  }, [])

  const statusOptions = useMemo(
    () => projectHubStatusFilterOptions(projects),
    [projects],
  )
  const selectedDepartmentLabel = department === "ALL" ? "All departments"
    : isDepartmentCode(department) ? departmentProfiles[department].shortName
    : department === "INTERNAL" ? internalDepartmentName : "Other"
  const selectedStatusKey = projectHubStatusFilterKey(status)
  const selectedStatusOption = statusOptions.find(
    (option) => option.key === selectedStatusKey,
  )
  const statusViewOptions = statusOptions.filter(
    (option) => option.group === "views",
  )
  const jobStatusOptions = statusOptions.filter(
    (option) => option.group === "job-statuses",
  )

  const departmentCounts = useMemo(() => {
    return new Map(
      DEPARTMENTS.map((item) => [
        item.id,
        projects.filter(
          (project) =>
            matchesHubStatus(project, status, item.id) &&
            (item.id === "ALL" || projectDepartment(project) === item.id),
        ).length,
      ])
    )
  }, [projects, status])

  const visibleProjects = useMemo(
    () => filterProjectView(projects, { department, status }, search),
    [department, projects, status, search],
  )

  const pageCount =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(visibleProjects.length / pageSize))
  const currentPageIndex = Math.min(pageIndex, pageCount - 1)
  const firstVisibleProjectIndex =
    visibleProjects.length === 0
      ? 0
      : pageSize === "all"
        ? 1
        : currentPageIndex * pageSize + 1
  const lastVisibleProjectIndex =
    pageSize === "all"
      ? visibleProjects.length
      : Math.min((currentPageIndex + 1) * pageSize, visibleProjects.length)
  const paginatedProjects =
    pageSize === "all"
      ? visibleProjects
      : visibleProjects.slice(
          currentPageIndex * pageSize,
          (currentPageIndex + 1) * pageSize
        )

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-4 lg:p-5">
      <PageHeader
        className="mb-0 border-b pb-4"
        title="Project Hub"
        actions={
          <>
            <div className="flex flex-wrap gap-2">
              {canManageProjects ? (
                <OfficeMaintenanceDrawer projects={projects} />
              ) : null}
              {canManageProjects && department === "INTERNAL" ? (
                <InternalWorkspaceCreateButton departmentName={internalDepartmentName} />
              ) : null}
              {canManageProjects ? (
                <ProjectIntakeDrawer assignees={intakeAssignees} />
              ) : null}
            </div>
          </>
        }
      />

      <ProjectDuplicateManager
        candidates={currentDuplicateCandidates}
        canManageRegistry={canReviewProjectNumbers}
        reviewProjectId={duplicateReviewProjectId}
        onReviewProjectHandled={handleDuplicateReviewHandled}
        onCandidatesScanned={setCurrentDuplicateCandidates}
      />

      {canReviewProjectNumbers && approvedNumberReviewKeys !== null ? (
        <ProjectNumberReviewManager
          projects={projects}
          approvedDecisionKeys={approvedNumberReviewKeys}
          onProjectNumberApproved={(decisionKey) => setApprovedNumberReviewKeys((current) => new Set([...(current ?? []), decisionKey]))}
          reviewProjectId={numberReviewProjectId}
          onReviewProjectHandled={handleNumberReviewHandled}
        />
      ) : null}

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
                aria-pressed={department === item.id}
                data-department-filter={item.id}
                onClick={() => {
                  setDepartment(item.id)
                  setPageIndex(0)
                }}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 bg-background px-3 text-sm font-medium transition-colors hover:bg-muted",
                  department === item.id && "bg-primary/[0.07] text-primary ring-1 ring-inset ring-primary hover:bg-primary/[0.11]"
                )}
              >
                {item.icon}
                {isDepartmentCode(item.id)
                  ? departmentProfiles[item.id].shortName
                  : item.id === "INTERNAL"
                    ? internalDepartmentName
                    : item.label}
                <span className={cn("text-xs tabular-nums text-muted-foreground", department === item.id && "text-primary/80")}>
                  {departmentCounts.get(item.id) ?? 0}
                </span>
              </button>
            ))}
            <div className="min-w-[17rem] flex-1 bg-background">
              <ProjectQuickSwitcher
                applyDefaultView
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
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Popover open={statusFilterOpen} onOpenChange={setStatusFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={statusFilterOpen}
                  aria-label="Filter projects by status"
                  className="h-9 w-full justify-between px-3 font-normal sm:max-w-xs"
                >
                  <span className="min-w-0 truncate">
                    {selectedStatusOption?.label ??
                      projectHubStatusFilterLabel(status)}
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-2 text-muted-foreground">
                    <span className="text-xs tabular-nums">
                      {selectedStatusOption?.count ?? 0}
                    </span>
                    <IconSelector className="size-4" />
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] max-w-[calc(100vw-2rem)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Search statuses..." />
                  <CommandList className="compass-content-scroll max-h-80">
                    <CommandEmpty>No matching statuses.</CommandEmpty>
                    <CommandGroup heading="Lifecycle views">
                      {statusViewOptions.map((option) => (
                        <StatusFilterItem
                          key={option.key}
                          option={option}
                          selectedKey={selectedStatusKey}
                          onSelect={(filter) => {
                            setStatus(filter)
                            setPageIndex(0)
                            setStatusFilterOpen(false)
                          }}
                        />
                      ))}
                    </CommandGroup>
                    {jobStatusOptions.length > 0 ? (
                      <CommandGroup heading="Job statuses">
                        {jobStatusOptions.map((option) => (
                          <StatusFilterItem
                            key={option.key}
                            option={option}
                            selectedKey={selectedStatusKey}
                            onSelect={(filter) => {
                              setStatus(filter)
                              setPageIndex(0)
                              setStatusFilterOpen(false)
                            }}
                          />
                        ))}
                      </CommandGroup>
                    ) : null}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <ProjectViewControls definition={{ department, status }} filterSummary={`${selectedStatusOption?.label ?? projectHubStatusFilterLabel(status)} · ${selectedDepartmentLabel}`} views={savedViews.views} loadError={savedViews.error}
              onApply={(view) => { setDepartment(view.department); setStatus(view.status); setSearch(""); setPageIndex(0) }} />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 space-y-1">
          <Input type="search" value={search} aria-label="Search all projects" placeholder="Search all projects by number, name, or client…"
            onChange={(event) => { setSearch(event.target.value); setPageIndex(0) }} className="max-w-lg" />
          <p className="text-xs text-muted-foreground">{searching ? "Searching all statuses and departments. Clear search to return to your filters." : "Search includes all statuses and departments you can access."}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {searching ? "Search results" : `${selectedStatusOption?.label ?? projectHubStatusFilterLabel(status)} projects`}
            </h2>
            <p className="text-xs text-muted-foreground">
              {visibleProjects.length} project{visibleProjects.length === 1 ? "" : "s"} match · use ⌘K for global search
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
          {paginatedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              signals={signals}
              layout={layout}
              canUpdateProjectStatus={canUpdateProjectStatus}
              isPossibleDuplicate={duplicateProjectIds.has(project.id)}
              needsNumberReview={numberReviewProjectIds.has(project.id)}
              onReviewDuplicate={setDuplicateReviewProjectId}
              onReviewProjectNumber={setNumberReviewProjectId}
            />
          ))}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mt-3 border-y px-4 py-12 text-center">
            <p className="text-sm font-medium">No projects match these filters.</p>
            <button
              type="button"
              onClick={() => {
                setSearch("")
                setDepartment("ALL")
                setStatus(ALL_PROJECT_HUB_STATUSES_FILTER)
                setPageIndex(0)
              }}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {firstVisibleProjectIndex}–{lastVisibleProjectIndex} of{" "}
              {visibleProjects.length} projects
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="projects-per-page" className="text-sm font-medium">
                  Projects per page
                </label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(parseProjectPageSize(value))
                    setPageIndex(0)
                  }}
                >
                  <SelectTrigger id="projects-per-page" size="sm" className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {PROJECT_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size === "all" ? "All" : size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <span className="min-w-24 text-center text-sm font-medium">
                Page {currentPageIndex + 1} of {pageCount}
              </span>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPageIndex(0)}
                  disabled={currentPageIndex === 0}
                >
                  <span className="sr-only">Go to first page</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPageIndex(Math.max(0, currentPageIndex - 1))}
                  disabled={currentPageIndex === 0}
                >
                  <span className="sr-only">Go to previous page</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() =>
                    setPageIndex(Math.min(pageCount - 1, currentPageIndex + 1))
                  }
                  disabled={currentPageIndex >= pageCount - 1}
                >
                  <span className="sr-only">Go to next page</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPageIndex(pageCount - 1)}
                  disabled={currentPageIndex >= pageCount - 1}
                >
                  <span className="sr-only">Go to last page</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          Live Compass project and job-health data
        </span>
        <div className="flex gap-4">
          <Link href="/dashboard" className="font-medium text-primary hover:text-primary/80">
            Dashboard
          </Link>
        </div>
      </footer>
    </main>
  )
}
