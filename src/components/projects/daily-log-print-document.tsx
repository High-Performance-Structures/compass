import type * as React from "react"

import type { ProjectDailyLogItem } from "@/app/actions/project-field"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { projectBrandFor } from "@/lib/project-branding"

function formatPrintDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parsed)
}

function sourceLabel(value: string): string {
  if (value === "compass") return "Compass"
  if (value === "buildertrend") return "Buildertrend"
  return value.replace(/[_-]+/g, " ")
}

function readableField(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0 || trimmed === "[]") return null

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const values = parsed.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
      return values.length > 0 ? values.join(", ") : null
    }
  } catch {
    // Plain text is already suitable for print.
  }

  return trimmed
}

function PrintDetail({
  label,
  value,
}: {
  readonly label: string
  readonly value: string | null
}): React.ReactElement | null {
  if (!value) return null

  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5">
        {value}
      </dd>
    </div>
  )
}

export function DailyLogPrintDocument({
  clientName,
  logs,
  projectId,
  projectLabel,
  projectName,
  projectNumber,
}: {
  readonly clientName: string | null
  readonly logs: readonly ProjectDailyLogItem[]
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly projectNumber: string | null
}): React.ReactElement {
  const brand = projectBrandFor({ projectId, projectNumber })

  return (
    <article
      data-daily-log-print-root="true"
      className="daily-log-print-root hidden bg-white text-black"
    >
      <header className="border-b-2 border-black pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-3">
            <ProjectBrandLogo
              brand={brand}
              size={48}
              className="h-12 w-12 object-contain"
            />
            <div>
              <p className="text-sm font-bold uppercase">
                {brand.companyName}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">Daily Logs</h1>
              <p className="mt-1 text-sm">{projectName}</p>
              {clientName && <p className="text-xs">Client: {clientName}</p>}
            </div>
          </div>
          <div className="text-right text-xs">
            <p className="font-semibold">{projectLabel}</p>
            <p>{logs.length} log{logs.length === 1 ? "" : "s"}</p>
            <p>Printed {new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </header>

      <div className="divide-y divide-black/30">
        {logs.map((log) => {
          const materials = readableField(log.materialsUsed)
          const crew = readableField(log.crewPresent)

          return (
            <section
              key={log.id}
              className="break-inside-avoid py-5 first:pt-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">
                    {formatPrintDate(log.logDate)}
                  </h2>
                  <p className="mt-1 text-[10px] uppercase tracking-wide">
                    {sourceLabel(log.sourceSystem)}
                    {log.authorName ? ` · ${log.authorName}` : ""}
                  </p>
                </div>
                <div className="text-right text-[10px]">
                  {log.weather && <p>{log.weather}</p>}
                  {(crew || log.hoursWorked !== null) && (
                    <p>
                      {[crew, log.hoursWorked === null
                        ? null
                        : `${log.hoursWorked} hours`]
                        .filter((value) => value !== null)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-[9px] font-bold uppercase tracking-wide">
                  Work Completed
                </h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5">
                  {log.workCompleted}
                </p>
              </div>

              {(log.issues ||
                materials ||
                log.safetyIncidents ||
                log.visitorLog ||
                log.notes) && (
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-3">
                  <PrintDetail label="Issues" value={log.issues} />
                  <PrintDetail label="Materials" value={materials} />
                  <PrintDetail
                    label="Safety"
                    value={log.safetyIncidents}
                  />
                  <PrintDetail label="Visitors" value={log.visitorLog} />
                  {log.notes && (
                    <div className="col-span-2 min-w-0">
                      <PrintDetail label="Notes / Next" value={log.notes} />
                    </div>
                  )}
                </dl>
              )}

              {log.photos.length > 0 && (
                <div className="mt-4 border-t border-black/30 pt-3">
                  <h3 className="text-[9px] font-bold uppercase tracking-wide">
                    Attachments ({log.photos.length})
                  </h3>
                  <ul className="mt-1 columns-2 gap-6 text-[10px] leading-4">
                    {log.photos.map((photo) => (
                      <li key={photo.id} className="break-inside-avoid">
                        {photo.driveUrl ? (
                          <a href={photo.driveUrl} className="underline">
                            {photo.caption ?? photo.fileName}
                          </a>
                        ) : (
                          photo.caption ?? photo.fileName
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </article>
  )
}
