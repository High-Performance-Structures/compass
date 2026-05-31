import type * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconCamera,
  IconClipboardText,
  IconEye,
  IconExternalLink,
  IconPhotoCheck,
  IconSend,
} from "@tabler/icons-react"

import type { ProjectFieldSummary } from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"

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
    case "google_daily_log":
      return "Google daily log"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    case "buildertrend":
      return "Buildertrend"
    default:
      return "Compass"
  }
}

function browserHref(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith("https://") || value.startsWith("http://")) return value
  if (value.startsWith("/owner-update-photos/")) return value
  return null
}

function SummaryMetric({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly value: number
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
    </div>
  )
}

export function ProjectFieldPanel({
  projectId,
  summary,
}: {
  readonly projectId: string
  readonly summary: ProjectFieldSummary | null
}): React.ReactElement {
  if (!summary) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconClipboardText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Field Updates</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Field update details are unavailable for this project.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconClipboardText className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Field Updates</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Daily logs, photo review, and owner-facing update readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              summary.photosAwaitingReviewCount > 0 ? "secondary" : "outline"
            }
          >
            {summary.photosAwaitingReviewCount} photos to review
          </Badge>
          <Link
            href={`/dashboard/projects/${projectId}/daily-logs`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <IconClipboardText className="size-4" />
            Open daily logs
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryMetric
          icon={<IconClipboardText className="size-4" />}
          label="Daily logs"
          value={summary.dailyLogCount}
        />
        <SummaryMetric
          icon={<IconCamera className="size-4" />}
          label="Photos"
          value={summary.photoCount}
        />
        <SummaryMetric
          icon={<IconEye className="size-4" />}
          label="Owner visible"
          value={summary.ownerVisiblePhotoCount}
        />
        <SummaryMetric
          icon={<IconSend className="size-4" />}
          label="Owner updates"
          value={summary.ownerUpdateCount}
        />
      </div>

      {summary.photoReviewFolder && (
        <div className="mt-4 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Buildertrend review photos
              </p>
              <p className="mt-1 text-sm">
                {summary.photoReviewFolder.label}
                {summary.photoReviewFolder.photoCount !== null
                  ? ` · ${summary.photoReviewFolder.photoCount} photos`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/dashboard/projects/${projectId}/photos`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <IconCamera className="size-4" />
                Review in Compass
              </Link>
              <a
                href={summary.photoReviewFolder.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <IconExternalLink className="size-4" />
                Open Drive
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Latest daily log
            </p>
            <Badge variant="outline">
              {summary.approvedDailyLogCount} approved
            </Badge>
          </div>
          {summary.latestDailyLog ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDate(summary.latestDailyLog.logDate)}</span>
                <span>&middot;</span>
                <span>{sourceLabel(summary.latestDailyLog.sourceSystem)}</span>
                <span>&middot;</span>
                <span>{statusLabel(summary.latestDailyLog.reviewStatus)}</span>
                {summary.latestDailyLog.authorName && (
                  <>
                    <span>&middot;</span>
                    <span>{summary.latestDailyLog.authorName}</span>
                  </>
                )}
              </div>
              <p className="line-clamp-3 text-sm">
                {summary.latestDailyLog.workCompleted}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No daily logs have been imported or created yet.
            </p>
          )}
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Owner update
            </p>
            <Badge variant="outline">
              {summary.draftOwnerUpdateCount} draft
            </Badge>
          </div>
          {summary.latestOwnerUpdate ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDate(summary.latestOwnerUpdate.updateDate)}</span>
                <span>&middot;</span>
                <span>{statusLabel(summary.latestOwnerUpdate.status)}</span>
                <span>&middot;</span>
                <span>{summary.latestOwnerUpdate.channel}</span>
              </div>
              <p className="text-sm font-medium">
                {summary.latestOwnerUpdate.title}
              </p>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {summary.latestOwnerUpdate.summary}
              </p>
              <Link
                href={`/dashboard/projects/${projectId}/owner-updates/${summary.latestOwnerUpdate.id}`}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <IconExternalLink className="size-3.5" />
                Preview update
              </Link>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <IconPhotoCheck className="mt-0.5 size-4 shrink-0" />
              <p>
                Approved daily logs and reviewed photos will feed the first
                owner update draft here.
              </p>
            </div>
          )}
          {summary.nextScheduleItem && (
            <div className="mt-3 rounded-md border bg-muted/30 p-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Next schedule item
              </p>
              <p className="mt-1 line-clamp-1 text-sm font-medium">
                {summary.nextScheduleItem.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(summary.nextScheduleItem.startDate)}
                {" - "}
                {formatDate(summary.nextScheduleItem.endDate)}
                {summary.nextScheduleItem.assignedTo
                  ? ` · ${summary.nextScheduleItem.assignedTo}`
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {summary.latestPhotos.length > 0 && (
        <div className="mt-4 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Recent project photos
            </p>
            <Badge variant="outline">
              {summary.ownerVisiblePhotoCount} owner visible
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {summary.latestPhotos.map((photo) => {
              const href = browserHref(photo.driveUrl)

              return (
                <div
                  key={photo.id}
                  className="flex min-w-0 items-start justify-between gap-3 rounded-md border p-2"
                >
                  <div className="flex min-w-0 gap-3">
                    {photo.thumbnailUrl && (
                      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                        <Image
                          src={photo.thumbnailUrl}
                          alt={photo.caption ?? photo.fileName}
                          fill
                          sizes="80px"
                          unoptimized
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {photo.caption ?? photo.fileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{sourceLabel(photo.sourceSystem)}</span>
                        <span>&middot;</span>
                        <span>{statusLabel(photo.reviewStatus)}</span>
                        {photo.ownerVisible && (
                          <>
                            <span>&middot;</span>
                            <span>Owner visible</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`Open ${photo.fileName}`}
                    >
                      <IconExternalLink className="size-4" />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
