import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconCalendarStats,
  IconClipboardCheck,
  IconExternalLink,
  IconFolder,
  IconMessageCircle,
  IconPhoto,
  IconQuestionMark,
  IconUsers,
} from "@tabler/icons-react"

import type {
  AudienceMessageChannel,
  AudienceContact,
  AudienceOperationItem,
  AudienceProjectOption,
  AudienceRfi,
  AudienceScheduleItem,
  ProjectAudience,
  ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OwnerUpdatePhotoTile } from "@/components/projects/owner-update-photo-tile"

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

function audienceLabel(value: ProjectAudience): string {
  return value === "owner" ? "Owner Preview" : "Sub/Vendor Preview"
}

function audienceDescription(value: ProjectAudience): string {
  return value === "owner"
    ? "This is the owner-facing project view based on approved updates, schedule items, and owner-visible photos."
    : "This is the sub/vendor-facing project view based on visible commitments, schedule items, and approved sub/vendor photos."
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
    ? `/dashboard/projects/${projectId}/preview/owner`
    : `/dashboard/projects/${projectId}/preview/sub-vendor`
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
            {item.sourceRecordNumber
              ? `Sage ${item.sourceRecordNumber}`
              : "Compass/Sage commitment"}
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

function ProjectOptionRow({
  audience,
  currentProjectId,
  project,
}: {
  readonly audience: ProjectAudience
  readonly currentProjectId: string
  readonly project: AudienceProjectOption
}): React.ReactElement {
  const active = project.id === currentProjectId

  return (
    <Link
      href={previewPath(project.id, audience)}
      className={`block rounded-md border px-3 py-2 text-sm transition-colors ${
        active ? "border-primary bg-primary/10" : "bg-background hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="line-clamp-1 font-medium">
          {project.projectNumber ?? project.name}
        </span>
        <Badge variant={active ? "default" : "outline"}>
          {active ? "Current" : project.status}
        </Badge>
      </div>
      {project.projectNumber && (
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {project.name}
        </p>
      )}
    </Link>
  )
}

function RfiRow({
  item,
}: {
  readonly item: AudienceRfi
}): React.ReactElement {
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
          <Badge variant={item.status === "open" ? "secondary" : "outline"}>
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
}: {
  readonly channel: AudienceMessageChannel
}): React.ReactElement {
  return (
    <Link
      href={`/dashboard/conversations/${channel.id}`}
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

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/projects/${data.project.id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              variant={isOwner ? "default" : "outline"}
              size="sm"
            >
              <Link href={`/dashboard/projects/${data.project.id}/preview/owner`}>
                Owner
              </Link>
            </Button>
            <Button
              asChild
              variant={isOwner ? "outline" : "default"}
              size="sm"
            >
              <Link
                href={`/dashboard/projects/${data.project.id}/preview/sub-vendor`}
              >
                Sub/vendor
              </Link>
            </Button>
          </div>
        </div>

        <section className="rounded-lg border bg-background p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="secondary">Internal preview</Badge>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                {audienceLabel(data.audience)}
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

        <section className="rounded-lg border bg-background p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md border bg-muted/30 p-2">
                <IconFolder className="size-4 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">
                  Current project context
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Actions in this view apply to {selectedProjectLabel}.
                </p>
              </div>
            </div>
            <Badge variant="secondary">{label}</Badge>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.projectOptions.map((project) => (
              <ProjectOptionRow
                key={project.id}
                audience={data.audience}
                currentProjectId={data.project.id}
                project={project}
              />
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-background p-4 sm:p-5">
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
          <div className="rounded-lg border bg-background p-4 sm:p-5">
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

          <div className="rounded-lg border bg-background p-4 sm:p-5">
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
            <div className="rounded-lg border bg-background p-4 sm:p-5">
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

            <div className="rounded-lg border bg-background p-4 sm:p-5">
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
                    <MessageChannelRow key={channel.id} channel={channel} />
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">
                    Project-scoped messaging is ready to connect when the
                    project channel is created.
                  </p>
                  <p className="mt-2 text-xs font-medium text-foreground">
                    Message target: {label}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="rounded-lg border bg-background p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconPhoto className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Visible Photos</h2>
            </div>
            <Badge variant="outline">{data.photos.length} photos</Badge>
          </div>
          {data.photos.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.photos.map((photo) => (
                <OwnerUpdatePhotoTile
                  key={photo.id}
                  fileName={photo.fileName}
                  driveUrl={photo.driveUrl}
                  thumbnailUrl={photo.thumbnailUrl}
                  caption={photo.caption}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
              No photos have been approved for this audience yet.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
