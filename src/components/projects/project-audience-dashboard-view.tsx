import type * as React from "react"
import type { SelectionDashboardSummary } from "@/lib/selections/dashboard"
import Link from "next/link"
import {
  IconArrowRight,
  IconCalendar,
  IconFileDollar,
  IconFileText,
  IconFolder,
  IconPhoto,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react"

import type { ProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { ProjectAudienceDashboardPhoto } from "@/components/projects/project-audience-dashboard-photo"
import { DashboardCountsStrip, type DashboardCount } from "@/components/dashboard/dashboard-counts-strip"
import { audienceQuickLinks } from "@/lib/project-audience-links"
import { ProjectAudienceRfiCreateDialog } from "@/components/projects/project-audience-rfi-create-dialog"
import { ProjectCommunicationInstructions } from "@/components/projects/project-email-address-card"
import { resolvePhotoImageSource } from "@/lib/photo-sources"
import {
  audienceDashboardDateLabel,
  audienceDashboardHorizon,
  audienceDashboardModel,
  type AudienceDashboardFinancials,
  type AudienceDashboardLink,
} from "@/lib/project-audience-dashboard"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import {
  ownerUpdatePreviewHref,
  projectAudienceSectionHref,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"
import { cn, getInitials } from "@/lib/utils"

function PriorityRow({
  item,
  today,
}: {
  readonly item: AudienceDashboardLink
  readonly today: string
}): React.ReactElement {
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 border-t py-4 text-sm hover:bg-muted/30"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-sm border group-hover:border-primary">
        <IconArrowRight className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{item.title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {item.detail}
        </span>
      </span>
      <span className="max-w-28 shrink-0 text-right text-xs text-brand-nutech-gold-foreground dark:text-brand-nutech-gold">
        {item.dueDate
          ? `${item.dueDate < today ? "Overdue · " : ""}${audienceDashboardDateLabel(item.dueDate)}`
          : item.label}
      </span>
    </Link>
  )
}

export function ProjectAudienceDashboardView({
  data,
  financials,
  messageShortcut,
  today,
  greeting,
  selectionSummary = { kind: "unavailable" },
  mapSection = null,
}: {
  readonly data: ProjectAudiencePreview
  readonly financials: AudienceDashboardFinancials
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
  readonly today: string
  readonly selectionSummary?: SelectionDashboardSummary
  readonly greeting: string
  /** Owner relief or sub/vendor "Your jobs" map, shown under the header. */
  readonly mapSection?: React.ReactNode
}): React.ReactElement {
  const owner = data.audience === "owner"
  const route = owner ? "owner" : "sub-vendor"
  const href = (section: ProjectAudienceWorkspaceSection): string =>
    projectAudienceSectionHref(data.project.id, route, section)
  const model = audienceDashboardModel(data, financials, today)
  const horizon = audienceDashboardHorizon(data.scheduleItems, today)
  const firstName = data.viewer.name.trim().split(/\s+/)[0] || "there"
  const latestUpdate = data.ownerUpdates[0]
  const recentAnswer = owner
    ? null
    : model.recent.find((item) => item.id.startsWith("rfi-"))
  const photos = data.photos
    .toSorted((a, b) => b.photoDate.localeCompare(a.photoDate))
    .flatMap((photo) => {
      const source = resolvePhotoImageSource(photo).src
      return source
        ? [{ id: photo.id, src: source, alt: photo.caption ?? photo.fileName }]
        : []
    })
    .slice(0, 6)
  // Up to four workspace alerts, shown like the office dashboard's counts.
  const counts: readonly DashboardCount[] = model.alerts.slice(0, 4).map((alert) => ({
    label: alert.title,
    value: alert.count,
    href: alert.href,
    urgent: false,
  }))
  // Same permitted sections as the map panel (lib/project-audience-links).
  const QUICK_LINK_ICONS: Partial<Record<ProjectAudienceWorkspaceSection, React.ReactElement>> = {
    budget: <IconFileDollar className="size-4" />,
    rfqs: <IconFileDollar className="size-4" />,
    documents: <IconFolder className="size-4" />,
    photos: <IconPhoto className="size-4" />,
    warranty: <IconShieldCheck className="size-4" />,
  }
  const quickLinks = audienceQuickLinks({ owner, warrantyEnabled: data.project.warrantyEnabled }).map((link) => ({
    ...link,
    icon: QUICK_LINK_ICONS[link.section] ?? <IconFileText className="size-4" />,
  }))
  return (
    <main
      className="min-h-screen bg-background"
      aria-label={owner ? "Owner dashboard" : "Partner dashboard"}
    >
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        {/* Same anatomy as the office dashboard: greeting, counts, map, then work. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">
              {new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${today}T12:00:00Z`))}
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              {greeting}, <span className="italic text-primary">{firstName}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.project.projectNumber ? `${data.project.projectNumber} · ` : ""}
              {data.project.name}
            </p>
          </div>
          {!owner && (
            <ProjectAudienceRfiCreateDialog
              projectId={data.project.id}
              recipients={messageShortcut?.recipients ?? []}
              viewerIsInternal={data.viewerIsInternal}
            />
          )}
        </div>

        {counts.length > 0 ? (
          <div className="mt-5">
            <DashboardCountsStrip counts={counts} />
          </div>
        ) : null}

        {mapSection}

        <div className="border-y">
          <section className="min-w-0 py-4" aria-label="Five-day horizon">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <IconCalendar className="size-4 text-primary" />
                  Five-day horizon
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {owner
                    ? "Published milestones and upcoming work"
                    : "Your work and upcoming milestones"}{" "}
                  · Mountain time
                </p>
              </div>
              <Link
                href={href("schedule")}
                className="text-xs text-primary hover:underline"
              >
                Full schedule →
              </Link>
            </div>
            {!data.schedulePublicationAvailable &&
            data.scheduleItems.length === 0 ? (
              <p className="border-t py-5 text-sm text-muted-foreground">
                Your project team has not published a schedule yet.
              </p>
            ) : (
              <div className="grid border-t sm:grid-cols-5">
                {horizon.map((day, index) => (
                  <div
                    key={day.date}
                    className={cn(
                      "grid grid-cols-[5rem_minmax(0,1fr)] gap-3 border-b p-3 sm:block sm:min-h-44 sm:border-r sm:border-b-0 sm:last:border-r-0",
                      index === 0 && "bg-primary/5"
                    )}
                  >
                    <div>
                      <p className="text-xs uppercase">
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${day.date}T12:00:00Z`))}
                        {index === 0 && (
                          <span className="ml-1 text-primary">Today</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs font-medium">
                        {audienceDashboardDateLabel(day.date)}
                      </p>
                    </div>
                    <div className="space-y-3 sm:mt-5">
                      {day.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No scheduled work
                        </p>
                      ) : (
                        day.items.slice(0, 2).map((item) => (
                          <Link
                            key={item.id}
                            href={href("schedule")}
                            className="block border-l border-primary/60 pl-2 text-xs hover:text-primary"
                          >
                            <span className="block break-words">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              {item.isMilestone
                                ? "Milestone"
                                : item.percentComplete > 0
                                  ? "In progress"
                                  : "Scheduled"}
                            </span>
                          </Link>
                        ))
                      )}
                      {day.items.length > 2 && (
                        <Link
                          href={href("schedule")}
                          className="block text-xs text-primary"
                        >
                          +{day.items.length - 2} more →
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <div className="lg:row-span-2">
            {owner && (
              <section
                aria-label="Selection decisions"
                className="mb-6 border-b pb-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">
                    Selections & Decisions
                  </h2>
                  <Link
                    href={href("selections")}
                    className="text-xs text-primary"
                  >
                    All selections →
                  </Link>
                </div>
                {selectionSummary.kind === "available" ? (
                  <>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {selectionSummary.awaitingApproval} ready for your
                      approval · {selectionSummary.awaitingTeam} awaiting team
                      response
                    </p>
                    {selectionSummary.items.map((item) => (
                      <Link
                        key={item.id}
                        href={`${href("selections")}#selection-${encodeURIComponent(item.id)}`}
                        className="mt-3 flex justify-between gap-3 text-sm"
                      >
                        <span>
                          {item.roomName} · {item.name}
                        </span>
                        <span className="text-xs text-primary">
                          {item.dueDate ?? "Review"}
                        </span>
                      </Link>
                    ))}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selection counts are unavailable. Open selections to review
                    your decisions.
                  </p>
                )}
              </section>
            )}
            <section aria-label="Your priorities">
              <h2 className="text-sm font-semibold">Your priorities</h2>
              <p className="mt-1 mb-4 text-xs text-muted-foreground">
                Responses and reviews needing your attention
              </p>
              {model.priorities.length === 0 ? (
                <p className="border-t py-5 text-sm text-muted-foreground">
                  No pending responses in the available project records.
                </p>
              ) : (
                model.priorities
                  .slice(0, 6)
                  .map((item) => (
                    <PriorityRow key={item.id} item={item} today={today} />
                  ))
              )}
              {model.priorities.length > 6 && (
                <details className="border-t">
                  <summary className="cursor-pointer py-3 text-xs text-primary">
                    Show {model.priorities.length - 6} more responses
                  </summary>
                  {model.priorities.slice(6).map((item) => (
                    <PriorityRow key={item.id} item={item} today={today} />
                  ))}
                </details>
              )}
              {model.recent.length > 0 && (
                <>
                  <h3 className="mt-5 mb-3 text-xs font-medium text-muted-foreground">
                    Keep up with your project
                  </h3>
                  {model.recent.map((item) => (
                    <PriorityRow key={item.id} item={item} today={today} />
                  ))}
                </>
              )}
            </section>
          </div>

          <section
            className="lg:border-l lg:pl-5"
            aria-label="Your project team"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <IconUsers className="size-4" />
              Your project team
            </h2>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              The right people, close at hand
            </p>
            {data.contacts.slice(0, 4).map((contact) => (
              <div
                key={contact.id}
                className="flex items-start gap-3 border-t py-4"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">
                  {getInitials(contact.displayName)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{contact.displayName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[contact.role ?? contact.trade, contact.companyName]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="mt-1 block text-xs text-primary hover:underline"
                    >
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="mt-1 block break-all text-xs text-primary hover:underline"
                    >
                      {contact.email}
                    </a>
                  )}
                </div>
              </div>
            ))}
            {data.contacts.length === 0 && (
              <p className="border-t py-4 text-sm text-muted-foreground">
                {data.project.projectManager
                  ? `Project manager: ${data.project.projectManager}`
                  : "Your project team’s contact details will appear here."}
              </p>
            )}
            <Link
              className="text-xs text-primary hover:underline"
              href={href("team")}
            >
              All contacts →
            </Link>
          </section>

          <aside
            className="flex flex-col gap-6 border-t pt-5 lg:col-start-2 lg:border-l lg:pl-5"
            aria-label="Workspace shortcuts"
          >
            <section>
              {(financials.changeOrders === null ||
                (owner && financials.applications === null)) && (
                <p className="py-3 text-xs text-muted-foreground" role="status">
                  Some summaries could not be loaded. Open{" "}
                  {financials.changeOrders === null && (
                    <Link
                      href={href("change-orders")}
                      className="text-primary underline"
                    >
                      change orders
                    </Link>
                  )}
                  {financials.changeOrders === null &&
                    owner &&
                    financials.applications === null &&
                    " or "}
                  {owner && financials.applications === null && (
                    <Link
                      href={href("budget")}
                      className="text-primary underline"
                    >
                      Budget / G703
                    </Link>
                  )}{" "}
                  to retry.
                </p>
              )}
            </section>
            <section>
              <h2 className="mb-3 text-sm font-semibold">Quick dock</h2>
              {quickLinks.map((link) => (
                <Link
                  key={link.section}
                  href={href(link.section)}
                  className="flex items-center gap-2 border-t py-3 text-xs hover:text-primary"
                >
                  {link.icon}
                  <span className="flex-1">{link.label}</span>
                  <IconArrowRight className="size-3.5 text-primary" />
                </Link>
              ))}
            </section>
          </aside>
        </div>
        <section aria-label="From the site" className="grid gap-5 border-t py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <section
            className="min-h-56"
            aria-label="Project photos"
          >
            <ProjectAudienceDashboardPhoto
              key={`${data.project.id}:${route}:${photos.map((photo) => `${photo.id}:${photo.src}`).join("|")}`}
              photos={photos}
            />
          </section>
          <div className="flex min-w-0 flex-col">
        <section
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-4 text-xs"
          aria-label={owner ? "Latest owner update" : "Project activity"}
        >
          <span className="font-medium uppercase tracking-wide text-primary">
            {owner ? "Latest update" : "Project activity"}
          </span>
          <p className="min-w-0 flex-1 basis-48">
            {owner
              ? (latestUpdate?.title ??
                "Your project team’s published updates will appear here.")
              : (recentAnswer?.title ??
                "Keep questions, quotes, and commitments moving with your project team.")}
          </p>
          <Link
            className="text-primary hover:underline"
            href={
              owner && latestUpdate
                ? ownerUpdatePreviewHref(data.project.id, latestUpdate.id)
                : (recentAnswer?.href ??
                  href(owner ? "updates" : "conversations"))
            }
          >
            {owner
              ? "View updates"
              : recentAnswer
                ? "Read response"
                : "Conversations"}{" "}
            →
          </Link>
        </section>

        <div className="-mt-px">
          <ProjectCommunicationInstructions
            projectId={data.project.id}
            projectNumber={data.project.projectNumber}
            textPhoneNumber={data.project.textPhoneNumber}
            compact
          />
        </div>

          </div>
        </section>

        <footer className="border-t pt-4">
          <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {data.project.projectNumber
                ? `${data.project.projectNumber} · `
                : ""}
              {data.project.name}
            </span>
            <span>
              {owner ? "Owner workspace" : "Sub / supplier workspace"}
            </span>
          </div>
        </footer>
      </div>
    </main>
  )
}
