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
import { OwnerUpdateDraftEditor } from "@/components/projects/owner-update-draft-editor"
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
  absoluteUpdateUrl,
}: {
  readonly document: OwnerProjectUpdateDocument
  readonly absoluteUpdateUrl?: string
}): React.ReactElement {
  const label = projectLabel(document)
  const updateUrl =
    `/dashboard/projects/${document.project.id}` +
    `/owner-updates/${document.update.id}`
  const fullUpdateHref = absoluteUpdateUrl ?? updateUrl
  const emailSubject = `${label} - ${document.update.title}`
  const emailPreview =
    `${document.update.summary} ` +
    (document.nextScheduleItem
      ? `Next up: ${document.nextScheduleItem.title}.`
      : "Open Compass to view the full owner update.")

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
            canManage={document.canManage}
            projectId={document.project.id}
            updateId={document.update.id}
            status={document.update.status}
            emailSubject={emailSubject}
            emailPreview={emailPreview}
            updatePath={updateUrl}
            projectLabel={label}
            updateTitle={document.update.title}
          />
        </div>

        {document.canManage && document.update.status !== "published" && (
          <OwnerUpdateDraftEditor document={document} />
        )}

        <article
          data-owner-update-id={document.update.id}
          className="owner-update-printable bg-background p-5 shadow-sm sm:p-8 print:bg-white print:p-0 print:text-black print:shadow-none"
        >
          <div className="hidden print:mb-6 print:flex print:items-start print:justify-between print:border-b-2 print:border-black print:pb-4">
            <div className="flex items-center gap-3">
              <img
                src="/department-logos/hps-h-green.svg"
                alt="High Performance Structures"
                className="h-14 w-14 object-contain"
              />
              <div>
                <p className="text-sm font-bold uppercase">
                  High Performance Structures, Inc.
                </p>
                <p className="text-xs">Project Owner Update</p>
              </div>
            </div>
            <div className="text-right text-xs">
              <p className="font-semibold">{label}</p>
              <p>{formatDate(document.update.updateDate)}</p>
            </div>
          </div>

          <header className="border-b pb-6 print:border-b print:border-black print:pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground print:text-xs print:font-bold print:uppercase print:text-black">
                  Owner Project Update
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl print:text-2xl print:leading-tight">
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
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground print:text-xs print:text-black">
              <span>{label}</span>
              <span>&middot;</span>
              <span>{formatDate(document.update.updateDate)}</span>
              {document.update.periodStart &&
                document.update.periodEnd && (
                  <>
                    <span>&middot;</span>
                    <span>
                      Reporting period{" "}
                      {formatDate(document.update.periodStart)} -{" "}
                      {formatDate(document.update.periodEnd)}
                    </span>
                  </>
                )}
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
              <p className="mt-2 text-sm text-muted-foreground print:text-xs print:text-black">
                {document.project.address}
              </p>
            )}
          </header>

          <section className="py-6 print:py-4">
            <h2 className="text-base font-semibold print:text-sm print:uppercase">
              Summary
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground print:max-w-none print:text-[12px] print:leading-5 print:text-black">
              {document.update.summary}
            </p>
          </section>

          {document.dailyLogs.length > 0 && (
            <section className="border-t py-6 print:border-t print:border-black print:py-4">
              <h2 className="text-base font-semibold print:text-sm print:uppercase">
                Work Completed
              </h2>
              <div className="mt-4 space-y-4 print:mt-3 print:space-y-3">
                {document.dailyLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-md border p-4 print:break-inside-avoid print:rounded-none print:border-0 print:border-t print:border-black/30 print:px-0 print:py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground print:text-[10px] print:font-semibold print:uppercase print:text-black">
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
                    <p className="mt-2 text-sm leading-6 print:text-[12px] print:leading-5">
                      {log.workCompleted}
                    </p>
                    {(log.nextSteps || log.issues || log.safetyNotes) && (
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3 print:grid-cols-3 print:text-[11px]">
                        {log.nextSteps && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground print:text-[9px] print:text-black">
                              Next steps
                            </dt>
                            <dd className="mt-1">{log.nextSteps}</dd>
                          </div>
                        )}
                        {log.issues && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground print:text-[9px] print:text-black">
                              Notes
                            </dt>
                            <dd className="mt-1">{log.issues}</dd>
                          </div>
                        )}
                        {log.safetyNotes && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground print:text-[9px] print:text-black">
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
            <section className="border-t py-6 print:break-before-auto print:border-t print:border-black print:py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconPhoto className="size-4 text-muted-foreground print:hidden" />
                  <h2 className="text-base font-semibold print:text-sm print:uppercase">
                    Photos This Week
                  </h2>
                </div>
                {document.photoFolder && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="print:hidden"
                  >
                    <Link
                      href={`/dashboard/projects/${document.project.id}/preview/owner#photos`}
                    >
                      <IconPhotoUp className="size-4" />
                      View all approved photos
                    </Link>
                  </Button>
                )}
              </div>
              <div className="owner-update-photo-grid mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
                {document.photos.map((photo) => (
                  <OwnerUpdatePhotoTile
                    key={photo.id}
                    fileName={photo.fileName}
                    driveFileId={photo.driveFileId}
                    driveUrl={photo.driveUrl}
                    thumbnailUrl={photo.thumbnailUrl}
                    caption={photo.caption}
                  />
                ))}
              </div>
              {document.photoFolder && (
                <p className="mt-3 text-xs text-muted-foreground print:text-[10px] print:text-black">
                  Showing selected owner-visible photos. The full weekly set is
                  available in the approved Compass photo gallery.
                </p>
              )}
            </section>
          )}

          {document.lookAheadScheduleItems.length > 0 && (
            <section className="border-t py-6 print:break-inside-avoid print:border-t print:border-black print:py-4">
              <div className="flex items-center gap-2">
                <IconCalendarStats className="size-4 text-muted-foreground print:hidden" />
                <h2 className="text-base font-semibold print:text-sm print:uppercase">
                  Looking Ahead
                </h2>
              </div>
              <div className="mt-4 overflow-hidden rounded-md border bg-muted/20 print:rounded-none print:border-black print:bg-white">
                {document.lookAheadScheduleItems.map((item, index) => (
                  <div
                    key={`${item.title}-${item.startDate}-${index}`}
                    className="grid gap-2 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] print:grid-cols-[6.75rem_minmax(0,1fr)] print:px-3 print:py-2"
                  >
                    <p className="text-xs font-medium text-muted-foreground print:text-[10px] print:text-black">
                      {formatDate(item.startDate)}
                      {item.endDate !== item.startDate
                        ? ` - ${formatDate(item.endDate)}`
                        : ""}
                    </p>
                    <div>
                      <p className="text-sm font-medium print:text-[12px]">
                        {item.title}
                      </p>
                      {item.assignedTo && (
                        <p className="mt-1 text-xs text-muted-foreground print:text-[10px] print:text-black">
                          {item.assignedTo}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="border-t py-5 print:break-inside-avoid print:border-t print:border-black print:py-4">
            <h2 className="text-base font-semibold print:text-sm print:uppercase">
              Full Update
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground print:text-[11px] print:leading-5 print:text-black">
              View the full project update and approved photo gallery in
              Compass:
            </p>
            <a
              href={fullUpdateHref}
              className="mt-2 inline-block break-all text-sm font-medium text-primary underline underline-offset-4 print:text-[11px] print:text-black"
            >
              {fullUpdateHref}
            </a>
          </section>
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
