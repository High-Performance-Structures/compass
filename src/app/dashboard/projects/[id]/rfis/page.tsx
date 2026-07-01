import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconClock,
  IconMessageQuestion,
} from "@tabler/icons-react"

import {
  getProjectRfis,
  updateProjectRfi,
  type ProjectRfiItem,
} from "@/app/actions/project-rfis"
import {
  getProjectContactsSummary,
  getProjectTaskAssigneeOptions,
} from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
import { ProjectRfiCreateForm } from "@/components/projects/project-rfi-create-form"
import { ProjectRfiDeleteButton } from "@/components/projects/project-rfi-delete-button"
import { ProjectListFilters } from "@/components/projects/project-list-filters"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function cleanFormText(formData: FormData, name: string): string | null {
  const value = readFormText(formData, name).trim()
  return value.length > 0 ? value : null
}

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function isActiveRfiStatus(status: string): boolean {
  return !["complete", "closed", "void", "cancelled"].includes(
    status.toLowerCase()
  )
}

function unique(values: readonly (string | null | undefined)[]): readonly string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b))
}

function rfiTaskTitle(subject: string): string {
  return `Follow up RFI: ${subject}`
}

function paramValue(value: string | readonly string[] | undefined): string {
  if (typeof value === "string") return value
  return value?.[0] ?? ""
}

function matchesText(
  values: readonly (string | null | undefined)[],
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true

  return values.some((value) =>
    (value ?? "").toLowerCase().includes(normalized)
  )
}

function matchesDateRange(value: string | null, from: string, to: string): boolean {
  if (from.length === 0 && to.length === 0) return true
  if (!value) return false
  return (from.length === 0 || value >= from) && (to.length === 0 || value <= to)
}

function matchesRfiFilters(
  rfi: ProjectRfiItem,
  filters: {
    readonly q: string
    readonly status: string
    readonly from: string
    readonly to: string
  }
): boolean {
  const statusMatches =
    filters.status.length === 0 ||
    filters.status === "all" ||
    rfi.status === filters.status

  return (
    statusMatches &&
    matchesDateRange(rfi.dueDate, filters.from, filters.to) &&
    matchesText(
      [
        rfi.rfiNumber,
        rfi.subject,
        rfi.question,
        rfi.answer,
        rfi.requesterName,
        rfi.assignedToName,
        rfi.companyName,
        rfi.priority,
        rfi.audience,
        ...rfi.attachments.map((attachment) => attachment.fileName),
      ],
      filters.q
    )
  )
}

export default async function ProjectRfisPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly created?: string | readonly string[]
    readonly q?: string | readonly string[]
    readonly status?: string | readonly string[]
    readonly from?: string | readonly string[]
    readonly to?: string | readonly string[]
  }>
}) {
  const { id } = await params
  const query = await searchParams
  const createdRfiId = Array.isArray(query.created)
    ? query.created[0] ?? null
    : query.created ?? null
  const filters = {
    q: paramValue(query.q),
    status: paramValue(query.status),
    from: paramValue(query.from),
    to: paramValue(query.to),
  }
  const [projects, rfis, contactsSummary, taskAssigneeOptions] =
    await Promise.all([
      getProjects(),
      getProjectRfis(id),
      getProjectContactsSummary(id, "internal"),
      getProjectTaskAssigneeOptions(id),
    ])
  const project = projects.find((item) => item.id === id)
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const openCount = rfis.filter((rfi) => isActiveRfiStatus(rfi.status)).length
  const filteredRfis = rfis.filter((rfi) => matchesRfiFilters(rfi, filters))
  const contacts = contactsSummary.allContacts
  const companyOrTradeOptions = unique(
    contacts.flatMap((contact) => [
      contact.companyName,
      contact.trade,
      contact.csiDivisionName,
      contact.displayName,
    ])
  )
  const peopleOptions = unique(
    contacts.map((contact) =>
      contact.companyName && contact.companyName !== contact.displayName
        ? `${contact.displayName} - ${contact.companyName}`
        : contact.displayName
    )
  )

  async function updateRfiAction(formData: FormData): Promise<void> {
    "use server"

    const result = await updateProjectRfi(
      id,
      readFormText(formData, "rfiId"),
      {
        answer: cleanFormText(formData, "answer"),
        status: readFormText(formData, "status"),
        audience: readFormText(formData, "audience"),
      }
    )

    if (!result.success) {
      throw new Error(result.error)
    }

    redirect(`/dashboard/projects/${id}/rfis`)
  }

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <IconMessageQuestion className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">RFIs</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} - ` : ""}
            {project?.name ?? "Project"} questions, answers, and visibility.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectQuickSwitcher
            projects={projects}
            currentProjectId={id}
            targetSection="rfis"
            placeholder="Switch RFI project..."
            className="w-full sm:w-[300px]"
          />
          <Badge variant={openCount > 0 ? "secondary" : "outline"}>
            {openCount} open
          </Badge>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">RFI queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Track questions, assignments, due dates, visibility, and responses.
            </p>
          </div>
          <ProjectRfiCreateForm
            projectId={id}
            projectDriveFolderId={project?.googleDriveFolderId ?? null}
            companyOrTradeOptions={companyOrTradeOptions}
            peopleOptions={peopleOptions}
          />
        </div>

        <ProjectListFilters
          baseHref={`/dashboard/projects/${id}/rfis`}
          q={filters.q}
          status={filters.status}
          from={filters.from}
          to={filters.to}
          statusOptions={[
            { value: "all", label: "All statuses" },
            { value: "new", label: "New" },
            { value: "in_progress", label: "In progress" },
            { value: "info_needed", label: "Info needed" },
            { value: "complete", label: "Complete" },
            { value: "void", label: "Void" },
          ]}
          searchPlaceholder="Search RFI number, subject, company, response..."
          resultLabel={`${filteredRfis.length} of ${rfis.length} RFI${
            rfis.length === 1 ? "" : "s"
          } shown`}
        />

        {filteredRfis.length > 0 ? (
          filteredRfis.map((rfi) => {
            const isCreated = rfi.id === createdRfiId
            return (
              <article
                key={rfi.id}
                className={cn(
                  "border-l-2 border-y border-r bg-background px-4 py-3",
                  isCreated
                    ? "border-l-[#3f7d4d] bg-card"
                    : "border-l-[#9d832c]"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {rfi.rfiNumber}
                    </p>
                    <h2 className="mt-1 text-base font-semibold">
                      {rfi.subject}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {isCreated && (
                      <Badge variant="secondary">Just created</Badge>
                    )}
                    <Badge
                      variant={
                        isActiveRfiStatus(rfi.status) ? "secondary" : "outline"
                      }
                    >
                      {label(rfi.status)}
                    </Badge>
                    <Badge variant="outline">{label(rfi.audience)}</Badge>
                    {rfi.priority === "high" && (
                      <Badge variant="destructive">High</Badge>
                    )}
                    <ProjectRfiDeleteButton
                      projectId={id}
                      rfiId={rfi.id}
                      rfiNumber={rfi.rfiNumber}
                      subject={rfi.subject}
                    />
                    <ProjectTaskCreateButton
                      projectId={id}
                      sourceLabel="RFI"
                      sourceRecordId={rfi.id}
                      sourceRecordNumber={rfi.rfiNumber}
                      sourceHref={`/dashboard/projects/${id}/rfis`}
                      defaultTitle={rfiTaskTitle(rfi.subject)}
                      defaultDescription={rfi.question}
                      defaultAssigneeName={rfi.assignedToName}
                      defaultCompanyName={rfi.companyName}
                      defaultDueDate={rfi.dueDate}
                      defaultPriority={rfi.priority}
                      defaultTaskType={
                        rfi.companyName ? "subcontractor_task" : "staff_task"
                      }
                      assigneeOptions={taskAssignees}
                    />
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{rfi.question}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {rfi.companyName && <span>{rfi.companyName}</span>}
                  {rfi.assignedToName && <span>Assigned: {rfi.assignedToName}</span>}
                  <span>Response needed by {formatDate(rfi.dueDate)}</span>
                  {rfi.attachmentCount > 0 && (
                    <span>
                      {rfi.attachmentCount} attachment
                      {rfi.attachmentCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {rfi.attachments.length > 0 && (
                  <div className="mt-3 border-y bg-muted/10 py-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Attachments
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rfi.attachments.map((attachment) =>
                        attachment.storageUrl ? (
                          <a
                            key={attachment.id}
                            href={attachment.storageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="border-l-2 border-l-[#9d832c] bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          >
                            {attachment.fileName}
                          </a>
                        ) : (
                          <span
                            key={attachment.id}
                            className="border-l-2 border-l-muted bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {attachment.fileName}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                <form action={updateRfiAction} className="mt-4 space-y-3">
                  <input type="hidden" name="rfiId" value={rfi.id} />
                  <Textarea
                    name="answer"
                    defaultValue={rfi.answer ?? ""}
                    placeholder="Response, decision, additional question, or next step"
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      name="status"
                      defaultValue={rfi.status}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="new">New</option>
                      <option value="in_progress">In progress</option>
                      <option value="info_needed">Additional information needed</option>
                      <option value="complete">Complete</option>
                      <option value="void">Void</option>
                    </select>
                    <select
                      name="audience"
                      defaultValue={rfi.audience}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="internal">Internal only</option>
                      <option value="sub_vendor">Sub/vendor visible</option>
                      <option value="owner">Owner visible</option>
                      <option value="public">Owner and sub/vendor visible</option>
                    </select>
                    <Button type="submit" variant="outline">
                      <IconCircleCheck className="size-4" />
                      Save
                    </Button>
                  </div>
                </form>
              </article>
            )
          })
        ) : (
          <div className="border border-dashed bg-background p-8 text-center">
            <IconClock className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No RFIs found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clear the filters or create the first clarification for this project.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
