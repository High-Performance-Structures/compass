import type * as React from "react"
import { getCorrespondenceInbox } from "@/app/actions/project-correspondence"
import { ProjectCorrespondenceWorkspace } from "@/components/correspondence/project-correspondence-workspace"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { getCloudflareContext } from "@/lib/db"
import Link from "next/link"
import {
  IconArrowRight,
  IconExternalLink,
  IconMessageCircle,
  IconQuestionMark,
  IconUsers,
} from "@tabler/icons-react"

import type {
  AudienceMessageChannel,
  AudienceContact,
  AudienceOperationItem,
  AudienceOwnerUpdate,
  AudienceRfi,
  AudienceRfq,
  ProjectAudience,
  ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectAudienceDashboard } from "@/components/projects/project-audience-dashboard"
import { ProjectAudiencePhotoGallery } from "@/components/projects/project-audience-photo-gallery"
import { ProjectAudienceDocumentLibrary } from "@/components/projects/project-audience-document-library"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { ProjectAudiencePurchaseOrderResponseDialog } from "@/components/projects/project-audience-purchase-order-response-dialog"
import { portalPurchaseOrderVendorStatusLabel } from "@/lib/purchase-orders/portal-response"
import { ProjectAudienceRfiCreateDialog } from "@/components/projects/project-audience-rfi-create-dialog"
import { ProjectAudienceRfqResponseDialog } from "@/components/projects/project-audience-rfq-response-dialog"
import { ProjectAudienceSchedule } from "@/components/projects/project-audience-schedule"
import {
  ownerUpdatePreviewHref,
  projectAudienceConversationHref,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"
import {
  projectAudienceMessageShortcut,
  type ProjectAudienceMessageRecipient,
} from "@/lib/project-audience-direct-message"

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
  projectId,
  recipients,
  viewerIsInternal,
}: {
  readonly item: AudienceOperationItem
  readonly projectId: string
  readonly recipients: readonly ProjectAudienceMessageRecipient[]
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  return (
    <div id={`commitment-${item.id}`} className="scroll-mt-24 rounded-md border bg-background p-3">
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
        <div className="flex flex-wrap items-center gap-2">
          {item.acknowledgement && (
            <Badge variant="outline">Acknowledged</Badge>
          )}
          {item.latestVendorStatus && (
            <Badge variant="outline">
              Vendor: {portalPurchaseOrderVendorStatusLabel(item.latestVendorStatus.status)}
            </Badge>
          )}
          <Badge variant="secondary">{statusLabel(item.status)}</Badge>
        </div>
      </div>
      {item.description && (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          {item.description}
        </p>
      )}
      {item.latestVendorStatus && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last vendor update by {item.latestVendorStatus.responderName}
          {item.latestVendorStatus.note
            ? ` · ${item.latestVendorStatus.note}`
            : ""}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {formatDate(item.startDate)}
        {" - "}
        {formatDate(item.dueDate)}
      </p>
      {item.sourceRecordType === "purchase_order" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-sm font-medium">{formatMoney(item.amount)}</span>
          <ProjectAudiencePurchaseOrderResponseDialog
            projectId={projectId}
            purchaseOrderId={item.id}
            purchaseOrderLabel={item.sourceRecordNumber ?? item.title}
            status={item.status}
            acknowledgement={item.acknowledgement}
            latestStatus={item.latestVendorStatus}
            recipients={recipients}
            viewerIsInternal={viewerIsInternal}
          />
        </div>
      )}
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
    <article id={`rfi-${item.id}`} className="scroll-mt-24 rounded-md border bg-background p-3">
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
            scopeItems={item.scopeItems}
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
          {item.vendorResponse.lines.length > 0 && (
            <div className="mt-3 overflow-hidden border bg-background">
              {item.vendorResponse.lines.map((line) => (
                <div
                  key={`${item.id}-submitted-line-${line.lineNumber}`}
                  className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">
                      {line.lineNumber}.{" "}
                      {item.scopeItems.find(
                        (scope) => scope.lineNumber === line.lineNumber
                      )?.description ?? "RFQ scope"}
                    </p>
                    {line.notes && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.notes}
                      </p>
                    )}
                  </div>
                  <span className="font-medium">{formatMoney(line.amount)}</span>
                </div>
              ))}
            </div>
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

async function AudienceConversationSection({
  data,
}: {
  readonly data: ProjectAudiencePreviewData
}): Promise<React.ReactElement> {
  const { env } = await getCloudflareContext()
  if (isCorrespondenceEnabled(data.project.id, env) || isCorrespondenceEnabled(data.project.id)) {
    const inbox = await getCorrespondenceInbox(data.project.id)
    return <section id="messages" className="min-w-0">
      {data.viewerIsInternal && <p className="mb-3 text-sm text-muted-foreground">This is your staff inbox. A participant's historical access must be reviewed separately before activation.</p>}
      {inbox.success ? <ProjectCorrespondenceWorkspace projectId={data.project.id} initialInbox={inbox.data} /> : <p className="p-4 text-sm">Messages are unavailable. {inbox.error}</p>}
      {data.messageChannels.length > 0 && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm">Earlier Compass conversations</summary><div className="mt-3 grid gap-3">{data.messageChannels.map((channel) => <MessageChannelRow key={channel.id} channel={channel} projectId={data.project.id} audience={data.audience} />)}</div></details>}
    </section>
  }
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

function OwnerProjectPreview({
  data,
  section,
}: {
  readonly data: ProjectAudiencePreviewData
  readonly section: ProjectAudienceWorkspaceSection
}): React.ReactElement {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {section === "updates" && (
          <section className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Project story</p>
              <h1 className="text-xl font-semibold">Recent updates</h1>
            </div>
            {data.ownerUpdates.length > 0 ? data.ownerUpdates.map((update, index) => (
              <OwnerUpdateCard key={update.id} projectId={data.project.id} update={update} featured={index === 0} />
            )) : (
              <p className="rounded-lg border bg-background p-5 text-sm text-muted-foreground">No published owner updates are visible yet.</p>
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
          audienceLabel="Client schedule"
          items={data.scheduleItems}
          publicationAvailable={data.schedulePublicationAvailable}
          projectId={data.project.id}
          projectName={data.project.name}
          projectNumber={data.project.projectNumber}
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

        {section === "documents" && (
          <ProjectAudienceDocumentLibrary
            projectId={data.project.id}
            documents={data.documents}
          />
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
  const isOwner = data.audience === "owner"
  const messageShortcut = projectAudienceMessageShortcut({
    projectId: data.project.id,
    audience: data.audience,
    viewerId: data.viewer.id,
    contacts: data.contacts,
    messageChannels: data.messageChannels,
  })

  if (section === "overview") {
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
        <ProjectAudienceDashboard data={data} messageShortcut={messageShortcut} />
      </ProjectAudiencePreviewShell>
    )
  }

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
        {section === "team" && (
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
          <ProjectAudienceSchedule
            audienceLabel="Sub/vendor schedule"
            items={data.scheduleItems}
            publicationAvailable={data.schedulePublicationAvailable}
            projectId={data.project.id}
            projectName={data.project.name}
            projectNumber={data.project.projectNumber}
          />
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
              <Badge variant="outline">{data.operations.length} assigned</Badge>
            </div>
            {data.operations.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {data.operations.map((item) => (
                  <OperationRow
                    key={item.id}
                    item={item}
                    projectId={data.project.id}
                    recipients={messageShortcut?.recipients ?? []}
                    viewerIsInternal={data.viewerIsInternal}
                  />
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

        {section === "documents" && (
          <ProjectAudienceDocumentLibrary
            projectId={data.project.id}
            documents={data.documents}
          />
        )}
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
