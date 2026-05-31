import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconCalendarStats,
  IconMail,
  IconPhoto,
  IconPhotoUp,
} from "@tabler/icons-react"

import type { OwnerProjectUpdateDocument } from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OwnerUpdateActions } from "@/components/projects/owner-update-actions"
import { OwnerUpdatePhotoTile } from "@/components/projects/owner-update-photo-tile"

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function projectLabel(document: OwnerProjectUpdateDocument): string {
  return document.project.projectNumber ?? document.project.name
}

export function OwnerUpdateDocument({
  document,
}: {
  readonly document: OwnerProjectUpdateDocument
}): React.ReactElement {
  const label = projectLabel(document)
  const updateUrl =
    `/dashboard/projects/${document.project.id}` +
    `/owner-updates/${document.update.id}`
  const emailSubject = `${label} - ${document.update.title}`
  const emailPreview =
    `${document.update.summary} ` +
    (document.nextScheduleItem
      ? `Next up: ${document.nextScheduleItem.title}.`
      : "Open Compass to view the full owner update.")
  const emailBody =
    `New project update for ${label}\n\n` +
    `${emailPreview}\n\n` +
    `View full update: ${updateUrl}`

  return (
    <main className="min-h-screen bg-muted/30 print:bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/projects/${document.project.id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <OwnerUpdateActions
            projectId={document.project.id}
            updateId={document.update.id}
            status={document.update.status}
            emailSubject={emailSubject}
            emailBody={emailBody}
          />
        </div>

        <article className="bg-background p-5 shadow-sm sm:p-8 print:p-0 print:shadow-none">
          <header className="border-b pb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Owner Project Update
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {document.update.title}
                </h1>
              </div>
              <Badge
                variant={
                  document.update.status === "published"
                    ? "default"
                    : "secondary"
                }
              >
                {statusLabel(document.update.status)}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{label}</span>
              <span>&middot;</span>
              <span>{formatDate(document.update.updateDate)}</span>
              {document.project.clientName && (
                <>
                  <span>&middot;</span>
                  <span>{document.project.clientName}</span>
                </>
              )}
              {document.update.publishedAt && (
                <>
                  <span>&middot;</span>
                  <span>Published {formatDateTime(document.update.publishedAt)}</span>
                </>
              )}
            </div>
            {document.project.address && (
              <p className="mt-2 text-sm text-muted-foreground">
                {document.project.address}
              </p>
            )}
          </header>

          <section className="py-6">
            <h2 className="text-base font-semibold">Summary</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {document.update.summary}
            </p>
          </section>

          {document.dailyLogs.length > 0 && (
            <section className="border-t py-6">
              <h2 className="text-base font-semibold">Work Completed</h2>
              <div className="mt-4 space-y-4">
                {document.dailyLogs.map((log) => (
                  <div key={log.id} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(log.logDate)}</span>
                      {log.authorName && (
                        <>
                          <span>&middot;</span>
                          <span>{log.authorName}</span>
                        </>
                      )}
                      {log.weather && (
                        <>
                          <span>&middot;</span>
                          <span>{log.weather}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-6">
                      {log.workCompleted}
                    </p>
                    {(log.nextSteps || log.issues || log.safetyNotes) && (
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                        {log.nextSteps && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">
                              Next steps
                            </dt>
                            <dd className="mt-1">{log.nextSteps}</dd>
                          </div>
                        )}
                        {log.issues && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">
                              Notes
                            </dt>
                            <dd className="mt-1">{log.issues}</dd>
                          </div>
                        )}
                        {log.safetyNotes && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">
                              Safety
                            </dt>
                            <dd className="mt-1">{log.safetyNotes}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {document.photos.length > 0 && (
            <section className="border-t py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconPhoto className="size-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Photos This Week</h2>
                </div>
                {document.photoFolder && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/dashboard/projects/${document.project.id}/preview/owner#photos`}
                    >
                      <IconPhotoUp className="size-4" />
                      View all approved photos
                    </Link>
                  </Button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {document.photos.map((photo) => (
                  <OwnerUpdatePhotoTile
                    key={photo.id}
                    fileName={photo.fileName}
                    driveUrl={photo.driveUrl}
                    thumbnailUrl={photo.thumbnailUrl}
                    caption={photo.caption}
                  />
                ))}
              </div>
              {document.photoFolder && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing selected owner-visible photos. The full weekly set is
                  available in the approved Compass photo gallery.
                </p>
              )}
            </section>
          )}

          {document.nextScheduleItem && (
            <section className="border-t py-6">
              <div className="flex items-center gap-2">
                <IconCalendarStats className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Coming Next</h2>
              </div>
              <div className="mt-4 rounded-md border bg-muted/30 p-4">
                <p className="text-sm font-medium">
                  {document.nextScheduleItem.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(document.nextScheduleItem.startDate)}
                  {" - "}
                  {formatDate(document.nextScheduleItem.endDate)}
                  {document.nextScheduleItem.assignedTo
                    ? ` · ${document.nextScheduleItem.assignedTo}`
                    : ""}
                </p>
              </div>
            </section>
          )}
        </article>

        <section
          id="email-preview"
          className="bg-background p-5 shadow-sm sm:p-6 print:hidden"
        >
          <div className="flex items-center gap-2">
            <IconMail className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Email Preview</h2>
          </div>
          <div className="mt-4 overflow-hidden rounded-md border">
            <div className="border-b bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">Subject</p>
              <p className="mt-1 text-sm font-medium">{emailSubject}</p>
            </div>
            <div className="px-4 py-4">
              <p className="text-base font-semibold">
                New project update for {label}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {emailPreview}
              </p>
              <Button asChild className="mt-4">
                <Link href={updateUrl}>View full update</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
