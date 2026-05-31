"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArrowLeft,
  IconCalendarStats,
  IconClipboardText,
  IconExternalLink,
  IconMailForward,
  IconPhoto,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react"

import {
  draftOwnerUpdateFromDailyLogs,
  updateDailyLogReview,
  type ProjectDailyLogItem,
  type ProjectDailyLogWorkspace as ProjectDailyLogWorkspaceData,
} from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { cn } from "@/lib/utils"

type LogFilter = "all" | "needs_review" | "approved" | "owner_visible"

function formatDate(value: string): string {
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

function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
    case "google_daily_log":
      return "Google daily log"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    default:
      return "Compass"
  }
}

function browserHref(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith("https://") || value.startsWith("http://")) return value
  if (value.startsWith("/owner-update-photos/")) return value
  if (value.startsWith("/project-photo-previews/")) return value
  return null
}

function readableJsonItem(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return null

  const company =
    "company" in value && typeof value.company === "string"
      ? value.company
      : null
  const count =
    "count" in value && typeof value.count === "number"
      ? value.count
      : null

  if (company && count !== null) return `${company} (${count})`
  if (company) return company
  return null
}

function readableField(value: string | null): string | null {
  if (value === null || value.length === 0) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const parts = parsed
        .map(readableJsonItem)
        .filter((part): part is string => part !== null && part.length > 0)
      return parts.length > 0 ? parts.join(", ") : value
    }
    return value
  } catch {
    return value
  }
}

function filterValue(value: string): LogFilter {
  switch (value) {
    case "needs_review":
    case "approved":
    case "owner_visible":
      return value
    default:
      return "all"
  }
}

function matchesFilter(log: ProjectDailyLogItem, filter: LogFilter): boolean {
  switch (filter) {
    case "needs_review":
      return log.reviewStatus === "needs_review"
    case "approved":
      return log.reviewStatus === "approved"
    case "owner_visible":
      return log.isClientVisible
    case "all":
      return true
  }
}

function selectedLogIds(
  logs: readonly ProjectDailyLogItem[],
  selectedIds: readonly string[]
): readonly string[] {
  const availableIds = new Set(logs.map((log) => log.id))
  return selectedIds.filter((id) => availableIds.has(id))
}

function LogMetric({
  label,
  value,
  icon,
}: {
  readonly label: string
  readonly value: number
  readonly icon: React.ReactNode
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>{icon}</span>
        <p className="truncate text-xs font-medium uppercase">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">
        {value}
      </p>
    </div>
  )
}

function PhotoStrip({
  log,
}: {
  readonly log: ProjectDailyLogItem
}): React.ReactElement | null {
  if (log.photos.length === 0) return null

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <IconPhoto className="size-3.5" />
        <span>{log.photos.length} photos tied to this log</span>
        <span>&middot;</span>
        <span>
          {log.photos.filter((photo) => photo.ownerVisible).length} owner visible
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {log.photos.slice(0, 6).map((photo) => {
          const href = browserHref(photo.driveUrl)
          return (
            <a
              key={photo.id}
              href={href ?? undefined}
              target={href ? "_blank" : undefined}
              rel={href ? "noreferrer" : undefined}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded-md border bg-muted",
                href ? "cursor-pointer" : "cursor-default"
              )}
            >
              {photo.thumbnailUrl ? (
                <Image
                  src={photo.thumbnailUrl}
                  alt={photo.caption ?? photo.fileName}
                  fill
                  sizes="160px"
                  unoptimized
                  className="object-cover transition-transform group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                  {photo.caption ?? photo.fileName}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-[11px]">
                {photo.ownerVisible ? "Owner visible" : statusLabel(photo.reviewStatus)}
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

export function ProjectDailyLogWorkspace({
  workspace,
}: {
  readonly workspace: ProjectDailyLogWorkspaceData
}): React.ReactElement {
  const router = useRouter()
  const [logs, setLogs] =
    React.useState<readonly ProjectDailyLogItem[]>(workspace.logs)
  const [filter, setFilter] = React.useState<LogFilter>("all")
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const filteredLogs = React.useMemo(
    () => logs.filter((log) => matchesFilter(log, filter)),
    [filter, logs]
  )
  const selectedIdsInView = selectedLogIds(filteredLogs, selectedIds)
  const projectLabel = workspace.project.projectNumber ?? workspace.project.name

  function toggleLog(logId: string): void {
    setSelectedIds((current) =>
      current.includes(logId)
        ? current.filter((id) => id !== logId)
        : [...current, logId]
    )
  }

  function selectVisibleLogs(): void {
    setSelectedIds(filteredLogs.map((log) => log.id))
  }

  function clearSelection(): void {
    setSelectedIds([])
  }

  function updateReview(
    log: ProjectDailyLogItem,
    reviewStatus: string,
    isClientVisible: boolean
  ): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateDailyLogReview(workspace.project.id, {
        dailyLogId: log.id,
        reviewStatus,
        isClientVisible,
      })

      if (result.success) {
        setLogs((current) =>
          current.map((item) =>
            item.id === log.id
              ? {
                  ...item,
                  reviewStatus,
                  isClientVisible,
                }
              : item
          )
        )
        setMessage("Daily log review updated.")
      } else {
        setMessage(result.error)
      }
    })
  }

  function draftOwnerUpdate(): void {
    const dailyLogIds = selectedIdsInView
    setMessage(null)
    startTransition(async () => {
      const result = await draftOwnerUpdateFromDailyLogs(workspace.project.id, {
        dailyLogIds,
      })

      if (result.success) {
        router.push(
          `/dashboard/projects/${workspace.project.id}/owner-updates/${result.updateId}`
        )
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={`/dashboard/projects/${workspace.project.id}`}>
                <IconArrowLeft className="size-4" />
                Project
              </Link>
            </Button>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Daily Logs
            </h1>
            <p className="text-sm text-muted-foreground">
              {projectLabel}
              {workspace.project.clientName
                ? ` · ${workspace.project.clientName}`
                : ""}{" "}
              · Review field notes, attached photos, and owner update readiness.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <ProjectContextSwitcher
              currentProjectId={workspace.project.id}
              targetSection="daily-logs"
              placeholder="Switch daily log project..."
              className="w-full sm:w-[280px]"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${workspace.project.id}/photos`}>
                  <IconPhoto className="size-4" />
                  Photo review
                </Link>
              </Button>
              <Button
                size="sm"
                onClick={draftOwnerUpdate}
                disabled={isPending || selectedIdsInView.length === 0}
              >
                <IconMailForward className="size-4" />
                Draft owner update
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3 lg:grid-cols-6">
          <LogMetric
            label="Logs"
            value={logs.length}
            icon={<IconClipboardText className="size-4" />}
          />
          <LogMetric
            label="Approved"
            value={logs.filter((log) => log.reviewStatus === "approved").length}
            icon={<IconShieldCheck className="size-4" />}
          />
          <LogMetric
            label="Owner visible"
            value={logs.filter((log) => log.isClientVisible).length}
            icon={<IconUsers className="size-4" />}
          />
          <LogMetric
            label="Photos"
            value={workspace.counts.totalPhotos}
            icon={<IconPhoto className="size-4" />}
          />
          <LogMetric
            label="Owner photos"
            value={workspace.counts.ownerVisiblePhotos}
            icon={<IconPhoto className="size-4" />}
          />
          <LogMetric
            label="Review queue"
            value={workspace.counts.photosAwaitingReview}
            icon={<IconShieldCheck className="size-4" />}
          />
        </div>

        <section className="rounded-lg border p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filter}
                onChange={(event) => setFilter(filterValue(event.target.value))}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">All logs</option>
                <option value="needs_review">Needs review</option>
                <option value="approved">Approved</option>
                <option value="owner_visible">Owner visible</option>
              </select>
              <Button variant="outline" size="sm" onClick={selectVisibleLogs}>
                Select visible
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedIdsInView.length} selected · {filteredLogs.length} shown
            </div>
          </div>
          {message && (
            <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {message}
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 gap-3">
          {filteredLogs.map((log) => (
            <section key={log.id} className="rounded-lg border p-3 sm:p-4">
              {(() => {
                const crewPresent = readableField(log.crewPresent)
                const materialsUsed = readableField(log.materialsUsed)

                return (
                  <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(log.id)}
                    onChange={() => toggleLog(log.id)}
                    className="mt-1 size-4 rounded border"
                    aria-label={`Select daily log for ${formatDate(log.logDate)}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {formatDate(log.logDate)}
                      </h2>
                      <Badge variant="outline">
                        {sourceLabel(log.sourceSystem)}
                      </Badge>
                      <Badge
                        variant={
                          log.reviewStatus === "approved"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {statusLabel(log.reviewStatus)}
                      </Badge>
                      {log.isClientVisible && (
                        <Badge variant="outline">Owner visible</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {log.authorName && <span>{log.authorName}</span>}
                      {log.weather && (
                        <>
                          {log.authorName && <span>&middot;</span>}
                          <span>{log.weather}</span>
                        </>
                      )}
                      {crewPresent && (
                        <>
                          <span>&middot;</span>
                          <span>{crewPresent}</span>
                        </>
                      )}
                      {log.hoursWorked !== null && (
                        <>
                          <span>&middot;</span>
                          <span>{log.hoursWorked} hours</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      updateReview(log, "approved", log.isClientVisible)
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant={log.isClientVisible ? "default" : "outline"}
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      updateReview(
                        log,
                        log.reviewStatus === "draft"
                          ? "needs_review"
                          : log.reviewStatus,
                        !log.isClientVisible
                      )
                    }
                  >
                    {log.isClientVisible ? "Owner visible" : "Owner hidden"}
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-sm leading-6">{log.workCompleted}</p>

              {(log.issues ||
                materialsUsed ||
                log.safetyIncidents ||
                log.visitorLog ||
                log.notes) && (
                <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                  {log.issues && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Issues
                      </dt>
                      <dd className="mt-1">{log.issues}</dd>
                    </div>
                  )}
                  {materialsUsed && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Materials
                      </dt>
                      <dd className="mt-1">{materialsUsed}</dd>
                    </div>
                  )}
                  {log.safetyIncidents && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Safety
                      </dt>
                      <dd className="mt-1">{log.safetyIncidents}</dd>
                    </div>
                  )}
                  {log.visitorLog && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Visitors
                      </dt>
                      <dd className="mt-1">{log.visitorLog}</dd>
                    </div>
                  )}
                  {log.notes && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Notes / Next
                      </dt>
                      <dd className="mt-1">{log.notes}</dd>
                    </div>
                  )}
                </dl>
              )}

              {log.tasks.length > 0 && (
                <div className="mt-3 rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <IconCalendarStats className="size-3.5" />
                    Schedule links
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {log.tasks.map((task) => (
                      <div key={task.id} className="rounded-md bg-background p-2">
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(task.startDate)} - {formatDate(task.endDate)}
                          {" · "}
                          {statusLabel(task.status)}
                        </p>
                        {task.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {task.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <PhotoStrip log={log} />
                  </>
                )
              })()}
            </section>
          ))}

          {filteredLogs.length === 0 && (
            <section className="rounded-lg border p-6 text-sm text-muted-foreground">
              No daily logs match this filter yet.
            </section>
          )}
        </div>

        {workspace.unattachedPhotos.length > 0 && (
          <section className="rounded-lg border p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Unattached Photos</h2>
                <p className="text-sm text-muted-foreground">
                  Photos are in the project library but are not tied to a daily
                  log yet.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${workspace.project.id}/photos`}>
                  <IconExternalLink className="size-4" />
                  Review photos
                </Link>
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {workspace.unattachedPhotos.slice(0, 16).map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted"
                >
                  {photo.thumbnailUrl ? (
                    <Image
                      src={photo.thumbnailUrl}
                      alt={photo.caption ?? photo.fileName}
                      fill
                      sizes="140px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                      {photo.caption ?? photo.fileName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
