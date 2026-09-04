import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import {
  IconArrowLeft,
  IconClock,
  IconMessageQuestion,
} from "@tabler/icons-react"

import {
  getProjectRfiInboundEmails,
  getProjectRfis,
} from "@/app/actions/project-rfis"
import {
  getProjectContactsSummary,
  getProjectTaskAssigneeOptions,
} from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
import { ProjectRfiCreateForm } from "@/components/projects/project-rfi-create-form"
import { ProjectRfiCommunicationActions } from "@/components/projects/project-rfi-communication-actions"
import { ProjectRfiDeleteButton } from "@/components/projects/project-rfi-delete-button"
import { ProjectRfiEmailSyncButton } from "@/components/projects/project-rfi-email-sync-button"
import { ProjectRfiResponseComposer } from "@/components/projects/project-rfi-response-composer"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  canonicalRfiStatus,
  compareRfisForQueue,
  isClosedRfiStatus,
  parseRfiStatusFilter,
  rfiMatchesStatusFilter,
  type RfiStatusFilter,
} from "@/lib/rfis/status"
import { buildProjectEmailRecipientOptions } from "@/lib/email/recipient-options"
import { buildRfiContactOptions } from "@/lib/rfis/contact-options"
import { viewableRfiAttachmentUrl } from "@/lib/rfis/attachment-url"
import { cn } from "@/lib/utils"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
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

const RFI_FILTERS: readonly {
  readonly value: RfiStatusFilter
  readonly label: string
}[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "info_needed", label: "Info needed" },
  { value: "complete", label: "Complete" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
]

export default async function ProjectRfisPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly created?: string | readonly string[]
    readonly item?: string | readonly string[]
    readonly status?: string | readonly string[]
  }>
}) {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const query = await searchParams
  const createdRfiId = Array.isArray(query.created)
    ? query.created[0] ?? null
    : query.created ?? null
  const focusedRfiId = Array.isArray(query.item)
    ? query.item[0] ?? null
    : query.item ?? null
  const statusFilter = parseRfiStatusFilter(query.status)
  const [projects, rfis, contactsSummary, taskAssigneeOptions, inboundEmails] =
    await Promise.all([
      getProjects(),
      getProjectRfis(id),
      getProjectContactsSummary(id, "internal"),
      getProjectTaskAssigneeOptions(id),
      getProjectRfiInboundEmails(id),
    ]).catch((error: unknown) => {
      redirectIfFeaturePermissionDenied(error)
      throw error
    })
  const project = projects.find((item) => item.id === id)
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const openCount = rfis.filter(
    (rfi) => !isClosedRfiStatus(rfi.status)
  ).length
  const visibleRfis = [...rfis]
    .filter((rfi) => rfiMatchesStatusFilter(rfi.status, statusFilter))
    .sort(compareRfisForQueue)
  const contacts = contactsSummary.allContacts
  const inboundEmailsByRfi = new Map(
    rfis.map((rfi) => [
      rfi.id,
      inboundEmails.filter((email) => email.rfiId === rfi.id),
    ])
  )
  const companyOrTradeOptions = unique(
    contacts.flatMap((contact) => [
      contact.companyName,
      contact.trade,
      contact.csiDivisionName,
      contact.displayName,
    ])
  )
  const peopleOptions = buildRfiContactOptions(
    taskAssignees,
    project?.clientName
  )

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
          <div className="flex flex-wrap items-center gap-2">
            <ProjectRfiEmailSyncButton />
            <ProjectRfiCreateForm
              projectId={id}
              projectDriveFolderId={project?.googleDriveFolderId ?? null}
              companyOrTradeOptions={companyOrTradeOptions}
              peopleOptions={peopleOptions}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Filter RFIs by status"
            className="flex flex-wrap gap-1"
          >
            {RFI_FILTERS.map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={statusFilter === option.value ? "secondary" : "ghost"}
              >
                <Link
                  href={`/dashboard/projects/${id}/rfis?status=${option.value}`}
                >
                  {option.label}
                </Link>
              </Button>
            ))}
          </nav>
          <p className="text-xs text-muted-foreground">
            {visibleRfis.length} of {rfis.length} shown
          </p>
        </div>

        {visibleRfis.length > 0 ? (
          visibleRfis.map((rfi) => {
            const isCreated = rfi.id === createdRfiId
            const isFocused = rfi.id === focusedRfiId
            const canonicalStatus = canonicalRfiStatus(rfi.status)
            return (
              <article
                key={rfi.id}
                id={`rfi-${rfi.id}`}
                className={cn(
                  "scroll-mt-6 border-l-2 border-y border-r bg-background px-4 py-3",
                  isCreated || isFocused
                    ? "border-l-brand-hps-primary bg-card"
                    : "border-l-brand-nutech-gold"
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
                    {isFocused && !isCreated && (
                      <Badge variant="secondary">Selected from calendar</Badge>
                    )}
                    <Badge
                      variant={
                        !isClosedRfiStatus(rfi.status) ? "secondary" : "outline"
                      }
                    >
                      {label(canonicalStatus)}
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
                    <ProjectRfiCommunicationActions
                      projectId={id}
                      rfiId={rfi.id}
                      rfiNumber={rfi.rfiNumber}
                      recipientOptions={buildProjectEmailRecipientOptions(
                        contacts,
                        [
                          rfi.requesterName,
                          rfi.assignedToName,
                          rfi.companyName,
                        ]
                      )}
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
                  <div className="mt-3 rounded-md border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Attachments
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rfi.attachments.map((attachment) => {
                        const href = viewableRfiAttachmentUrl(attachment)
                        return href ? (
                          <a
                            key={attachment.id}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          >
                            {attachment.fileName}
                          </a>
                        ) : (
                          <span
                            key={attachment.id}
                            title="Attachment source is not viewable in Compass yet; the original source reference is retained for provenance."
                            aria-label={`${attachment.fileName} (source unavailable in Compass)`}
                            className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {attachment.fileName}
                            <span className="ml-1 font-normal">(source unavailable)</span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {(inboundEmailsByRfi.get(rfi.id) ?? []).length > 0 ? (
                  <div className="mt-3 border-l-2 border-l-brand-nutech-gold bg-muted/20 px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Email replies · Internal review
                    </p>
                    <div className="mt-2 space-y-3">
                      {(inboundEmailsByRfi.get(rfi.id) ?? []).map((email) => (
                        <div key={email.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                            <span>{email.from}</span>
                            <span>{formatDateTime(email.receivedAt)}</span>
                          </div>
                          <p className="mt-1 text-sm font-medium">{email.subject}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm">{email.body}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      These replies remain internal until staff adds an approved response below.
                    </p>
                  </div>
                ) : null}

                {rfi.answer ? (
                  <div className="mt-4 border-l-2 border-l-brand-hps-primary bg-muted/20 px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Communication history
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{rfi.answer}</p>
                  </div>
                ) : null}

                <ProjectRfiResponseComposer
                  projectId={id}
                  rfiId={rfi.id}
                  status={canonicalStatus}
                  audience={rfi.audience}
                />
              </article>
            )
          })
        ) : (
          <div className="border-y bg-background p-8 text-center">
            <IconClock className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              {rfis.length === 0 ? "No RFIs yet" : "No RFIs match this filter"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {rfis.length === 0
                ? "Create the first clarification for this project."
                : "Choose another status to see the rest of the RFI queue."}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
