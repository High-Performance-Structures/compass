import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconCalendarCheck,
  IconCalendarStats,
  IconChecklist,
  IconFile,
  IconPhoto,
  IconPhotoUp,
} from "@tabler/icons-react"

import type { OwnerProjectUpdateDocument } from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OwnerUpdateActions } from "@/components/projects/owner-update-actions"
import { OwnerUpdateDraftEditor } from "@/components/projects/owner-update-draft-editor"
import { OwnerUpdatePhotoTile } from "@/components/projects/owner-update-photo-tile"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { projectBrandFor } from "@/lib/project-branding"
import { projectAudienceSectionHref } from "@/lib/project-audience-preview-routes"
import { projectAudiencePhotoUrl } from "@/lib/photo-sources"

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

function ownerUpdateDocumentHref(input: {
  readonly driveFileId: string | null
  readonly driveUrl: string | null
}): string | null {
  if (input.driveFileId) return `/api/google/download/${input.driveFileId}`
  return input.driveUrl
}

export function OwnerUpdateDocument({
  document,
  previewMode,
}: {
  readonly document: OwnerProjectUpdateDocument
  readonly previewMode?: {
    readonly homeHref: string
    readonly photosHref: string
  }
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
  const brand = projectBrandFor({
    projectId: document.project.id,
    projectNumber: document.project.projectNumber,
  })

  return (
    <main className="min-h-screen bg-muted/30 print:bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={
                previewMode?.homeHref ??
                `/dashboard/projects/${document.project.id}`
              }
            >
              <IconArrowLeft className="size-4" />
              {previewMode ? "Owner Compass" : "Project"}
            </Link>
          </Button>
            <OwnerUpdateActions
              canManage={!previewMode && document.canManage}
              printOnly={Boolean(previewMode)}
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

        {!previewMode &&
          document.canManage &&
          document.update.status !== "published" && (
          <OwnerUpdateDraftEditor document={document} />
        )}

        <article
          data-owner-update-id={document.update.id}
          className="owner-update-printable bg-background p-5 shadow-sm sm:p-8 print:bg-white print:p-0 print:text-black print:shadow-none"
        >
          <div className="hidden print:mb-6 print:flex print:items-start print:justify-between print:border-b-2 print:border-black print:pb-4">
            <div className="flex items-center gap-3">
              <ProjectBrandLogo
                brand={brand}
                size={56}
                ownerUpdateMarker
                className="h-14 w-14 object-contain"
              />
              <div>
                <p className="text-sm font-bold uppercase">
                  {brand.companyName}
                </p>
                <ProjectBrandContactDetails
                  brand={brand}
                  lineClassName="text-xs"
                />
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
                className="print:hidden"
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
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground print:max-w-none print:text-[12px] print:leading-5 print:text-black">
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
                      href={
                        previewMode?.photosHref ??
                        projectAudienceSectionHref(
                          document.project.id,
                          "owner",
                          "photos"
                        )
                      }
                      target={previewMode ? undefined : "_blank"}
                      rel={previewMode ? undefined : "noopener noreferrer"}
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
                    driveFileId={
                      document.update.status === "published"
                        ? null
                        : photo.driveFileId
                    }
                    driveUrl={photo.driveUrl}
                    thumbnailUrl={
                      document.update.status === "published"
                        ? projectAudiencePhotoUrl(
                            document.project.id,
                            photo.id,
                            "owner"
                          )
                        : photo.thumbnailUrl
                    }
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

          {document.documents.length > 0 && (
            <section className="border-t py-6 print:break-inside-avoid print:border-t print:border-black print:py-4">
              <div className="flex items-center gap-2">
                <IconFile className="size-4 text-muted-foreground print:hidden" />
                <h2 className="text-base font-semibold print:text-sm print:uppercase">
                  Documents
                </h2>
              </div>
              <div className="mt-3 divide-y border-y print:border-black">
                {document.documents.map((file) => {
                  const href = ownerUpdateDocumentHref(file)
                  return (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 py-3 print:py-2"
                    >
                      <IconFile className="size-4 shrink-0 text-muted-foreground print:hidden" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium print:text-[12px]">
                          {file.caption ?? file.fileName}
                        </p>
                        {file.caption && (
                          <p className="mt-1 truncate text-xs text-muted-foreground print:text-[10px] print:text-black">
                            {file.fileName}
                          </p>
                        )}
                      </div>
                      {href && (
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="print:hidden"
                        >
                          <a href={href} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {document.completedScheduleItems.length > 0 && (
            <section className="border-t py-6 print:break-inside-avoid print:border-t print:border-black print:py-4">
              <div className="flex items-center gap-2">
                <IconCalendarCheck className="size-4 text-muted-foreground print:hidden" />
                <h2 className="text-base font-semibold print:text-sm print:uppercase">
                  Completed This Period
                </h2>
              </div>
              <div className="mt-4 divide-y border-y print:border-black">
                {document.completedScheduleItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-2 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] print:grid-cols-[6.75rem_minmax(0,1fr)] print:py-2"
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
                      {(item.notes || item.assignedTo) && (
                        <p className="mt-1 text-xs text-muted-foreground print:text-[10px] print:text-black">
                          {[item.notes, item.assignedTo]
                            .filter(
                              (value) =>
                                value !== null && value.trim().length > 0
                            )
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {document.todos.length > 0 && (
            <section className="border-t py-6 print:break-inside-avoid print:border-t print:border-black print:py-4">
              <div className="flex items-center gap-2">
                <IconChecklist className="size-4 text-muted-foreground print:hidden" />
                <h2 className="text-base font-semibold print:text-sm print:uppercase">
                  To-dos
                </h2>
              </div>
              <div className="mt-4 divide-y border-y print:border-black">
                {document.todos.map((item) => (
                  <div key={item.id} className="py-3 print:py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium print:text-[12px]">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground print:text-[10px] print:text-black">
                        {item.dueDate
                          ? `Due ${formatDate(item.dueDate)}`
                          : statusLabel(item.status)}
                      </p>
                    </div>
                    {(item.description || item.notes) && (
                      <p className="mt-1 text-sm text-muted-foreground print:text-[11px] print:text-black">
                        {[item.description, item.notes]
                          .filter((value) => value.trim().length > 0)
                          .join(" ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
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
                    key={item.id || `${item.title}-${item.startDate}-${index}`}
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
                      {item.notes && (
                        <p className="mt-1 text-xs text-muted-foreground print:text-[10px] print:text-black">
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </article>
      </div>
    </main>
  )
}
