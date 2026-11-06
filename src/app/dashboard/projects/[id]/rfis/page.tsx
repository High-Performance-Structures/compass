import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { IconMessageQuestion } from "@tabler/icons-react"

import {
  getProjectRfiInboundEmails,
  getProjectRfiVendorOptions,
  getProjectRfis,
} from "@/app/actions/project-rfis"
import type { ProjectRfiInboundEmailItem, ProjectRfiItem } from "@/lib/domain/rfis/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { ProjectRfiRecordTable } from "@/components/projects/project-rfi-record-table"
import { rfiListRow, rfiStatusFilterOptions } from "@/lib/rfis/record-list"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { projectRfiHref } from "@/lib/work-calendar"
import { ProjectRfiVendorAssignment } from "@/components/projects/project-rfi-vendor-assignment"
import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contact-assignees"
import { getProjects } from "@/app/actions/projects"
import { PageHeader } from "@/components/page-header"
import { ProjectRfiCreateForm } from "@/components/projects/project-rfi-create-form"
import { ProjectRfiCommunicationActions } from "@/components/projects/project-rfi-communication-actions"
import { ProjectRfiDeleteButton } from "@/components/projects/project-rfi-delete-button"
import { ProjectRfiEmailSyncButton } from "@/components/projects/project-rfi-email-sync-button"
import { ProjectRfiResponseComposer } from "@/components/projects/project-rfi-response-composer"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { compareRfisForQueue } from "@/lib/rfis/status"
import { getCompanyRecordStatuses } from "@/app/actions/record-statuses"
import { RecordStatusBadge } from "@/components/record-status-badge"
import {
  isOpenRecordStatus,
  parseRecordStatusFilter,
  recordStatusColor,
  recordStatusKey,
  recordStatusLabel,
  recordStatusMatchesFilter,
  selectableRecordStatuses,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"
import { buildProjectEmailRecipientOptions } from "@/lib/email/recipient-options"
import { buildRfiContactOptions } from "@/lib/rfis/contact-options"
import { viewableRfiAttachmentUrl } from "@/lib/rfis/attachment-url"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"
import { ClientRedirect } from "@/components/client-redirect"
import { getProjectPaperTrail } from "@/app/actions/paper-trail"
import { PaperTrailRecordStatus } from "@/components/paper-trail/paper-trail-record-status"
import { formatDate, formatDateTime } from "@/lib/format"

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


type RfiCardProps = {
  readonly projectId: string
  readonly rfi: ProjectRfiItem
  readonly isCreated: boolean
  readonly taskAssignees: readonly ProjectTaskAssigneeOption[]
  readonly contacts: Parameters<typeof buildProjectEmailRecipientOptions>[0]
  readonly paperTrail: Awaited<ReturnType<typeof getProjectPaperTrail>>
  readonly inboundEmails: readonly ProjectRfiInboundEmailItem[]
  readonly vendorOptions: Awaited<ReturnType<typeof getProjectRfiVendorOptions>>
  /** The company's RFI statuses (Settings › Statuses). */
  readonly statuses: RecordStatusList
}

/** The selected RFI's full record: every workflow (respond, email, print, status, delete). */
function RfiCard({
  projectId: id,
  rfi,
  isCreated,
  taskAssignees,
  contacts,
  paperTrail,
  inboundEmails,
  vendorOptions,
  statuses,
}: RfiCardProps): React.ReactElement {
  const statusKey = recordStatusKey(statuses, rfi.status) ?? rfi.status
  return (
    <article
      key={rfi.id}
      id={`rfi-${rfi.id}`}
      className="scroll-mt-6 border-l-2 border-y border-r border-l-brand-hps-primary bg-card px-4 py-3"
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
          {!isCreated && <Badge variant="secondary">Selected</Badge>}
          <RecordStatusBadge
            label={recordStatusLabel(statuses, rfi.status)}
            color={recordStatusColor(statuses, rfi.status)}
          />
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
            sourceHref={projectRfiHref(id, rfi.id)}
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
            rfiSubject={rfi.subject}
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
        {rfi.assignedVendor && <span>Vendor access: {rfi.assignedVendor.label}</span>}
        <span>Response needed by {formatDate(rfi.dueDate, "medium", "No due date")}</span>
        {rfi.attachmentCount > 0 && (
          <span>
            {rfi.attachmentCount} attachment
            {rfi.attachmentCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {paperTrail.enabled ? (
        <PaperTrailRecordStatus
          className="mt-2"
          projectId={id}
          recordType="rfi"
          recordId={rfi.id}
          record={paperTrail.records[rfi.id] ?? null}
        />
      ) : null}
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

      {inboundEmails.length > 0 ? (
        <div className="mt-3 border-l-2 border-l-brand-nutech-gold bg-muted/20 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Email replies · Internal review
          </p>
          <div className="mt-2 space-y-3">
            {inboundEmails.map((email) => (
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

      <ProjectRfiVendorAssignment
        projectId={id}
        rfiId={rfi.id}
        audience={rfi.audience}
        assignment={rfi.assignedVendor}
        options={vendorOptions}
      />

      <ProjectRfiResponseComposer
        projectId={id}
        rfiId={rfi.id}
        status={statusKey}
        statusOptions={selectableRecordStatuses(statuses, rfi.status)}
        audience={rfi.audience}
      />
    </article>
  )
}

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
  // A permission denial sends the browser to the access page instead.
  const loaded = await Promise.all([
      getProjects(),
      getProjectRfis(id),
      getProjectContactsSummary(id, "internal"),
      getProjectTaskAssigneeOptions(id),
      getProjectRfiInboundEmails(id),
      getProjectPaperTrail(id, "rfi"),
      getProjectRfiVendorOptions(id),
      getCompanyRecordStatuses("rfi"),
    ]).then(
    (data) => ({ data, deniedHref: null }),
    (error: unknown) => {
      const deniedHref = permissionDeniedRedirectHref(error)
      if (deniedHref) return { data: null, deniedHref }
      throw error
    },
  )
  if (loaded.data === null) return <ClientRedirect href={loaded.deniedHref} />
  const [projects, rfis, contactsSummary, taskAssigneeOptions, inboundEmails, paperTrail, vendorOptions, statuses] =
    loaded.data
  const statusFilter = parseRecordStatusFilter(statuses, query.status)
  const project = projects.find((item) => item.id === id)
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const openCount = rfis.filter(
    (rfi) => isOpenRecordStatus(statuses, rfi.status)
  ).length
  // The list opens one RFI at a time below it (a row click, a calendar,
  // notification or email link, or an RFI just created), whatever the filter.
  const selectedRfiId = focusedRfiId ?? createdRfiId
  const selectedRfis = rfis.filter((rfi) => rfi.id === selectedRfiId)
  const visibleRfis = [...rfis]
    .filter((rfi) => recordStatusMatchesFilter(statuses, rfi.status, statusFilter))
    .sort(compareRfisForQueue)
  const listRows = visibleRfis.map(rfiListRow)
  const contacts = contactsSummary.allContacts
  const inboundEmailsByRfi = new Map(
    selectedRfis.map((rfi) => [
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
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<IconMessageQuestion className="size-5 text-primary" />}
        title="RFIs"
        eyebrow={`${project?.projectNumber ? `${project.projectNumber} - ` : ""}${project?.name ?? "Project"}`}
        actions={
          <>
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
          </>
        }
      />

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
              vendorOptions={vendorOptions}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusFilterBar
            kind="link"
            label="Filter RFIs by status"
            options={rfiStatusFilterOptions(rfis.map((rfi) => rfi.status), statuses)}
            selected={statusFilter}
            hrefFor={(value) => `/dashboard/projects/${id}/rfis?status=${value}`}
          />
          <p className="text-xs text-muted-foreground">
            {visibleRfis.length} of {rfis.length} shown
          </p>
        </div>

        <ProjectRfiRecordTable
          rows={listRows}
          statuses={statuses}
          audience="staff"
          projectId={id}
          statusFilter={statusFilter}
          selectedId={selectedRfiId}
          emptyMessage={
            rfis.length === 0
              ? "No RFIs yet. Create the first clarification for this project."
              : "No RFIs match this filter. Choose another status to see the rest of the RFI queue."
          }
        />

        {selectedRfis.length > 0 ? (
          selectedRfis.map((rfi) => (
            <RfiCard
              key={rfi.id}
              projectId={id}
              rfi={rfi}
              isCreated={rfi.id === createdRfiId}
              taskAssignees={taskAssignees}
              contacts={contacts}
              paperTrail={paperTrail}
              inboundEmails={inboundEmailsByRfi.get(rfi.id) ?? []}
              vendorOptions={vendorOptions}
              statuses={statuses}
            />
          ))
        ) : rfis.length > 0 ? (
          <p className="text-sm text-muted-foreground print:hidden">
            Select an RFI to see its question, attachments, replies and response tools.
          </p>
        ) : null}
      </section>
    </div>
  )
}
