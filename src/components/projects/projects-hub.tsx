"use client"

// The Projects page (/dashboard/projects): department buttons, search and
// status filters, the project lanes, and the create/edit project registry form.
// Its parts live next to it in projects-hub-*.ts(x): the model (pure data and
// helpers), departments, project card, department lane, department landing and
// registry fields.

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SearchableComboboxField } from "@/components/searchable-combobox"
import {
  IconArrowLeft,
  IconBrandGoogleDrive,
  IconCompass,
  IconFolder,
  IconPlus,
  IconSearch,
  IconSettingsAutomation,
  IconSparkles,
} from "@tabler/icons-react"
import type { ProjectsHubProject } from "@/app/dashboard/projects/page"
import { createProjectShell } from "@/app/actions/projects"
import { updateProjectRegistry } from "@/app/actions/project-registry"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { PROJECT_JOB_STATUS_DEFINITIONS, projectClientStatusLabel } from "@/lib/project-profile"
import { SAGE_CLIENT_STATUS_OPTIONS, SAGE_JOB_TYPE_OPTIONS } from "@/lib/sage/client-project-write"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { PageHeader } from "@/components/page-header"
import {
  ProjectBulkStatusBar,
  ProjectSelectionProvider,
} from "@/components/projects/project-bulk-selection"
import {
  type DepartmentId,
  type ProjectStatusBucket,
  type DepartmentGroup,
  STATUS_FILTERS,
  PROJECT_STATUS_OPTIONS,
  normalizeSearchValue,
  departmentIdForProject,
  projectLabel,
  projectSubtitle,
  statusBucket,
  projectStatusValue,
  statusFilterLabel,
  projectMatchesSearch,
} from "./projects-hub-model"
import { departmentConfigs, DepartmentButton } from "./projects-hub-departments"
import { RegistryTextField, RegistrySelectField } from "./projects-hub-registry-fields"
import { DepartmentLane } from "./projects-hub-department-lane"
import { DepartmentLanding } from "./projects-hub-department-landing"

export function ProjectsHub({
  projects,
  canCreateOrUpdateProjects,
}: {
  readonly projects: readonly ProjectsHubProject[]
  readonly canCreateOrUpdateProjects: boolean
}): React.ReactElement {
  const departmentProfiles = useDepartmentProfiles()
  const departments = React.useMemo(() => departmentConfigs(departmentProfiles), [departmentProfiles])
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState("")
  const [isCreatingProject, startCreateProjectTransition] =
    React.useTransition()
  const [isSavingRegistry, startSaveRegistryTransition] = React.useTransition()
  const [showCreateProject, setShowCreateProject] = React.useState(false)
  const [newProjectDepartment, setNewProjectDepartment] =
    React.useState<DepartmentId>("O")
  const [registryProjectQuery, setRegistryProjectQuery] = React.useState("")
  const [selectedRegistryProjectId, setSelectedRegistryProjectId] =
    React.useState<string | null>(null)
  const [createProjectMessage, setCreateProjectMessage] =
    React.useState<string | null>(null)
  const [shellDuplicateConfirmation, setShellDuplicateConfirmation] =
    React.useState<{
      readonly draftKey: string
      readonly projectIds: readonly string[]
    } | null>(null)
  const [registryMessage, setRegistryMessage] = React.useState<string | null>(
    null
  )
  const { developerModeEnabled } = useDeveloperMode()
  const [activeDepartment, setActiveDepartment] = React.useState<
    DepartmentId | "ALL"
  >("ALL")
  const [activeStatusFilters, setActiveStatusFilters] = React.useState<
    readonly ProjectStatusBucket[]
  >(["active"])

  React.useEffect(() => {
    const departmentParam = searchParams.get("department")
    const statusParam = searchParams.get("status")

    if (
      departmentParam === "O" ||
      departmentParam === "H" ||
      departmentParam === "N" ||
      departmentParam === "D" ||
      departmentParam === "UNASSIGNED"
    ) {
      setActiveDepartment(departmentParam)
    } else {
      setActiveDepartment("ALL")
    }

    if (statusParam === "all") {
      setActiveStatusFilters(STATUS_FILTERS.map((filter) => filter.id))
    } else if (statusParam) {
      const requestedFilters = statusParam
        .split(",")
        .filter((value): value is ProjectStatusBucket => {
          return (
            value === "active" ||
            value === "warranty" ||
            value === "complete" ||
            value === "inactive" ||
            value === "archive" ||
            value === "other"
          )
        })
      if (requestedFilters.length > 0) {
        setActiveStatusFilters(Array.from(new Set(requestedFilters)))
      }
    } else {
      setActiveStatusFilters(["active"])
    }
  }, [searchParams])

  function selectStatusFilter(status: ProjectStatusBucket): void {
    setActiveStatusFilters([status])
  }

  function selectDepartment(department: DepartmentId | "ALL"): void {
    setActiveDepartment(department)
    const params = new URLSearchParams(searchParams.toString())
    if (department === "ALL") {
      params.delete("department")
    } else {
      params.set("department", department)
    }

    const nextUrl = params.toString()
      ? `/dashboard/projects?${params.toString()}`
      : "/dashboard/projects"
    router.replace(nextUrl, { scroll: false })
  }

  function createProjectFromForm(
    event: React.FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const clientName = String(formData.get("clientName") ?? "").trim()
    const address = String(formData.get("address") ?? "").trim()
    const sageClientStatus = SAGE_CLIENT_STATUS_OPTIONS.find(
      (option) => String(option.id) === String(formData.get("sageClientStatusId") ?? "")
    )
    const sageJobStatusId = String(formData.get("sageJobStatusId") ?? "").trim()
    const sageJobType = SAGE_JOB_TYPE_OPTIONS.find(
      (option) => option.id === String(formData.get("sageJobType") ?? "")
    )

    if (!sageClientStatus || !sageJobStatusId || !sageJobType) {
      setCreateProjectMessage(
        "Choose the Sage client status, job status, and job type."
      )
      return
    }

    const draftKey = JSON.stringify({
      name,
      clientName,
      address,
      department: newProjectDepartment,
      sageClientStatusId: sageClientStatus.id,
      sageJobStatusId,
      sageJobType: sageJobType.id,
    })

    setCreateProjectMessage(null)
    startCreateProjectTransition(async () => {
      const result = await createProjectShell({
        projectNumber: null,
        name,
        department: newProjectDepartment,
        clientName: clientName.length > 0 ? clientName : null,
        address: address.length > 0 ? address : null,
        status: "OPEN",
        sageClientStatusId: sageClientStatus.id,
        sageJobStatusId,
        sageJobType: sageJobType.id,
        confirmedDistinctProjectIds:
          shellDuplicateConfirmation?.draftKey === draftKey
            ? shellDuplicateConfirmation.projectIds
            : [],
      })

      if (!result.success) {
        if ("duplicateWarning" in result) {
          const projectIds = result.candidates.map((candidate) =>
            candidate.second.id,
          )
          setShellDuplicateConfirmation({ draftKey, projectIds })
          setCreateProjectMessage(
            `Possible duplicate found: ${result.candidates
              .map((candidate) => {
                const project = candidate.second
                return project.projectNumber ?? project.name
              })
              .join(", ")}. Submit Create Shell again to confirm this is a separate project.`,
          )
          return
        }
        setCreateProjectMessage(result.error)
        return
      }

      form.reset()
      setShellDuplicateConfirmation(null)
      setCreateProjectMessage("Project shell created; Sage write queued.")
      router.push(`/dashboard/projects/${result.id}`)
      router.refresh()
    })
  }

  function updateRegistryFromForm(
    event: React.FormEvent<HTMLFormElement>
  ): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const selectedProjectId = selectedRegistryProjectId

    if (!selectedProjectId) return

    setRegistryMessage(null)
    startSaveRegistryTransition(async () => {
      const result = await updateProjectRegistry(selectedProjectId, formData)
      if (!result.success) {
        setRegistryMessage(result.error)
        return
      }

      setRegistryMessage("Project registry updated.")
      router.refresh()
    })
  }

  const normalizedQuery = normalizeSearchValue(query)
  const normalizedRegistryProjectQuery = normalizeSearchValue(registryProjectQuery)
  const showRegistryTools = canCreateOrUpdateProjects && developerModeEnabled
  const registryProjectMatches = normalizedRegistryProjectQuery
    ? projects
        .filter((project) =>
          projectMatchesSearch(project, normalizedRegistryProjectQuery)
        )
        .slice(0, 6)
    : []
  const selectedRegistryProject = selectedRegistryProjectId
    ? projects.find((project) => project.id === selectedRegistryProjectId) ?? null
    : null
  const statusFilteredProjects = projects.filter((project) =>
    activeStatusFilters.includes(statusBucket(project))
  )
  const searchedProjects = statusFilteredProjects.filter((project) =>
    projectMatchesSearch(project, normalizedQuery)
  )
  const groups: readonly DepartmentGroup[] = departments.map((department) => ({
    ...department,
    allProjects: projects.filter(
      (project) => departmentIdForProject(project) === department.id
    ),
    projects: searchedProjects.filter(
      (project) => departmentIdForProject(project) === department.id
    ),
  }))
  const visibleGroups =
    activeDepartment === "ALL"
      ? groups.filter(
          (group) => group.projects.length > 0 || group.id !== "UNASSIGNED"
        )
      : groups.filter((group) => group.id === activeDepartment)
  const activeProjects = projects.filter(
    (project) => statusBucket(project) === "active"
  )
  const warrantyProjects = projects.filter(
    (project) => statusBucket(project) === "warranty"
  )
  const completeProjects = projects.filter(
    (project) => statusBucket(project) === "complete"
  )
  const linkedToSageCount = projects.filter((project) =>
    Boolean(project.sageJobNumber)
  ).length
  const linkedToDriveCount = projects.filter((project) =>
    Boolean(project.googleDriveFolderId)
  ).length
  const selectedDepartmentGroup =
    activeDepartment === "ALL"
      ? null
      : groups.find((group) => group.id === activeDepartment) ?? null

  return (
    <ProjectSelectionProvider enabled={canCreateOrUpdateProjects}>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b bg-background">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <PageHeader
            className="mb-0 min-w-0"
            icon={<IconCompass className="size-5 text-primary" />}
            title="Project hub"
          />

          <div className="clarity-panel grid grid-cols-3 divide-x text-center">
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="mt-1 text-xl font-semibold">
                {activeProjects.length}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Warranty</p>
              <p className="mt-1 text-xl font-semibold">
                {warrantyProjects.length}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Complete</p>
              <p className="mt-1 text-xl font-semibold">
                {completeProjects.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                selectedDepartmentGroup
                  ? `Search ${selectedDepartmentGroup.shortLabel} projects...`
                  : "Search by project number, client, job status, address, or accounting job..."
              }
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={activeDepartment === "ALL" ? "default" : "outline"}
              size="sm"
              onClick={() => selectDepartment("ALL")}
            >
              All departments
            </Button>
            {canCreateOrUpdateProjects && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/files">
                  <IconSettingsAutomation className="size-4" />
                  Google setup files
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="clarity-panel flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
              Status view
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing {searchedProjects.length} of {projects.length} projects in{" "}
              {statusFilterLabel(activeStatusFilters)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                variant={
                  activeStatusFilters.includes(filter.id)
                    ? "default"
                    : "outline"
                }
                size="sm"
                title={filter.description}
                onClick={() => selectStatusFilter(filter.id)}
              >
                {filter.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={
                activeStatusFilters.length === STATUS_FILTERS.length
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              onClick={() =>
                setActiveStatusFilters(STATUS_FILTERS.map((filter) => filter.id))
              }
            >
              All statuses
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/20 px-4 py-2 text-sm">
          <span>
            <span className="font-semibold tabular-nums">{linkedToSageCount}</span>{" "}
            <span className="text-muted-foreground">accounting linked</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">{linkedToDriveCount}</span>{" "}
            <span className="text-muted-foreground">Drive linked</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">
              {
                projects.filter((project) => statusBucket(project) === "other")
                  .length
              }
            </span>{" "}
            <span className="text-muted-foreground">need status cleanup</span>
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {groups
            .filter((group) => group.id !== "UNASSIGNED")
            .map((group) => (
              <DepartmentButton
                key={group.id}
                group={group}
                active={activeDepartment === group.id}
                onClick={() => selectDepartment(group.id)}
              />
            ))}
        </div>

        {canCreateOrUpdateProjects && (
          <section className="clarity-panel-strong overflow-hidden">
            <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Create or Update an Existing Project
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  New projects start from the Projects page: Compass assigns the
                  department number, creates the Drive folder from the
                  department template, and stages Sage review.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" asChild>
                  <Link href="/dashboard/projects">
                    <IconPlus className="size-4" />
                    New project
                  </Link>
                </Button>
                {showRegistryTools && (
                  <>
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/dashboard/files">
                        <IconBrandGoogleDrive className="size-4" />
                        Drive files
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setShowCreateProject((open) => !open)
                        setNewProjectDepartment("O")
                      }}
                    >
                      <IconPlus className="size-4" />
                      Create project
                    </Button>
                  </>
                )}
              </div>
            </div>
            {showRegistryTools && (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              {showCreateProject && (
                <form
                  className="rounded-md border bg-card p-3"
                  onSubmit={createProjectFromForm}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Create new project</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This only creates a Compass shell. Use New project
                      when the job also needs official numbering, a Drive
                      folder, and Sage review.
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {departments.filter((department) => department.id !== "UNASSIGNED").map(
                      (department) => (
                        <Button
                          key={department.id}
                          type="button"
                          size="sm"
                          variant={
                            newProjectDepartment === department.id
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setNewProjectDepartment(department.id)}
                        >
                          {department.shortLabel}
                        </Button>
                      )
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <Input
                      name="name"
                      placeholder="Project name"
                      aria-label="Project name"
                      required
                    />
                    <Input
                      name="clientName"
                      placeholder="Client"
                      aria-label="Client"
                      required
                    />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <Select name="sageClientStatusId" required>
                      <SelectTrigger aria-label="Sage client status">
                        <SelectValue placeholder="Client status" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAGE_CLIENT_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={String(option.id)}>
                            {option.id} — {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SearchableComboboxField
                      name="sageJobStatusId"
                      required
                      options={PROJECT_JOB_STATUS_DEFINITIONS.map((option) => ({
                        value: option.id,
                        label: option.label,
                      }))}
                      ariaLabel="Sage job status"
                      placeholder="Job status"
                      searchPlaceholder="Search job statuses..."
                      emptyMessage="No matching job statuses."
                    />
                    <Select name="sageJobType" required>
                      <SelectTrigger aria-label="Sage job type">
                        <SelectValue placeholder="Job type" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAGE_JOB_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <Input
                      name="address"
                      placeholder="Address"
                      aria-label="Address"
                    />
                    <Button type="submit" disabled={isCreatingProject}>
                      {isCreatingProject ? "Creating..." : "Create Shell"}
                    </Button>
                  </div>
                  {createProjectMessage && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {createProjectMessage}
                    </p>
                  )}
                </form>
              )}

              <div className="rounded-md border bg-card p-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    Update Compass registry
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search for a Compass job, then paste or confirm its
                    project number, Drive folder, and accounting IDs.
                  </p>
                </div>
                <div className="relative mt-3">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={registryProjectQuery}
                    onChange={(event) => setRegistryProjectQuery(event.target.value)}
                    placeholder="Find project to update..."
                    aria-label="Find project to update"
                    className="pl-9"
                  />
                </div>
                <div className="mt-3 divide-y rounded-md border">
                  {registryProjectMatches.length > 0 ? (
                    registryProjectMatches.map((project) => (
                      <div
                        key={project.id}
                        className={cn(
                          "flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/65",
                          selectedRegistryProjectId === project.id &&
                            "bg-muted/70"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRegistryProjectId(project.id)
                            setRegistryMessage(null)
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-medium">
                            {projectLabel(project)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {projectSubtitle(project) || project.jobStatusLabel}
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {project.jobStatusLabel}
                          </span>
                          <span className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {projectClientStatusLabel(project.clientStatus)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      {normalizedRegistryProjectQuery
                        ? "No projects match that search."
                        : "Start typing to find a project."}
                    </p>
                  )}
                </div>
                {selectedRegistryProject && (
                  <form
                    key={selectedRegistryProject.id}
                    className="mt-4 border-t pt-4"
                    onSubmit={updateRegistryFromForm}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">
                          Compass registry for {projectLabel(selectedRegistryProject)}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          These fields record the project number, Drive folder,
                          and handoff IDs from Compass intake or from
                          Sage/Buildertrend.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/dashboard/projects/${selectedRegistryProject.id}`}
                          >
                            Open project
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <RegistryTextField
                        label="Project number"
                        name="projectNumber"
                        value={selectedRegistryProject.projectNumber}
                        placeholder="O-### or H-###"
                      />
                      <RegistrySelectField
                        label="Legacy status"
                        name="status"
                        value={projectStatusValue(selectedRegistryProject.status)}
                        options={PROJECT_STATUS_OPTIONS}
                      />
                      <RegistryTextField
                        label="Sage job number"
                        name="sageJobNumber"
                        value={selectedRegistryProject.sageJobNumber}
                        placeholder="722"
                      />
                      <RegistryTextField
                        label="Sage internal ID"
                        name="sageJobId"
                        value={selectedRegistryProject.sageJobId}
                      />
                      <RegistryTextField
                        label="Google Drive folder"
                        drive="folder"
                        name="googleDriveFolderId"
                        value={selectedRegistryProject.googleDriveFolderId}
                      />
                      <RegistryTextField
                        label="Buildertrend project ID"
                        name="buildertrendProjectId"
                        value={selectedRegistryProject.buildertrendProjectId}
                      />
                      <RegistryTextField
                        label="Schedule sheet"
                        drive="file"
                        name="googleScheduleSheetId"
                        value={selectedRegistryProject.googleScheduleSheetId}
                      />
                      <RegistryTextField
                        label="Daily log sheet"
                        drive="file"
                        name="googleDailyLogSheetId"
                        value={selectedRegistryProject.googleDailyLogSheetId}
                      />
                      <RegistryTextField
                        label="Google calendar ID"
                        name="googleCalendarId"
                        value={selectedRegistryProject.googleCalendarId}
                      />
                      <RegistryTextField
                        label="Telegram intake chat ID"
                        name="telegramChatId"
                        value={selectedRegistryProject.telegramChatId}
                      />
                      <RegistrySelectField
                        label="Owner update channel"
                        name="ownerUpdateChannel"
                        value={selectedRegistryProject.ownerUpdateChannel}
                        options={[
                          { value: "compass", label: "Compass" },
                          { value: "telegram", label: "Telegram" },
                          { value: "email", label: "Email" },
                        ]}
                      />
                      <RegistrySelectField
                        label="Owner update cadence"
                        name="ownerUpdateCadence"
                        value={selectedRegistryProject.ownerUpdateCadence}
                        options={[
                          { value: "weekly", label: "Weekly" },
                          { value: "daily", label: "Daily" },
                          { value: "milestone", label: "Milestone" },
                        ]}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          name="ownerUpdatesEnabled"
                          defaultChecked={
                            selectedRegistryProject.ownerUpdatesEnabled
                          }
                          className="size-4 rounded border-input"
                        />
                        Owner updates enabled
                      </label>
                      <div className="flex items-center gap-3">
                        {registryMessage && (
                          <p className="text-sm text-muted-foreground">
                            {registryMessage}
                          </p>
                        )}
                        <Button type="submit" disabled={isSavingRegistry}>
                          {isSavingRegistry ? "Saving..." : "Save Registry"}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </div>
            )}
          </section>
        )}

        {selectedDepartmentGroup && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => selectDepartment("ALL")}
          >
            <IconArrowLeft className="size-4" />
            Department overview
          </Button>
        )}

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconFolder className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No projects match this view yet.
            </p>
          </div>
        ) : selectedDepartmentGroup ? (
          <DepartmentLanding
            group={selectedDepartmentGroup}
            canOpenTools={canCreateOrUpdateProjects}
          />
        ) : normalizedQuery && visibleGroups.length > 0 ? (
          <section className="grid gap-4">
            <div className="clarity-section-header flex items-center gap-2 px-4 py-3">
              <IconSearch className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Search results</h2>
            </div>
            {visibleGroups.map((group) => (
              <DepartmentLane
                key={group.id}
                group={group}
                activeDepartment={activeDepartment}
              />
            ))}
          </section>
        ) : activeDepartment === "ALL" ? (
          <div className="rounded-lg border border-dashed bg-muted/10 p-8 text-center">
            <IconSparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">Choose a department to start.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The logo cards above open the department work hubs.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <IconSearch className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No projects match that search.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a project number, client name, address, or Sage job number.
            </p>
          </div>
        )}
        <ProjectBulkStatusBar />
      </div>
    </div>
    </ProjectSelectionProvider>
  )
}
