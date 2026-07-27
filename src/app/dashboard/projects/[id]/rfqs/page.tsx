import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconClock,
  IconExternalLink,
  IconFileText,
  IconShoppingCartQuestion,
} from "@tabler/icons-react"

import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import {
  getProjectRfqs,
  type ProjectRfqItem,
} from "@/app/actions/project-operations"
import {
  getProjectSelectionOptions,
  getProjectSelections,
  type ProjectSelectionOptions,
  type ProjectSelectionsSummary,
} from "@/app/actions/project-selections"
import { getProjects } from "@/app/actions/projects"
import { ProjectRfqCreateForm } from "@/components/projects/project-rfq-create-form"
import { ProjectRfqDeleteButton } from "@/components/projects/project-rfq-delete-button"
import { ProjectRfqEditForm } from "@/components/projects/project-rfq-edit-form"
import { ProjectRfqShareActions } from "@/components/projects/project-rfq-share-actions"
import { ProjectOperationStatusSelect } from "@/components/projects/project-operation-status-select"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import {
  isClosedProjectOperationStatus,
  parseProjectOperationStatusFilter,
  projectOperationMatchesStatusFilter,
  type ProjectOperationStatusFilter,
} from "@/lib/project-operations/status"

export const dynamic = "force-dynamic"

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

function isActiveRfqStatus(status: string): boolean {
  return !isClosedProjectOperationStatus(status)
}

const RFQ_FILTERS: readonly {
  readonly value: ProjectOperationStatusFilter
  readonly label: string
}[] = [
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "response_received", label: "Response received" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
  { value: "complete", label: "Complete" },
  { value: "closed", label: "Closed" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
]

function rfqTaskTitle(rfq: ProjectRfqItem): string {
  return `Follow up RFQ: ${rfq.sourceRecordNumber ?? rfq.title}`
}

function projectDisplayLabel(
  project: { readonly projectNumber: string | null; readonly name: string } | undefined
): string {
  if (!project) return "Project"
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
}

function rfqTaskDescription(rfq: ProjectRfqItem): string {
  const scopeLines = rfq.scopeItems.map((line) => {
    const coding = [
      line.phaseCode ? `Phase: ${line.phaseCode}` : null,
      line.costCode ? `Cost code: ${line.costCode}` : null,
    ]
      .filter((value) => value !== null)
      .join(" | ")

    return [
      `Line ${line.lineNumber}: ${line.description}`,
      coding ? `  ${coding}` : null,
      line.notes ? `  Notes: ${line.notes}` : null,
    ]
      .filter((value) => value !== null)
      .join("\n")
  })
  const documentLines = rfq.documentLinks.map((link) =>
    [
      `${link.lineNumber}. ${link.label}: ${link.url}`,
      link.notes ? `   Notes: ${link.notes}` : null,
    ]
      .filter((value) => value !== null)
      .join("\n")
  )

  return [
    rfq.description ?? rfq.title,
    "",
    rfq.companyName ? `Requested from: ${rfq.companyName}` : null,
    rfq.vendorCategory ? `Trade/category: ${rfq.vendorCategory}` : null,
    scopeLines.length > 0 ? "Scope rows:" : null,
    ...scopeLines,
    documentLines.length > 0 ? "" : null,
    documentLines.length > 0 ? "Document package:" : null,
    ...documentLines,
  ]
    .filter((value) => value !== null)
    .join("\n")
}

function RfqCard({
  rfq,
  projectId,
  projectLabel,
  isCreated,
  taskAssigneeOptions,
  selectionOptions,
  selectionsSummary,
}: {
  readonly rfq: ProjectRfqItem
  readonly projectId: string
  readonly projectLabel: string
  readonly isCreated: boolean
  readonly taskAssigneeOptions: React.ComponentProps<
    typeof ProjectTaskCreateButton
  >["assigneeOptions"]
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
}): React.ReactElement {
  return (
    <article
      data-rfq-id={rfq.id}
      className={cn(
        "border-l-2 border-y border-r bg-background px-4 py-3",
        isCreated ? "border-l-brand-hps-primary bg-card" : "border-l-brand-nutech-gold"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {rfq.sourceRecordNumber ?? "Unnumbered"}
          </p>
          <h2 className="mt-1 text-base font-semibold">{rfq.title}</h2>
        </div>
        <div className="flex flex-wrap gap-1">
          {isCreated && <Badge variant="secondary">Just created</Badge>}
          <ProjectOperationStatusSelect
            projectId={projectId}
            operationId={rfq.id}
            operationKind="rfq"
            status={rfq.status}
          />
          <Badge variant="outline">{label(rfq.syncStatus)}</Badge>
          {rfq.priority === "high" || rfq.priority === "critical" ? (
            <Badge variant="destructive">{label(rfq.priority)}</Badge>
          ) : null}
          <ProjectRfqEditForm
            projectId={projectId}
            rfq={rfq}
            selectionOptions={selectionOptions}
            selectionsSummary={selectionsSummary}
          />
          <ProjectRfqShareActions
            projectId={projectId}
            projectLabel={projectLabel}
            rfq={rfq}
          />
          <ProjectRfqDeleteButton
            projectId={projectId}
            rfqId={rfq.id}
            rfqNumber={rfq.sourceRecordNumber}
            title={rfq.title}
          />
          <ProjectTaskCreateButton
            projectId={projectId}
            sourceLabel="RFQ"
            sourceRecordId={rfq.id}
            sourceRecordNumber={rfq.sourceRecordNumber}
            sourceHref={`/dashboard/projects/${projectId}/rfqs`}
            defaultTitle={rfqTaskTitle(rfq)}
            defaultDescription={rfqTaskDescription(rfq)}
            defaultAssigneeName={rfq.assigneeName}
            defaultCompanyName={rfq.companyName}
            defaultDueDate={rfq.dueDate}
            defaultPriority={rfq.priority}
            defaultTaskType="supplier_task"
            assigneeOptions={taskAssigneeOptions}
          />
        </div>
      </div>

      {rfq.description && (
        <p className="mt-3 text-sm text-muted-foreground">{rfq.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {rfq.companyName && <span>{rfq.companyName}</span>}
        {rfq.vendorCategory && <span>{rfq.vendorCategory}</span>}
        {rfq.recipientEmail && <span>{rfq.recipientEmail}</span>}
        <span>Response needed by {formatDate(rfq.dueDate)}</span>
      </div>

      {rfq.scopeItems.length > 0 && (
        <div className="mt-3 overflow-hidden border bg-muted/10">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_5rem_6rem_minmax(0,.8fr)] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Scope</span>
            <span>Phase</span>
            <span>Cost code</span>
            <span>Notes</span>
          </div>
          {rfq.scopeItems.map((line) => (
            <div
              key={`${rfq.id}-${line.lineNumber}`}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_5rem_6rem_minmax(0,.8fr)] gap-2 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <span className="font-medium">{line.lineNumber}</span>
              <span>{line.description}</span>
              <span>{line.phaseCode ?? "-"}</span>
              <span>{line.costCode ?? "-"}</span>
              <span>{line.notes ?? "-"}</span>
            </div>
          ))}
        </div>
      )}

      {rfq.documentLinks.length > 0 && (
        <div className="mt-3 border bg-background px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <IconFileText className="size-4" />
            Document package
          </div>
          <div className="mt-2 grid gap-2">
            {rfq.documentLinks.map((link) => (
              <div
                key={`${rfq.id}-document-${link.lineNumber}`}
                className="flex flex-wrap items-start justify-between gap-2 border-t pt-2 text-sm first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <span className="truncate">{link.label}</span>
                    <IconExternalLink className="size-3 shrink-0" />
                  </a>
                  {link.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {link.notes}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  Link {link.lineNumber}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

export default async function ProjectRfqsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly created?: string | readonly string[]
    readonly status?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const query = await searchParams
  const createdRfqId = Array.isArray(query.created)
    ? query.created[0] ?? null
    : query.created ?? null
  const statusFilter = parseProjectOperationStatusFilter(query.status)
  const [projects, rfqs, taskAssigneeOptions, selectionsSummary, selectionOptions] =
    await Promise.all([
    getProjects(),
    getProjectRfqs(id),
    getProjectTaskAssigneeOptions(id),
    getProjectSelections(id),
    getProjectSelectionOptions(id),
  ]).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  const project = projects.find((item) => item.id === id)
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const openRfqs = rfqs.filter((rfq) => isActiveRfqStatus(rfq.status))
  const visibleRfqs = rfqs.filter((rfq) =>
    projectOperationMatchesStatusFilter(rfq.status, statusFilter)
  )
  const overdueCount = openRfqs.filter((rfq) => {
    if (!rfq.dueDate) return false
    return rfq.dueDate < new Date().toISOString().slice(0, 10)
  }).length
  const projectLabel = projectDisplayLabel(project)

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
            <IconShoppingCartQuestion className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Requests for Quote
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} - ` : ""}
            {project?.name ?? "Project"} scopes, quote requests, and vendor
            response tracking.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectQuickSwitcher
            projects={projects}
            currentProjectId={id}
            targetSection="rfqs"
            placeholder="Switch RFQ project..."
            className="w-full sm:w-[300px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={openRfqs.length > 0 ? "secondary" : "outline"}>
              {openRfqs.length} open
            </Badge>
            {overdueCount > 0 && (
              <Badge variant="destructive">{overdueCount} overdue</Badge>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">RFQ queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Draft quote scopes and track vendor response dates.
            </p>
          </div>
          <ProjectRfqCreateForm
            projectId={id}
            recipientOptions={taskAssignees}
            selectionOptions={selectionOptions}
            selectionsSummary={selectionsSummary}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Filter RFQs by status"
            className="flex flex-wrap gap-1"
          >
            {RFQ_FILTERS.map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={statusFilter === option.value ? "secondary" : "ghost"}
              >
                <Link
                  href={`/dashboard/projects/${id}/rfqs?status=${option.value}`}
                >
                  {option.label}
                </Link>
              </Button>
            ))}
          </nav>
          <p className="text-xs text-muted-foreground">
            {visibleRfqs.length} of {rfqs.length} shown
          </p>
        </div>

        {visibleRfqs.length > 0 ? (
          visibleRfqs.map((rfq) => (
            <RfqCard
              key={rfq.id}
              rfq={rfq}
              projectId={id}
              projectLabel={projectLabel}
              isCreated={rfq.id === createdRfqId}
              taskAssigneeOptions={taskAssignees}
              selectionOptions={selectionOptions}
              selectionsSummary={selectionsSummary}
            />
          ))
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconClock className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              {rfqs.length === 0 ? "No RFQs yet" : "No RFQs match this filter"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {rfqs.length === 0
                ? "Create the first quote request for this project."
                : "Choose another status to see the rest of the RFQ queue."}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
