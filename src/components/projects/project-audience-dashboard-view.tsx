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
}: {
  readonly data: ProjectAudiencePreview
  readonly financials: AudienceDashboardFinancials
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
  readonly today: string
  readonly selectionSummary?: SelectionDashboardSummary
  readonly greeting: string
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
  const quickLinks: readonly {
    readonly label: string
    readonly section: ProjectAudienceWorkspaceSection
    readonly icon: React.ReactElement
  }[] = [
    {
      label: owner ? "Selections & Decisions" : "Approved selections",
      section: "selections",
      icon: <IconFileText className="size-4" />,
    },
    ...(owner
      ? ([
          {
            label: "Budget / G703",
            section: "budget",
            icon: <IconFileDollar className="size-4" />,
          },
          {
            label: "Owner updates",
            section: "updates",
            icon: <IconFileText className="size-4" />,
          },
        ] satisfies readonly {
          readonly label: string
          readonly section: ProjectAudienceWorkspaceSection
          readonly icon: React.ReactElement
        }[])
      : ([
          {
            label: "Respond to RFQs",
            section: "rfqs",
            icon: <IconFileDollar className="size-4" />,
          },
          {
            label: "Commitments",
            section: "commitments",
            icon: <IconFileText className="size-4" />,
          },
          {
            label: "RFIs & answers",
            section: "rfis",
            icon: <IconFileText className="size-4" />,
          },
        ] satisfies readonly {
          readonly label: string
          readonly section: ProjectAudienceWorkspaceSection
          readonly icon: React.ReactElement
        }[])),
    {
      label: "Change requests",
      section: "change-orders",
      icon: <IconFileText className="size-4" />,
    },
    {
      label: "Project documents",
      section: "documents",
      icon: <IconFolder className="size-4" />,
    },
    {
      label: "Project photos",
      section: "photos",
      icon: <IconPhoto className="size-4" />,
    },
    ...(owner && data.project.warrantyEnabled
      ? ([
          {
            label: "Warranty requests",
            section: "warranty",
            icon: <IconShieldCheck className="size-4" />,
          },
        ] satisfies readonly {
          readonly label: string
          readonly section: ProjectAudienceWorkspaceSection
          readonly icon: React.ReactElement
        }[])
      : []),
  ]
  return (
    <main
      className="min-h-screen bg-background"
      aria-label={owner ? "Owner dashboard" : "Partner dashboard"}
    >
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-sm font-semibold">Your project launchpad</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {owner
                ? "Your home, your team, and what comes next"
                : "Your scope, your schedule, and your project team"}
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

        <div className="-mt-px">
          <ProjectCommunicationInstructions
            projectId={data.project.id}
            projectNumber={data.project.projectNumber}
            textPhoneNumber={data.project.textPhoneNumber}
            compact
          />
        </div>

        <section
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b py-4 text-xs"
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

        <div className="grid gap-5 border-b py-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.42fr)]">
          <section
            className="grid min-h-64 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
            aria-label="Project greeting"
          >
            <ProjectAudienceDashboardPhoto
              key={`${data.project.id}:${route}:${photos.map((photo) => `${photo.id}:${photo.src}`).join("|")}`}
              photos={photos}
            />
            <div className="flex min-w-0 flex-col justify-center py-6 pl-2 pr-1 sm:pl-4">
              <p className="text-xs text-primary">
                {new Intl.DateTimeFormat("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${today}T12:00:00Z`))}
              </p>
              <h1 className="mt-3 font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
                {greeting}, <span className="block italic">{firstName}</span>
              </h1>
              <span className="my-4 h-px w-7 bg-primary" />
              <p className="text-sm leading-relaxed text-muted-foreground">
                Here is what needs your attention{" "}
                {owner ? "on your project" : "for your work"} today.
              </p>
              <Link
                href={href("photos")}
                className="mt-4 text-xs text-primary hover:underline"
              >
                View project photos →
              </Link>
            </div>
          </section>

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

        <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
          <div>
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
            className="grid gap-6 border-t pt-5 sm:grid-cols-2 lg:col-span-2 2xl:col-span-1 2xl:block 2xl:border-t-0 2xl:border-l 2xl:pt-0 2xl:pl-5"
            aria-label="Workspace shortcuts"
          >
            <section>
              <h2 className="mb-3 text-sm font-semibold">Workspace alerts</h2>
              {model.alerts.map((alert) => (
                <Link
                  key={alert.title}
                  href={alert.href}
                  className="flex justify-between gap-3 border-t py-3 text-xs hover:text-primary"
                >
                  <span>{alert.title}</span>
                  <span className="text-primary tabular-nums">
                    {alert.count} ›
                  </span>
                </Link>
              ))}
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
            <section className="2xl:mt-6">
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
