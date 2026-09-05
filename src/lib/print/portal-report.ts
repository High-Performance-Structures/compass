import { projectBrandFor } from "@/lib/project-branding"

export type ReportProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}
export type PortalReportItem = {
  readonly title: string
  readonly status?: string
  readonly fields: readonly (readonly [string, string | number | null])[]
  readonly paragraphs?: readonly (readonly [string, string | null])[]
}
export type PortalReport = {
  readonly title: string
  readonly note: string
  readonly groups: readonly {
    readonly title: string
    readonly items: readonly PortalReportItem[]
  }[]
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// Only audience-projected data belongs here. Reuse the internal packet's brand,
// typography and pagination without fetching a staff record or cloning app UI.
export function portalReportHtml(
  project: ReportProject,
  report: PortalReport,
  roomSheets = false,
  printedAt = new Date().toLocaleString("en-US"),
): string {
  const brand = projectBrandFor({
    projectId: project.id,
    projectNumber: project.projectNumber,
  })
  const label = [project.projectNumber, project.name]
    .filter(Boolean)
    .join(" · ")
  return `<header class="selection-print-header">
    <div class="selection-print-brand">
      <img src="${escapeHtml(brand.logoSrc)}" alt="${escapeHtml(brand.logoAlt)}" loading="eager" decoding="sync" data-project-brand-logo="true" />
      <div><p>${escapeHtml(brand.companyName)}</p><div data-project-brand-contact="true">${brand.contactLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div></div>
    </div>
    <div class="selection-print-meta"><p>${escapeHtml(label)}</p><span>${escapeHtml(printedAt)}</span></div>
  </header>
  <section class="selection-print-intro"><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.note)}</p></section>
  <div class="selection-print-rooms">${report.groups
    .map(
      (group) => `
    <section class="selection-print-room${roomSheets ? " selection-print-room-sheet" : ""}">
      <header class="selection-print-room-page-header"><div><p>${escapeHtml(label)}</p><h2>${escapeHtml(group.title)}</h2></div></header>
      ${group.items
        .map(
          (item) => `<div class="selection-print-item">
        <div class="selection-print-item-title"><h3>${escapeHtml(item.title)}</h3>${item.status ? `<span>${escapeHtml(item.status)}</span>` : ""}</div>
        <div class="selection-print-grid">${item.fields
          .filter(([, value]) => value !== null && value !== "")
          .map(
            ([name, value]) =>
              `<div><span>${escapeHtml(name)}</span><p>${escapeHtml(value ?? "")}</p></div>`,
          )
          .join("")}</div>
        ${(item.paragraphs ?? [])
          .filter(([, value]) => value)
          .map(
            ([name, value]) =>
              `<p class="selection-print-link portal-report-paragraph"><strong>${escapeHtml(name)}:</strong> ${escapeHtml(value ?? "")}</p>`,
          )
          .join("")}
      </div>`,
        )
        .join("")}
    </section>`,
    )
    .join("")}</div>`
}
