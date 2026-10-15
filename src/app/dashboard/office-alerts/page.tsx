import Link from "next/link"
import {
  IconArrowRight,
  IconClipboardText,
  IconMessageCircleQuestion,
  IconNotebook,
  IconPhoto,
} from "@tabler/icons-react"

import {
  getOfficeAlertQueue,
  type OfficeAlertQueue,
} from "@/app/actions/office-alerts"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"

type AlertQueue = "rfis" | "photos" | "owner-updates" | "daily-logs"

type AlertTab = {
  readonly id: AlertQueue
  readonly label: string
  readonly count: number
  readonly href: string
}

function alertQueueFrom(value: string | undefined): AlertQueue {
  if (value === "photos" || value === "owner-updates" || value === "daily-logs") return value
  return "rfis"
}

function formatDate(value: string | null): string {
  if (!value) return "No date"
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return "No date"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function EmptyQueue({ queue }: { readonly queue: AlertQueue }): React.ReactElement {
  const copy = {
    rfis: "There are no open RFIs across your projects.",
    photos: "There are no field photos waiting for review.",
    "owner-updates": "There are no draft owner updates waiting for review.",
    "daily-logs": "Everyone on staff wrote a daily log on recent work days.",
  }

  return (
    <div className="border-y bg-background px-5 py-14 text-center">
      <p className="text-sm font-medium">This queue is clear</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy[queue]}</p>
    </div>
  )
}

function RfiQueue({ queue }: { readonly queue: OfficeAlertQueue }): React.ReactElement {
  if (queue.rfis.length === 0) return <EmptyQueue queue="rfis" />

  return (
    <div className="divide-y border-y bg-background">
      {queue.rfis.map((rfi) => (
        <Link
          key={rfi.id}
          href={`/dashboard/projects/${rfi.projectId}/rfis`}
          className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{rfi.rfiNumber}</span>
              <Badge variant="outline">{statusLabel(rfi.priority)}</Badge>
              <Badge variant="secondary">{statusLabel(rfi.status)}</Badge>
            </div>
            <p className="mt-1 truncate text-sm">{rfi.subject}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {rfi.projectLabel} · {rfi.projectName}
              {rfi.assignedToName ? ` · Assigned to ${rfi.assignedToName}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground sm:justify-end">
            <span>{rfi.dueDate ? `Due ${formatDate(rfi.dueDate)}` : "No due date"}</span>
            <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      ))}
    </div>
  )
}

function PhotoQueue({ queue }: { readonly queue: OfficeAlertQueue }): React.ReactElement {
  if (queue.photos.length === 0) return <EmptyQueue queue="photos" />

  return (
    <div className="divide-y border-y bg-background">
      {queue.photos.map((photo) => (
        <Link
          key={photo.id}
          href={`/dashboard/projects/${photo.projectId}/photos`}
          className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {photo.caption ?? photo.fileName}
              </span>
              <Badge variant="outline">{statusLabel(photo.photoKind)}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {photo.projectLabel} · {photo.projectName}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground sm:justify-end">
            <span>{formatDate(photo.capturedAt ?? photo.createdAt)}</span>
            <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      ))}
    </div>
  )
}

function OwnerUpdateQueue({
  queue,
}: {
  readonly queue: OfficeAlertQueue
}): React.ReactElement {
  if (queue.ownerUpdates.length === 0) {
    return <EmptyQueue queue="owner-updates" />
  }

  return (
    <div className="divide-y border-y bg-background">
      {queue.ownerUpdates.map((update) => (
        <Link
          key={update.id}
          href={`/dashboard/projects/${update.projectId}/owner-updates/${update.id}`}
          className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{update.title}</span>
              <Badge variant="secondary">Draft</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {update.projectLabel} · {update.projectName}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground sm:justify-end">
            <span>{formatDate(update.updateDate)}</span>
            <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      ))}
    </div>
  )
}

function MissingDailyLogQueue({ queue }: { readonly queue: OfficeAlertQueue }): React.ReactElement {
  if (queue.missingDailyLogs.length === 0) return <EmptyQueue queue="daily-logs" />
  return (
    <div className="space-y-4">
      {queue.missingDailyLogs.map((day) => (
        <section key={day.date} aria-label={formatDate(day.date)} className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {formatDate(day.date)} · {day.people.length} {day.people.length === 1 ? "person" : "people"}
          </h3>
          <ul className="divide-y border-y">
            {day.people.map((person) => (
              <li key={person.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-medium">{person.name}</span>
                <span className="text-xs text-muted-foreground">
                  {person.projectLabel
                    ? `${person.scheduled ? "Scheduled on" : "Last logged on"} ${person.projectLabel}`
                    : "No recent logs"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default async function OfficeAlertsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly queue?: string }>
}): Promise<React.ReactElement> {
  const [{ queue: requestedQueue }, alerts] = await Promise.all([
    searchParams,
    getOfficeAlertQueue(),
  ])
  const activeQueue = alertQueueFrom(requestedQueue)
  const tabs: readonly AlertTab[] = [
    {
      id: "rfis",
      label: "Open RFIs",
      count: alerts.rfis.length,
      href: "/dashboard/office-alerts?queue=rfis",
    },
    {
      id: "photos",
      label: "Photos to review",
      count: alerts.photos.length,
      href: "/dashboard/office-alerts?queue=photos",
    },
    {
      id: "owner-updates",
      label: "Draft owner updates",
      count: alerts.ownerUpdates.length,
      href: "/dashboard/office-alerts?queue=owner-updates",
    },
    {
      id: "daily-logs",
      label: "Missing daily logs",
      count: alerts.missingDailyLogs.reduce((sum, day) => sum + day.people.length, 0),
      href: "/dashboard/office-alerts?queue=daily-logs",
    },
  ]

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-3 sm:p-4 lg:p-5">
      <PageHeader
        className="mb-0 border-b pb-4"
        icon={
          activeQueue === "rfis" ? (
            <IconMessageCircleQuestion className="size-5 text-brand-nutech-gold" />
          ) : activeQueue === "photos" ? (
            <IconPhoto className="size-5 text-brand-compass-blue" />
          ) : activeQueue === "daily-logs" ? (
            <IconNotebook className="size-5 text-brand-hps-field" />
          ) : (
            <IconClipboardText className="size-5 text-brand-hps-field" />
          )
        }
        title="Office alerts"
      />

      <nav className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4" aria-label="Office alert queues">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={activeQueue === tab.id ? "page" : undefined}
            className={cn(
              "flex items-center justify-between gap-3 bg-background px-4 py-3 text-sm transition-colors hover:bg-muted/50",
              activeQueue === tab.id && "bg-muted font-semibold"
            )}
          >
            <span>{tab.label}</span>
            <Badge variant={activeQueue === tab.id ? "default" : "secondary"}>
              {tab.count}
            </Badge>
          </Link>
        ))}
      </nav>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">
            {tabs.find((tab) => tab.id === activeQueue)?.label}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeQueue === "daily-logs"
              ? "Staff with no daily log or duty log entry on the last five work days. Change reminders in Settings → Workflows → Daily logs."
              : "Select an item to open it in the correct project workspace."}
          </p>
        </div>
        {activeQueue === "rfis" ? (
          <RfiQueue queue={alerts} />
        ) : activeQueue === "photos" ? (
          <PhotoQueue queue={alerts} />
        ) : activeQueue === "daily-logs" ? (
          <MissingDailyLogQueue queue={alerts} />
        ) : (
          <OwnerUpdateQueue queue={alerts} />
        )}
      </section>
    </main>
  )
}
