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
import { ProjectAudiencePhotoGallery } from "@/components/projects/project-audience-photo-gallery"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import {
  ownerUpdatePreviewHref,
  projectAudiencePreviewHref,
} from "@/lib/project-audience-preview-routes"

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

function audienceDescription(value: ProjectAudience): string {
  return value === "owner"
    ? "Approved updates, schedule items, and owner-visible photos."
    : "Visible commitments, schedule items, RFIs, and project photos."
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

function ScheduleRow({
  item,
}: {
  readonly item: AudienceScheduleItem
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(item.startDate)}
            {" - "}
            {formatDate(item.endDate)}
            {item.assignedTo ? ` · ${item.assignedTo}` : ""}
          </p>
        </div>
        <Badge variant={item.isMilestone ? "default" : "outline"}>
          {item.isMilestone ? "Milestone" : statusLabel(item.status)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${item.percentComplete}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs text-muted-foreground">
          {item.percentComplete}%
        </span>
      </div>
    </div>
  )
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

function MessageChannelRow({
  channel,
  previewHref,
}: {
  readonly channel: AudienceMessageChannel
  readonly previewHref: string
}): React.ReactElement {
  return (
    <Link
      href={`${previewHref}?channel=${encodeURIComponent(channel.id)}#messages`}
      className="block rounded-md border bg-background p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-1 text-sm font-medium">#{channel.name}</p>
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

function ContactRow({
  contact,
}: {
  readonly contact: AudienceContact
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
    </article>
  )
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
      label: "Messages",
      value: String(data.messageChannels.length),
      detail: "project channels",
      icon: <IconMessageCircle className="size-4" />,
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
}: {
  readonly data: ProjectAudiencePreviewData
}): React.ReactElement {
  const latestUpdate = data.ownerUpdates[0]
  const olderUpdates = data.ownerUpdates.slice(1)
  const nextScheduleItem = data.scheduleItems[0]

  return (
    <main className="min-h-screen bg-[oklch(0.96_0.018_115)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div id="overview" className="scroll-mt-36">
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
            editable={false}
          />
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div id="updates" className="scroll-mt-36 space-y-4">
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

          <aside className="space-y-4">
            <section
              id="schedule"
              className="scroll-mt-36 rounded-lg border bg-background p-5"
            >
              <div className="flex items-center gap-2">
                <IconCalendarStats className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">What happens next</h2>
              </div>
              {data.scheduleItems.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {data.scheduleItems.slice(0, 3).map((item) => (
                    <OwnerScheduleCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                  No upcoming schedule items.
                </p>
              )}
            </section>

            <section
              id="team"
              className="scroll-mt-36 rounded-lg border bg-background p-5"
            >
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
        </section>

        <div id="photos" className="scroll-mt-36">
          <ProjectAudiencePhotoGallery
            photos={data.photos}
            title="Approved Photo Gallery"
            emptyMessage="No photos have been approved for this audience yet."
          />
        </div>
      </div>
    </main>
  )
}

export function ProjectAudiencePreview({
  data,
}: {
  readonly data: ProjectAudiencePreviewData
}): React.ReactElement {
  const label = projectLabel(data)
  const isOwner = data.audience === "owner"
  const selectedProjectLabel = projectOptionLabel({
    id: data.project.id,
    name: data.project.name,
    projectNumber: data.project.projectNumber,
    status: "OPEN",
  })

  if (isOwner) {
    return (
      <ProjectAudiencePreviewShell
        audience={data.audience}
        projectId={data.project.id}
        projectName={data.project.name}
        projectNumber={data.project.projectNumber}
        viewerIsInternal={data.viewerIsInternal}
      >
        <OwnerProjectPreview data={data} />
      </ProjectAudiencePreviewShell>
    )
  }

  return (
    <ProjectAudiencePreviewShell
      audience={data.audience}
      projectId={data.project.id}
      projectName={data.project.name}
      projectNumber={data.project.projectNumber}
      viewerIsInternal={data.viewerIsInternal}
    >
      <main className="min-h-screen bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <section
          id="overview"
          className="scroll-mt-36 rounded-lg border bg-background p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="secondary">Partner project home</Badge>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                {data.project.name}
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {audienceDescription(data.audience)}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.project.name}
              </p>
              {data.project.address && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.project.address}
                </p>
              )}
            </div>
          </div>
        </section>

        {!isOwner && (
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

        {!isOwner && <AudienceMetricStrip data={data} />}

        <section
          id="team"
          className="scroll-mt-36 rounded-lg border bg-background p-4 sm:p-5"
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
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
              No contacts have been approved for this audience yet.
            </p>
          )}
        </section>

        {isOwner && (
          <section className="rounded-lg border bg-background p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <IconClipboardCheck className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Owner Updates</h2>
            </div>
            {data.ownerUpdates.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.ownerUpdates.map((update) => (
                  <article key={update.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(update.updateDate)}</span>
                      {update.publishedAt && (
                        <>
                          <span>&middot;</span>
                          <span>Published</span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-sm font-medium">
                      {update.title}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                      {update.summary}
                    </p>
                    <Link
                      href={
                        `/dashboard/projects/${data.project.id}` +
                        `/owner-updates/${update.id}`
                      }
                      className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <IconExternalLink className="size-3" />
                      Open update
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                No published owner updates are visible to owners yet.
              </p>
            )}
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
          <div
            id="schedule"
            className="scroll-mt-36 rounded-lg border bg-background p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconCalendarStats className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Schedule</h2>
              </div>
              <Badge variant="outline">
                {data.scheduleItems.length} visible
              </Badge>
            </div>
            {data.scheduleItems.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {data.scheduleItems.map((item) => (
                  <ScheduleRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                No upcoming schedule items are currently visible.
              </p>
            )}
          </div>

          <div
            id="commitments"
            className="scroll-mt-36 rounded-lg border bg-background p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconUsers className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">
                  {isOwner ? "Project Contacts" : "Commitments"}
                </h2>
              </div>
              {!isOwner && (
                <Badge variant="outline">{data.operations.length} active</Badge>
              )}
            </div>
            {isOwner ? (
              <div className="mt-4 space-y-3 text-sm">
                {data.project.projectManager && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Project manager
                    </p>
                    <p className="mt-1">{data.project.projectManager}</p>
                  </div>
                )}
                {data.project.clientName && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Owner
                    </p>
                    <p className="mt-1">{data.project.clientName}</p>
                  </div>
                )}
              </div>
            ) : data.operations.length > 0 ? (
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

        {!isOwner && (
          <section className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
            <div
              id="rfis"
              className="scroll-mt-36 rounded-lg border bg-background p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconQuestionMark className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">RFIs</h2>
                </div>
                <Badge variant="outline">{data.rfis.length} visible</Badge>
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

            <div
              id="messages"
              className="scroll-mt-36 rounded-lg border bg-background p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconMessageCircle className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Project Messages</h2>
                </div>
                <Badge variant="outline">
                  {data.messageChannels.length} channels
                </Badge>
              </div>
              {data.messageChannels.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {data.messageChannels.map((channel) => (
                    <MessageChannelRow
                      key={channel.id}
                      channel={channel}
                      previewHref={previewPath(data.project.id, data.audience)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">
                    No project channel yet.
                  </p>
                  <p className="mt-2 text-xs font-medium text-foreground">
                    Message target: {label}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        <div id="photos" className="scroll-mt-36">
          <ProjectAudiencePhotoGallery
            photos={data.photos}
            title="Visible Photos"
            emptyMessage="No photos have been approved for this audience yet."
          />
        </div>
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
