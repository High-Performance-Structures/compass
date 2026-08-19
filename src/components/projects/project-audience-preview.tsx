import type * as React from "react"
import Link from "next/link"
import {
  IconArrowRight,
  IconCalendarStats,
  IconChevronDown,
  IconClipboardCheck,
  IconExternalLink,
  IconFolder,
  IconMessageCircle,
  IconQuestionMark,
  IconShoppingCartQuestion,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react"

import type {
  AudienceMessageChannel,
  AudienceContact,
  AudienceOperationItem,
  AudienceOwnerUpdate,
  AudienceProjectOption,
  AudienceRfi,
  AudienceRfq,
  AudienceScheduleItem,
  ProjectAudience,
  ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OwnerCoverPhotoControl } from "@/components/projects/owner-cover-photo-control"
import { ProjectEmailAddressCard } from "@/components/projects/project-email-address-card"
import { ProjectAudienceMessageLauncher } from "@/components/projects/project-audience-message-launcher"
import { ProjectAudiencePhotoGallery } from "@/components/projects/project-audience-photo-gallery"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { ProjectAudienceRfiCreateDialog } from "@/components/projects/project-audience-rfi-create-dialog"
import { ProjectAudienceRfqResponseDialog } from "@/components/projects/project-audience-rfq-response-dialog"
import { ProjectAudienceSchedule } from "@/components/projects/project-audience-schedule"
import {
  ownerUpdatePreviewHref,
  projectAudienceConversationHref,
  projectAudiencePreviewHref,
  projectAudienceSectionHref,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import { selectUpcomingScheduleItems } from "@/lib/project-audience-schedule-selection"

function formatDate(value: string | null): string {
  if (!value) return "Unscheduled"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function formatMoney(value: number | null): string {
  if (value === null) return "Not submitted"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function projectLabel(data: ProjectAudiencePreviewData): string {
  return data.project.projectNumber ?? data.project.name
}

function projectOptionLabel(project: AudienceProjectOption): string {
  return project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name
}

function previewPath(projectId: string, audience: ProjectAudience): string {
  return audience === "owner"
    ? projectAudiencePreviewHref(projectId, "owner")
    : projectAudiencePreviewHref(projectId, "sub-vendor")
}

function recordTypeLabel(value: string): string {
  switch (value) {
    case "subcontractor_task":
      return "Sub"
    case "supplier_task":
      return "Supplier"
    case "schedule_task":
      return "Schedule"
    case "staff_task":
      return "Staff"
    default:
      return statusLabel(value)
  }
}

function operationReferenceLabel(item: AudienceOperationItem): string {
  const label = recordTypeLabel(item.sourceRecordType)
  return item.sourceRecordNumber
    ? `${label} ${item.sourceRecordNumber}`
    : `${label} commitment`
}

function OperationRow({
  item,
}: {
  readonly item: AudienceOperationItem
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
            <Badge variant="outline">
              {recordTypeLabel(item.sourceRecordType)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {operationReferenceLabel(item)}
            {item.companyName ? ` · ${item.companyName}` : ""}
            {item.assigneeName ? ` · ${item.assigneeName}` : ""}
          </p>
        </div>
        <Badge variant="secondary">{statusLabel(item.status)}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatDate(item.startDate)}
        {" - "}
        {formatDate(item.dueDate)}
      </p>
    </div>
  )
}

function RfiRow({
  item,
}: {
  readonly item: AudienceRfi
}): React.ReactElement {
  const isActive = !["complete", "closed", "void", "cancelled"].includes(
    item.status.toLowerCase()
  )

  return (
    <article className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {item.rfiNumber}
          </p>
          <h3 className="mt-1 line-clamp-2 text-sm font-medium">
            {item.subject}
          </h3>
        </div>
        <div className="flex gap-1">
          <Badge variant={isActive ? "secondary" : "outline"}>
            {statusLabel(item.status)}
          </Badge>
          {item.priority === "high" && <Badge>High</Badge>}
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
        {item.question}
      </p>
      {item.answer && (
        <p className="mt-2 rounded-md bg-muted/50 p-2 text-sm">
          {item.answer}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {item.companyName && <span>{item.companyName}</span>}
        {item.assignedToName && <span>Assigned: {item.assignedToName}</span>}
        {item.dueDate && <span>Due {formatDate(item.dueDate)}</span>}
      </div>
    </article>
  )
}

function RfqRow({
  item,
  projectId,
  viewerIsInternal,
}: {
  readonly item: AudienceRfq
  readonly projectId: string
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  return (
    <article id={`rfq-${item.id}`} className="scroll-mt-24 border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {item.number ?? "Request for quote"}
          </p>
          <h3 className="mt-1 text-base font-semibold">{item.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {item.vendorCategory && <span>{item.vendorCategory}</span>}
            {item.dueDate && <span>Response due {formatDate(item.dueDate)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.status === "sent" ? "secondary" : "outline"}>
            {statusLabel(item.status)}
          </Badge>
          <ProjectAudienceRfqResponseDialog
            projectId={projectId}
            rfqId={item.id}
            rfqTitle={item.title}
            status={item.status}
            response={item.vendorResponse}
            viewerIsInternal={viewerIsInternal}
          />
        </div>
      </div>

      {item.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">
          {item.description}
        </p>
      )}

      {item.scopeItems.length > 0 && (
        <div className="mt-4 overflow-hidden border">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_7rem]">
            <span>#</span>
            <span>Scope</span>
            <span className="hidden sm:block">Phase</span>
            <span className="hidden sm:block">Cost code</span>
          </div>
          {item.scopeItems.map((line) => (
            <div
              key={`${item.id}-${line.lineNumber}`}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_7rem]"
            >
              <span className="font-medium">{line.lineNumber}</span>
              <span>
                {line.description}
                {line.notes && (
                  <span className="mt-1 block text-muted-foreground">{line.notes}</span>
                )}
              </span>
              <span className="hidden sm:block">{line.phaseCode ?? "-"}</span>
              <span className="hidden sm:block">{line.costCode ?? "-"}</span>
            </div>
          ))}
        </div>
      )}

      {item.documentLinks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.documentLinks.map((document) => (
            <Button
              key={`${item.id}-document-${document.lineNumber}`}
              asChild
              variant="outline"
              size="sm"
            >
              <a href={document.url} target="_blank" rel="noreferrer">
                {document.label}
                <IconExternalLink className="size-3" />
              </a>
            </Button>
          ))}
        </div>
      )}

      {item.vendorResponse && (
        <div className="mt-4 border-l-2 border-primary bg-primary/5 px-3 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {item.vendorResponse.decision === "decline"
                ? "Declined to quote"
                : `Quote submitted · ${formatMoney(item.vendorResponse.amount)}`}
            </p>
            <span className="text-xs text-muted-foreground">
              {new Date(item.vendorResponse.submittedAt).toLocaleDateString("en-US")}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {item.vendorResponse.leadTime && (
              <span>Lead time: {item.vendorResponse.leadTime}</span>
            )}
            {item.vendorResponse.validUntil && (
              <span>Valid through {formatDate(item.vendorResponse.validUntil)}</span>
            )}
          </div>
          {item.vendorResponse.notes && (
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {item.vendorResponse.notes}
            </p>
          )}
        </div>
      )}
    </article>
  )
}

function MessageChannelRow({
  channel,
  projectId,
  audience,
}: {
  readonly channel: AudienceMessageChannel
  readonly projectId: string
  readonly audience: ProjectAudience
}): React.ReactElement {
  const routeAudience = audience === "owner" ? "owner" : "sub-vendor"

  return (
    <Link
      href={projectAudienceConversationHref(
        projectId,
        routeAudience,
        channel.id
      )}
      className="block rounded-md border bg-background p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-1 text-sm font-medium">{channel.name}</p>
        <Badge variant={channel.isPrivate ? "secondary" : "outline"}>
          {channel.isPrivate ? "Private" : "Project"}
        </Badge>
      </div>
      {channel.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {channel.description}
        </p>
      )}
    </Link>
  )
}

function AudienceConversationSection({
  data,
}: {
  readonly data: ProjectAudiencePreviewData
}): React.ReactElement {
  return (
    <section
      id="messages"
      className="scroll-mt-24 border bg-background p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Project Conversations</h2>
        </div>
        <Badge variant="outline">
          {data.messageChannels.length}{" "}
          {data.messageChannels.length === 1
            ? "conversation"
            : "conversations"}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Messages here go only to the internal project team and approved
        participants in this private workspace.
      </p>
      {data.messageChannels.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.messageChannels.map((channel) => (
            <MessageChannelRow
              key={channel.id}
              channel={channel}
              projectId={data.project.id}
              audience={data.audience}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border p-3 text-sm text-muted-foreground">
          Your private project conversation will appear when access is
          activated.
        </p>
      )}
    </section>
  )
}

function ContactRow({
  contact,
  messageHref,
}: {
  readonly contact: AudienceContact
  readonly messageHref?: string | null
}): React.ReactElement {
  const detail = [
    contact.companyName,
    contact.role,
    contact.trade,
  ].filter(Boolean).join(" · ")

  return (
    <article className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-1 text-sm font-medium">
              {contact.displayName}
            </p>
            {contact.csiDivision && contact.csiDivisionName && (
              <Badge variant="outline">
                {contact.csiDivision} {contact.csiDivisionName}
              </Badge>
            )}
          </div>
          {detail && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
        {contact.primaryContact && <Badge variant="secondary">Primary</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {contact.email && <span>{contact.email}</span>}
        {contact.phone && <span>{contact.phone}</span>}
      </div>
      {messageHref && (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={messageHref}>
            <IconMessageCircle className="size-4" />
            Message {contact.displayName}
          </Link>
        </Button>
      )}
    </article>
  )
}

function contactMessageHref(
  data: ProjectAudiencePreviewData,
  contact: AudienceContact
): string | null {
  const channel = data.messageChannels[0]
  if (data.viewerIsInternal || !channel || !contact.userId) return null
  const routeAudience = data.audience === "owner" ? "owner" : "sub-vendor"
  const href = projectAudienceConversationHref(
    data.project.id,
    routeAudience,
    channel.id
  )
  return `${href}?mention=${encodeURIComponent(contact.userId)}&label=${encodeURIComponent(contact.displayName)}`
}

function ownerHeroTitle(data: ProjectAudiencePreviewData): string {
  return data.project.clientName
    ? `${data.project.clientName} Project`
    : projectLabel(data)
}

function OwnerUpdateCard({
  projectId,
  update,
  featured,
}: {
  readonly projectId: string
  readonly update: AudienceOwnerUpdate
  readonly featured?: boolean
}): React.ReactElement {
  return (
    <article
      className={
        featured
          ? "rounded-lg border bg-background p-5 shadow-sm"
          : "rounded-md border bg-background p-4"
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDate(update.updateDate)}</span>
        {update.publishedAt && (
          <>
            <span>&middot;</span>
            <span>Published</span>
          </>
        )}
      </div>
      <h3
        className={
          featured ? "mt-3 text-lg font-semibold" : "mt-2 text-sm font-medium"
        }
      >
        {update.title}
      </h3>
      <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">
        {update.summary}
      </p>
      <Button
        asChild
        variant={featured ? "default" : "outline"}
        size="sm"
        className="mt-4"
      >
        <Link href={ownerUpdatePreviewHref(projectId, update.id)}>
          Open update
          <IconArrowRight className="size-4" />
        </Link>
      </Button>
    </article>
  )
}

function AudienceMetricStrip({
  data,
}: {
  readonly data: ProjectAudiencePreviewData
}): React.ReactElement {
  const metrics: readonly {
    readonly label: string
    readonly value: string
    readonly detail: string
    readonly icon: React.ReactElement
  }[] = [
    {
      label: "Schedule",
      value: String(data.scheduleItems.length),
      detail: "visible items",
      icon: <IconCalendarStats className="size-4" />,
    },
    {
      label: "RFIs",
      value: String(data.rfis.length),
      detail: "visible questions",
      icon: <IconQuestionMark className="size-4" />,
    },
    {
      label: "Commitments",
      value: String(data.operations.length),
      detail: "active records",
      icon: <IconClipboardCheck className="size-4" />,
    },
    {
      label: "RFQs",
      value: String(data.rfqs.length),
      detail: "quote requests",
      icon: <IconShoppingCartQuestion className="size-4" />,
    },
  ]

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border bg-background p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{metric.icon}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {metric.value}
            </span>
          </div>
          <p className="mt-3 text-sm font-medium">{metric.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {metric.detail}
          </p>
        </div>
      ))}
    </section>
  )
}

function OwnerScheduleCard({
  item,
}: {
  readonly item: AudienceScheduleItem
}): React.ReactElement {
  return (
    <article className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(item.startDate)}
            {" - "}
            {formatDate(item.endDate)}
          </p>
        </div>
        <Badge variant={item.isMilestone ? "default" : "secondary"}>
          {item.isMilestone ? "Milestone" : `${item.percentComplete}%`}
        </Badge>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[oklch(0.53_0.11_150)]"
          style={{ width: `${item.percentComplete}%` }}
        />
      </div>
    </article>
  )
}

function OwnerProjectPreview({
  data,
  section,
}: {
  readonly data: ProjectAudiencePreviewData
  readonly section: ProjectAudienceWorkspaceSection
}): React.ReactElement {
  const latestUpdate = data.ownerUpdates[0]
  const olderUpdates = data.ownerUpdates.slice(1)
  const upcomingScheduleItems = selectUpcomingScheduleItems(
    data.scheduleItems,
    new Date().toISOString().slice(0, 10)
  )
  const nextScheduleItem = upcomingScheduleItems[0]

  return (
    <main className="min-h-screen bg-[oklch(0.96_0.018_115)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {section === "overview" && (
        <div>
          <OwnerCoverPhotoControl
            projectId={data.project.id}
            projectTitle={ownerHeroTitle(data)}
            projectLabel={projectLabel(data)}
            projectAddress={data.project.address}
            latestUpdate={
              latestUpdate
                ? {
                    id: latestUpdate.id,
                    title: latestUpdate.title,
                  }
                : null
            }
            nextScheduleItem={
              nextScheduleItem
                ? {
                    title: nextScheduleItem.title,
                    dateRange:
                      `${formatDate(nextScheduleItem.startDate)} - ` +
                      formatDate(nextScheduleItem.endDate),
                  }
                : null
            }
            approvedPhotos={data.photos.map((photo) => ({
              id: photo.id,
              fileName: photo.fileName,
              driveFileId: photo.driveFileId,
              thumbnailUrl: photo.thumbnailUrl,
              caption: photo.caption,
            }))}
            latestUpdateHref={
              latestUpdate
                ? ownerUpdatePreviewHref(data.project.id, latestUpdate.id)
                : null
            }
            photoGalleryHref={projectAudienceSectionHref(
              data.project.id,
              "owner",
              "photos"
            )}
            editable={false}
          />
        </div>
        )}

        {section === "overview" && (
          <ProjectEmailAddressCard projectId={data.project.id} />
        )}

        {(section === "overview" || section === "updates") && (
        <section
          className={
            section === "overview"
              ? "grid gap-4 lg:grid-cols-[1.15fr_0.85fr]"
              : "space-y-4"
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Project story
                </p>
                <h2 className="text-xl font-semibold">Recent updates</h2>
              </div>
              <Badge variant="outline">{data.ownerUpdates.length} published</Badge>
            </div>
            {latestUpdate ? (
              <OwnerUpdateCard
                projectId={data.project.id}
                update={latestUpdate}
                featured
              />
            ) : (
              <div className="rounded-lg border bg-background p-5 text-sm text-muted-foreground">
                No published owner updates are visible yet.
              </div>
            )}
            {olderUpdates.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {olderUpdates.map((update) => (
                  <OwnerUpdateCard
                    key={update.id}
                    projectId={data.project.id}
                    update={update}
                  />
                ))}
              </div>
            )}
          </div>

          {section === "overview" && (
          <aside className="space-y-4">
            <section
              className="rounded-lg border bg-background p-5"
            >
              <div className="flex items-center gap-2">
                <IconCalendarStats className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">What happens next</h2>
              </div>
              {upcomingScheduleItems.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {upcomingScheduleItems.map((item) => (
                    <OwnerScheduleCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                  No upcoming schedule items.
                </p>
              )}
            </section>

            <section className="rounded-lg border bg-background p-5">
              <div className="flex items-center gap-2">
                <IconSparkles className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Your project team</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                {data.project.projectManager && (
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Project manager
                    </p>
                    <p className="mt-1 font-medium">{data.project.projectManager}</p>
                  </div>
                )}
                {data.contacts.slice(0, 3).map((contact) => {
                  const contactDetail = [
                    contact.companyName,
                    contact.role,
                    contact.trade,
                  ].filter(Boolean).join(" · ")

                  return (
                    <div key={contact.id} className="border-t pt-3">
                      <p className="font-medium">{contact.displayName}</p>
                      {contactDetail && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {contactDetail}
                        </p>
                      )}
                    </div>
                  )
                })}
                {!data.project.projectManager && data.contacts.length === 0 && (
                  <p className="rounded-md border p-3 text-sm text-muted-foreground">
                    No approved project contacts yet.
                  </p>
                )}
              </div>
            </section>
          </aside>
          )}
        </section>
        )}

        {section === "team" && (
          <section className="rounded-lg border bg-background p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconUsers className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Project directory
                  </p>
                  <h1 className="text-xl font-semibold">Your project team</h1>
                </div>
              </div>
              <Badge variant="outline">{data.contacts.length} contacts</Badge>
            </div>
            {data.contacts.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.contacts.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    messageHref={contactMessageHref(data, contact)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No approved project contacts yet.
              </p>
            )}
          </section>
        )}

        {section === "schedule" && (
        <ProjectAudienceSchedule
          items={data.scheduleItems}
          presentation={data.project.ownerScheduleView}
        />
        )}

        {section === "conversations" && (
        <AudienceConversationSection data={data} />
        )}

        {section === "photos" && (
        <div>
          <ProjectAudiencePhotoGallery
            photos={data.photos}
            title="Approved Photo Gallery"
            emptyMessage="No photos have been approved for this audience yet."
          />
        </div>
        )}
      </div>
    </main>
  )
}

export function ProjectAudiencePreview({
  data,
  section = "overview",
}: {
  readonly data: ProjectAudiencePreviewData
  readonly section?: ProjectAudienceWorkspaceSection
}): React.ReactElement {
  const label = projectLabel(data)
  const isOwner = data.audience === "owner"
  const selectedProjectLabel = projectOptionLabel({
    id: data.project.id,
    name: data.project.name,
    projectNumber: data.project.projectNumber,
    status: "OPEN",
  })
  const partnerUpcomingScheduleItems = selectUpcomingScheduleItems(
    data.scheduleItems,
    new Date().toISOString().slice(0, 10)
  )
  const partnerNextScheduleItem = partnerUpcomingScheduleItems[0]
  const messageShortcut = projectAudienceMessageShortcut({
    projectId: data.project.id,
    audience: data.audience,
    viewerId: data.viewer.id,
    contacts: data.contacts,
    messageChannels: data.messageChannels,
  })

  if (isOwner) {
    return (
      <ProjectAudiencePreviewShell
        audience={data.audience}
        projectId={data.project.id}
        projectName={data.project.name}
        projectNumber={data.project.projectNumber}
        projectOptions={data.projectOptions}
        viewer={data.viewer}
        viewerIsInternal={data.viewerIsInternal}
        messageShortcut={messageShortcut}
        activeSection={section}
        warrantyEnabled={data.project.warrantyEnabled}
      >
        <OwnerProjectPreview data={data} section={section} />
      </ProjectAudiencePreviewShell>
    )
  }

  return (
    <ProjectAudiencePreviewShell
      audience={data.audience}
      projectId={data.project.id}
      projectName={data.project.name}
      projectNumber={data.project.projectNumber}
      projectOptions={data.projectOptions}
      viewer={data.viewer}
      viewerIsInternal={data.viewerIsInternal}
      messageShortcut={messageShortcut}
      activeSection={section}
      warrantyEnabled={data.project.warrantyEnabled}
    >
      <main className="min-h-screen bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {section === "overview" && (
          <OwnerCoverPhotoControl
            projectId={data.project.id}
            projectTitle={data.project.name}
            projectLabel={label}
            projectAddress={data.project.address}
            latestUpdate={null}
            nextScheduleItem={
              partnerNextScheduleItem
                ? {
                    title: partnerNextScheduleItem.title,
                    dateRange:
                      `${formatDate(partnerNextScheduleItem.startDate)} - ` +
                      formatDate(partnerNextScheduleItem.endDate),
                  }
                : null
            }
            approvedPhotos={data.photos.map((photo) => ({
              id: photo.id,
              fileName: photo.fileName,
              driveFileId: photo.driveFileId,
              thumbnailUrl: photo.thumbnailUrl,
              caption: photo.caption,
            }))}
            latestUpdateHref={null}
            photoGalleryHref={projectAudienceSectionHref(
              data.project.id,
              "sub-vendor",
              "photos"
            )}
            workspaceLabel="Partner project home"
            editable={false}
          />
        )}

        {section === "overview" && (
          <ProjectEmailAddressCard projectId={data.project.id} />
        )}

        {section === "overview" && (
          <section className="border bg-background p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Compass partner workspace
                </p>
                <h2 className="mt-1 text-lg font-semibold">Project command center</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Keep questions, quotes, schedules, files, and project-team
                  conversations together in one secure workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ProjectAudienceRfiCreateDialog
                  projectId={data.project.id}
                  recipients={messageShortcut?.recipients ?? []}
                  viewerIsInternal={data.viewerIsInternal}
                />
                <Button asChild variant="outline">
                  <Link
                    href={projectAudienceSectionHref(
                      data.project.id,
                      "sub-vendor",
                      "rfqs"
                    )}
                  >
                    <IconShoppingCartQuestion className="size-4" />
                    Review RFQs
                  </Link>
                </Button>
                <ProjectAudienceMessageLauncher shortcut={messageShortcut} />
              </div>
            </div>
          </section>
        )}

        {section === "overview" && (
          <section className="rounded-lg border bg-background/80 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 text-sm">
                  <span className="text-muted-foreground">Current project: </span>
                  <span className="font-medium">{selectedProjectLabel}</span>
                </p>
              </div>
              {data.projectOptions.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8">
                      Switch project
                      <IconChevronDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    {data.projectOptions.map((project) => {
                      const active = project.id === data.project.id

                      return (
                        <DropdownMenuItem key={project.id} asChild>
                          <Link
                            href={previewPath(project.id, data.audience)}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {projectOptionLabel(project)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {project.status}
                              </span>
                            </span>
                            {active && <Badge variant="secondary">Current</Badge>}
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Badge variant="outline">Project scoped</Badge>
              )}
            </div>
          </section>
        )}

        {section === "overview" && <AudienceMetricStrip data={data} />}

        {(section === "overview" || section === "team") && (
        <section
          className="rounded-lg border bg-background p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconUsers className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Visible Contacts</h2>
            </div>
            <Badge variant="outline">{data.contacts.length} contacts</Badge>
          </div>
          {data.contacts.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  messageHref={contactMessageHref(data, contact)}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
              No contacts have been approved for this audience yet.
            </p>
          )}
        </section>
        )}

        {section === "schedule" && (
          <ProjectAudienceSchedule items={data.scheduleItems} />
        )}

        {section === "commitments" && (
        <section>
          <div
            className="rounded-lg border bg-background p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconUsers className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Commitments</h2>
              </div>
              <Badge variant="outline">{data.operations.length} active</Badge>
            </div>
            {data.operations.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {data.operations.map((item) => (
                  <OperationRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                No sub/vendor-visible commitments are mapped yet.
              </p>
            )}
          </div>
        </section>
        )}

        {section === "rfis" && (
          <section>
            <div
              className="rounded-lg border bg-background p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconQuestionMark className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">RFIs</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{data.rfis.length} visible</Badge>
                  <ProjectAudienceRfiCreateDialog
                    projectId={data.project.id}
                    recipients={messageShortcut?.recipients ?? []}
                    viewerIsInternal={data.viewerIsInternal}
                  />
                </div>
              </div>
              {data.rfis.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {data.rfis.map((item) => (
                    <RfiRow key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                  No RFIs are currently visible for this project.
                </p>
              )}
            </div>
          </section>
        )}

        {section === "rfqs" && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pricing requests
                </p>
                <h1 className="mt-1 text-xl font-semibold">Requests for quote</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review assigned scopes and send pricing directly to the
                  internal project team.
                </p>
              </div>
              <Badge variant="outline">{data.rfqs.length} assigned</Badge>
            </div>
            {data.rfqs.length > 0 ? (
              <div className="grid gap-3">
                {data.rfqs.map((item) => (
                  <RfqRow
                    key={item.id}
                    item={item}
                    projectId={data.project.id}
                    viewerIsInternal={data.viewerIsInternal}
                  />
                ))}
              </div>
            ) : (
              <p className="border bg-background p-5 text-sm text-muted-foreground">
                No RFQs are currently assigned to your company.
              </p>
            )}
          </section>
        )}

        {section === "conversations" && (
          <AudienceConversationSection data={data} />
        )}

        {section === "photos" && (
        <div>
          <ProjectAudiencePhotoGallery
            photos={data.photos}
            title="Visible Photos"
            emptyMessage="No photos have been approved for this audience yet."
          />
        </div>
        )}
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
