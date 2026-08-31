export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  projectContacts,
  projectExternalLinks,
  projectJobStatuses,
  projectMembers,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { canManageProjectRegistry } from "@/lib/permissions"
import { getProjectAccessRecord } from "@/lib/project-access"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"
import { and, eq } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { MobileProjectSwitcher } from "@/components/mobile-project-switcher"
import {
  getProjectFieldSummary,
  type ProjectFieldSummary,
} from "@/app/actions/project-field"
import {
  getProjectRegistry,
  type ProjectRegistry,
} from "@/app/actions/project-registry"
import {
  getProjectOperationsSummary,
  type ProjectOperationsSummary,
  getProjectSageSyncQueue,
  type ProjectSageSyncQueue,
} from "@/app/actions/project-operations"
import {
  getProjectBudgetSummary,
  type ProjectBudgetSummary,
} from "@/app/actions/project-budget"
import {
  getProjectContactsSummary,
  type ProjectContactsSummary,
} from "@/app/actions/project-contacts"
import {
  getProjectRfiSummary,
  type ProjectRfiSummary,
} from "@/app/actions/project-rfis"
import { ProjectActionsMenu } from "@/components/projects/project-actions-menu"
import { ProjectCommunicationInstructions } from "@/components/projects/project-email-address-card"
import { ProjectWorkspaceShell } from "@/components/projects/project-workspace-shell"
import {
  allowedWorkflowRoleIds,
  defaultWorkflowRoleId,
} from "@/lib/project-workflow-roles"
import type { ScheduleTask } from "@/db/schema"
import {
  projectClientStatusLabel,
  projectJobStatusLabel,
} from "@/lib/project-profile"
import { gotoSenderNumberForProject } from "@/lib/goto/numbers"

function getWeekDays(): { date: Date; dayName: string }[] {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push({
      date: d,
      dayName: d.toLocaleDateString("en-US", { weekday: "long" }),
    })
  }
  return days
}

function formatDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function isTaskOnDate(task: ScheduleTask, dateStr: string): boolean {
  return task.startDate <= dateStr && task.endDateCalculated >= dateStr
}

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function normalizeContactIdentity(value: string | null): string {
  return value
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : ""
}

async function loadOptionalSummary<T>(
  label: string,
  load: () => Promise<T>
): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    console.warn(`[project-summary] ${label} unavailable`, error)
    return null
  }
}

export default async function ProjectSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)

  let project: {
    id: string
    projectNumber: string | null
    name: string
    status: string
    clientStatus: string
    jobStatusId: string
    jobStatusLabel: string
    address: string | null
    clientName: string | null
    projectManager: string | null
    googleDriveFolderId: string | null
    createdAt: string
  } | null = null
  let tasks: ScheduleTask[] = []
  let registry: ProjectRegistry | null = null
  let fieldSummary: ProjectFieldSummary | null = null
  let budgetSummary: ProjectBudgetSummary | null = null
  let contactsSummary: ProjectContactsSummary | null = null
  let operationsSummary: ProjectOperationsSummary | null = null
  let sageSyncQueue: ProjectSageSyncQueue | null = null
  let rfiSummary: ProjectRfiSummary | null = null
  let canEditRegistry = false
  let developerModeEnabled = false
  let userRole: string | null = null
  let projectRole: string | null = null
  let projectTextPhoneNumber: string | null = null

  try {
    const currentUser = await getCurrentUser()
    canEditRegistry = canManageProjectRegistry(currentUser)
    developerModeEnabled = await isDeveloperModeEnabled(canEditRegistry)
    userRole = currentUser?.role ?? null

    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("D1 not available")

    const db = getDb(env.DB)
    if (!currentUser || !(await getProjectAccessRecord(db, currentUser, id))) {
      notFound()
    }
    const routeMembership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.userId, currentUser.id),
        ),
      )
      .get()
    projectRole = routeMembership?.role ?? null
    if (projectRole === "client" || projectRole === "owner") {
      redirect(projectAudiencePreviewHref(id, "owner"))
    }
    if (
      projectRole === "subcontractor" ||
      projectRole === "supplier"
    ) {
      redirect(projectAudiencePreviewHref(id, "sub-vendor"))
    }

    const [foundRow] = await db
      .select({
        project: projects,
        customJobStatusLabel: projectJobStatuses.label,
      })
      .from(projects)
      .leftJoin(
        projectJobStatuses,
        and(
          eq(projectJobStatuses.id, projects.jobStatusId),
          eq(projectJobStatuses.organizationId, projects.organizationId),
        ),
      )
      .where(eq(projects.id, id))
      .limit(1)

    const found = foundRow?.project
    if (!found) notFound()
    const jobStatusLabel = projectJobStatusLabel({
      jobStatusId: found.jobStatusId,
      customLabel: foundRow.customJobStatusLabel,
    })
    projectTextPhoneNumber = gotoSenderNumberForProject(
      env,
      found.projectNumber
    )

    if (found.googleDriveFolderId) {
      project = { ...found, jobStatusLabel }
    } else {
      const [driveLink] = await db
        .select({
          externalId: projectExternalLinks.externalId,
          externalUrl: projectExternalLinks.externalUrl,
        })
        .from(projectExternalLinks)
        .where(
          and(
            eq(projectExternalLinks.projectId, id),
            eq(projectExternalLinks.system, "google_drive"),
          ),
        )
        .limit(1)

      project = {
        ...found,
        jobStatusLabel,
        googleDriveFolderId:
          driveLink?.externalId ??
          driveFolderIdFromUrl(driveLink?.externalUrl ?? null),
      }
    }

    tasks = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, id))
    if (currentUser) {
      if (!projectRole) {
        const internalContacts = await db
          .select({
            displayName: projectContacts.displayName,
            email: projectContacts.email,
            role: projectContacts.role,
          })
          .from(projectContacts)
          .where(
            and(
              eq(projectContacts.projectId, id),
              eq(projectContacts.contactType, "internal"),
              eq(projectContacts.active, true),
            ),
          )

        const fullName =
          `${currentUser.firstName ?? ""} ${currentUser.lastName ?? ""}`.trim()
        const emailName = currentUser.email.includes("@")
          ? currentUser.email.split("@")[0].replaceAll(".", " ")
          : currentUser.email
        const identityCandidates = [
          currentUser.displayName,
          fullName,
          emailName,
        ]
          .map((candidate) => normalizeContactIdentity(candidate))
          .filter((candidate) => candidate.length > 0)
        const userIdentityMatches = new Set(identityCandidates)
        const emailCandidates = [currentUser.email, currentUser.googleEmail]
          .filter((candidate): candidate is string => {
            return typeof candidate === "string" && candidate.trim().length > 0
          })
          .map((candidate) => candidate.trim().toLowerCase())
        const userEmailMatches = new Set(emailCandidates)

        for (const contact of internalContacts) {
          const contactEmail = contact.email
            ? contact.email.trim().toLowerCase()
            : ""
          const contactName = normalizeContactIdentity(contact.displayName)
          const matchesEmail =
            contactEmail.length > 0 && userEmailMatches.has(contactEmail)
          const matchesName =
            contactName.length > 0 && userIdentityMatches.has(contactName)

          if (contact.role && (matchesEmail || matchesName)) {
            projectRole = contact.role
            break
          }
        }
      }
    }
    // These panels are independent. Resolve them concurrently so a project
    // page pays for the slowest summary instead of the sum of every D1 roundtrip.
    const [
      loadedRegistry,
      loadedSageSyncQueue,
      loadedFieldSummary,
      loadedBudgetSummary,
      loadedContactsSummary,
      loadedOperationsSummary,
      loadedRfiSummary,
    ] = await Promise.all([
      developerModeEnabled
        ? loadOptionalSummary("registry", () => getProjectRegistry(id))
        : Promise.resolve(null),
      developerModeEnabled
        ? loadOptionalSummary("Sage sync queue", () => getProjectSageSyncQueue(id))
        : Promise.resolve(null),
      loadOptionalSummary("field summary", () => getProjectFieldSummary(id)),
      loadOptionalSummary("budget summary", () =>
        getProjectBudgetSummary(id, "internal")
      ),
      loadOptionalSummary("contacts summary", () =>
        getProjectContactsSummary(id, "internal")
      ),
      loadOptionalSummary("operations summary", () =>
        getProjectOperationsSummary(id)
      ),
      loadOptionalSummary("RFI summary", () => getProjectRfiSummary(id)),
    ])
    registry = loadedRegistry
    sageSyncQueue = loadedSageSyncQueue
    fieldSummary = loadedFieldSummary
    budgetSummary = loadedBudgetSummary
    contactsSummary = loadedContactsSummary
    operationsSummary = loadedOperationsSummary
    rfiSummary = loadedRfiSummary
  } catch (error) {
    if (
      hasDigest(error) &&
      (error.digest === "NEXT_NOT_FOUND" ||
        error.digest.startsWith("NEXT_REDIRECT"))
    ) {
      throw error
    }
    console.warn("D1 unavailable in dev mode, using empty data")
  }

  const projectName = project?.name ?? "Project"
  const projectJobStatus = project?.jobStatusLabel ?? "Unknown job status"
  const clientStatus = project
    ? projectClientStatusLabel(project.clientStatus)
    : "Unknown client status"
  const initialWorkflowRoleId = defaultWorkflowRoleId({
    projectRole,
    userRole,
    canUseDeveloperMode: canEditRegistry,
  })
  const allowedRoleIds = allowedWorkflowRoleIds({
    projectRole,
    userRole,
    canUseDeveloperMode: canEditRegistry,
  })
  const safeInitialWorkflowRoleId = allowedRoleIds.includes(initialWorkflowRoleId)
    ? initialWorkflowRoleId
    : (allowedRoleIds[0] ?? initialWorkflowRoleId)
  const todayStr = formatDateStr(new Date())

  const completedTasks = tasks.filter((t) => t.status === "COMPLETE")
  const activeTasks = tasks.filter((t) => t.status !== "COMPLETE")
  const totalCount = tasks.length
  const completedPercent =
    totalCount > 0 ? Math.round((completedTasks.length / totalCount) * 100) : 0

  const pastDue = activeTasks.filter((t) => t.endDateCalculated < todayStr)
  const dueToday = activeTasks.filter((t) => t.endDateCalculated === todayStr)
  const upcomingMilestones = tasks.filter(
    (t) => t.isMilestone && t.startDate >= todayStr && t.status !== "COMPLETE",
  )

  // week agenda
  const weekDays = getWeekDays()
  const weekAgenda = weekDays.map((day) => {
    const dateStr = formatDateStr(day.date)
    const dayTasks = tasks.filter((t) => isTaskOnDate(t, dateStr))
    const isToday = dateStr === todayStr
    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6
    return { ...day, dateStr, dayTasks, isToday, isWeekend }
  })

  return (
    <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
      <div className="flex-1 p-4 md:p-6 lg:overflow-y-auto">
        {/* header */}
        <div className="flex items-start justify-between mb-1">
          <MobileProjectSwitcher
            projectName={projectName}
            projectNumber={project?.projectNumber}
            projectId={id}
            jobStatus={projectJobStatus}
            clientStatus={clientStatus}
          />
          <ProjectActionsMenu
            projectId={id}
            projectDriveFolderId={project?.googleDriveFolderId ?? null}
          />
        </div>

        {/* meta line: address + tasks */}
        <div className="text-sm text-muted-foreground space-y-0.5 mb-3">
          {project?.address && <p>{project.address}</p>}
          <p>
            {totalCount} tasks &middot; {completedPercent}% complete
            {project?.clientName && <> &middot; {project.clientName}</>}
            {project?.projectManager && <> &middot; {project.projectManager}</>}
          </p>
        </div>

        {projectTextPhoneNumber && (
          <div className="mb-4 sm:mb-5">
            <ProjectCommunicationInstructions
              projectId={id}
              projectNumber={project?.projectNumber ?? null}
              textPhoneNumber={projectTextPhoneNumber}
              compact
            />
          </div>
        )}

        <div className="mb-4 sm:mb-5">
          <Link
            href={`/dashboard/projects/${id}/information`}
            className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Project Information & Follow-up
          </Link>
        </div>

        <section className="mb-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3 sm:mb-5 lg:grid-cols-4">
          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="group min-w-0 transition-colors hover:text-primary"
          >
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-semibold tabular-nums">
                {completedPercent}%
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground group-hover:text-primary/70">
                Progress
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {completedTasks.length} complete{" "}
              <span aria-hidden="true">&middot;</span>{" "}
              {activeTasks.length} active
            </p>
          </Link>

          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="group min-w-0 transition-colors hover:text-primary"
          >
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-semibold tabular-nums">
                {pastDue.length}
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground group-hover:text-primary/70">
                Past due
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {pastDue[0]?.title ?? "Nothing past due"}
            </p>
          </Link>

          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="group min-w-0 transition-colors hover:text-primary"
          >
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-semibold tabular-nums">
                {dueToday.length}
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground group-hover:text-primary/70">
                Due today
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {dueToday[0]?.title ?? "No schedule items due today"}
            </p>
          </Link>

          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="group min-w-0 transition-colors hover:text-primary"
          >
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-semibold tabular-nums">
                {upcomingMilestones.length}
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground group-hover:text-primary/70">
                Milestones
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {upcomingMilestones[0]?.title ?? "No upcoming milestones"}
            </p>
          </Link>
        </section>

        <div className="mb-4 sm:mb-6">
          <ProjectWorkspaceShell
            projectId={id}
            totalTaskCount={totalCount}
            pastDueCount={pastDue.length}
            operationsSummary={operationsSummary}
            contactsSummary={contactsSummary}
            fieldSummary={fieldSummary}
            budgetSummary={budgetSummary}
            rfiSummary={rfiSummary}
            registry={registry}
            sageSyncQueue={sageSyncQueue}
            canEditRegistry={canEditRegistry}
            initialRoleId={safeInitialWorkflowRoleId}
            allowedRoleIds={allowedRoleIds}
          />
        </div>
      </div>

      {/* right sidebar: week agenda */}
      <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l p-3 sm:p-4 shrink-0 lg:overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">
            This Week
          </h2>
          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="text-xs text-primary hover:underline"
          >
            View schedule
          </Link>
        </div>
        <div className="space-y-1">
          {weekAgenda.map((day) => (
            <div
              key={day.dateStr}
              className={`flex gap-3 rounded-md p-2 ${
                day.isToday ? "bg-accent" : ""
              }`}
            >
              <div className="text-center shrink-0 w-10">
                <p
                  className={`text-lg font-semibold leading-none ${
                    day.isToday ? "text-primary" : ""
                  }`}
                >
                  {day.date.getDate()}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{day.dayName}</p>
                {day.isWeekend ? (
                  <p className="text-xs text-muted-foreground">Non-workday</p>
                ) : day.dayTasks.length > 0 ? (
                  <div className="space-y-0.5">
                    {day.dayTasks.slice(0, 3).map((t) => (
                      <p
                        key={t.id}
                        className="text-xs text-muted-foreground truncate"
                      >
                        {t.title}
                      </p>
                    ))}
                    {day.dayTasks.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{day.dayTasks.length - 3} more
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No tasks</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div id={`project-workspace-controls-${id}`} />
      </div>
    </div>
  )
}
