import type { ProjectSelectionsSummary } from "@/app/actions/project-selections"

export type SelectionPrintMode = "packet" | "room_sheets"

export type SelectionPrintFilters = {
  readonly division: string | null
  readonly costCode: string | null
  readonly roomName: string | null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function plainText(value: string | null): string {
  return value?.trim() ?? ""
}

function selectionLink(projectId: string): string {
  return `/dashboard/projects/${projectId}/selections`
}

function selectionPromptCount(summary: ProjectSelectionsSummary): number {
  return summary.rooms.reduce(
    (total, room) => total + room.selections.length,
    0
  )
}

function packetSelectionRows(
  summary: ProjectSelectionsSummary,
  mode: SelectionPrintMode,
  projectLabel: string
): string {
  return summary.rooms
    .map((room) => {
      const selectionRows =
        room.selections.length === 0
          ? `<div class="selection-print-blank-row"><p>No selection prompts added yet.</p></div>`
          : room.selections
              .map(
                (selection) => `
                  <div class="selection-print-item">
                    <div class="selection-print-item-title">
                      <h3>${escapeHtml(selection.name)}</h3>
                      <span>${escapeHtml(selection.category)}</span>
                    </div>
                    <div class="selection-print-grid">
                      <div>
                        <span>Manufacturer</span>
                        <p>${escapeHtml(plainText(selection.manufacturer))}</p>
                      </div>
                      <div>
                        <span>Model</span>
                        <p>${escapeHtml(plainText(selection.model))}</p>
                      </div>
                      <div>
                        <span>Color / Finish</span>
                        <p>${escapeHtml(plainText(selection.colorFinish))}</p>
                      </div>
                      <div>
                        <span>Supplier</span>
                        <p>${escapeHtml(plainText(selection.supplierName))}</p>
                      </div>
                    </div>
                    ${
                      selection.productUrl
                        ? `<p class="selection-print-link">Product link: ${escapeHtml(selection.productUrl)}</p>`
                        : ""
                    }
                    <div class="selection-print-notes">
                      <span>Owner notes / questions</span>
                    </div>
                  </div>`
              )
              .join("")

      if (mode === "room_sheets") {
        return `
          <section class="selection-print-room selection-print-room-sheet">
            <header class="selection-print-room-page-header">
              <div>
                <p>${escapeHtml(projectLabel)} · Finish Schedule</p>
                <h2>${escapeHtml(room.roomName)}</h2>
              </div>
              ${room.roomType ? `<span>${escapeHtml(room.roomType)}</span>` : ""}
            </header>
            ${selectionRows}
          </section>`
      }

      return `
        <section class="selection-print-room">
          <div class="selection-print-room-heading">
            <h2>${escapeHtml(room.roomName)}</h2>
            ${room.roomType ? `<span>${escapeHtml(room.roomType)}</span>` : ""}
          </div>
          ${selectionRows}
        </section>`
    })
    .join("")
}

export function selectionPacketHtml({
  clientName,
  filterLabel,
  mode,
  projectLabel,
  selectionUrl,
  summary,
}: {
  readonly clientName: string | null
  readonly filterLabel: string | null
  readonly mode: SelectionPrintMode
  readonly projectLabel: string
  readonly selectionUrl: string
  readonly summary: ProjectSelectionsSummary
}): string {
  const packetTitle =
    mode === "room_sheets" ? "Room Finish Schedules" : "Finish Selections"
  const packetNote =
    mode === "room_sheets"
      ? "Room sheets are formatted for jobsite posting. Each room starts on its own page."
      : "Please review each room and fill in the selections that are ready for your decision. Product links, supplier notes, colors, finishes, and questions are all helpful."

  return `
    <header class="selection-print-header">
      <div class="selection-print-brand">
        <img src="/department-logos/orc-mark.png" alt="Open Range Construction" />
        <div>
          <p>Open Range Construction</p>
          <span>Finish Selection Packet</span>
        </div>
      </div>
      <div class="selection-print-meta">
        <p>${escapeHtml(projectLabel)}</p>
        ${clientName ? `<span>${escapeHtml(clientName)}</span>` : ""}
        ${filterLabel ? `<span>${escapeHtml(filterLabel)}</span>` : ""}
      </div>
    </header>

    <section class="selection-print-intro">
      <h1>${packetTitle}</h1>
      <p>${escapeHtml(packetNote)}</p>
      <a class="selection-print-open-link" href="${escapeHtml(selectionUrl)}">
        Open this selection page in Compass
      </a>
    </section>

    <div class="selection-print-rooms">
      ${packetSelectionRows(summary, mode, projectLabel)}
    </div>`.trim()
}

export function selectionPrintStyles(): string {
  return `
    @page {
      margin: 0.35in;
      size: letter;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: #f4efe8;
      color: #111111;
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 24px;
    }

    .print-help {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: center;
      margin: 0 0 16px;
    }

    .print-help a,
    .print-help button {
      background: #3f7d4d;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 700 13px Arial, sans-serif;
      padding: 10px 16px;
      text-decoration: none;
    }

    .print-help a {
      background: #ffffff;
      color: #3f7d4d;
      outline: 1px solid #3f7d4d;
    }

    .selection-printable {
      background: #ffffff;
      color: #111111;
      font-family: Arial, sans-serif;
      margin: 0 auto;
      max-width: 8.5in;
      min-height: 10in;
      padding: 0.35in;
    }

    .selection-print-header {
      align-items: flex-start;
      border-bottom: 2px solid #6f471f;
      display: flex;
      justify-content: space-between;
      padding-bottom: 0.07in;
    }

    .selection-print-brand {
      align-items: center;
      display: flex;
      gap: 0.09in;
    }

    .selection-print-brand img {
      height: 0.34in;
      object-fit: contain;
      width: 0.34in;
    }

    .selection-print-brand p,
    .selection-print-meta p {
      color: #201105;
      font-size: 11px;
      font-weight: 700;
      margin: 0;
      text-transform: uppercase;
    }

    .selection-print-brand span,
    .selection-print-meta span {
      display: block;
      font-size: 10px;
      margin-top: 0.03in;
    }

    .selection-print-meta {
      text-align: right;
    }

    .selection-print-intro {
      align-items: end;
      display: grid;
      gap: 0.18in;
      grid-template-columns: minmax(1.8in, 0.55fr) minmax(3.2in, 1fr);
      padding: 0.08in 0 0.06in;
    }

    .selection-print-intro h1 {
      font-size: 16px;
      line-height: 1.1;
      margin: 0;
    }

    .selection-print-intro p {
      font-size: 10px;
      line-height: 1.25;
      margin: 0;
      max-width: none;
    }

    .selection-print-open-link {
      align-self: start;
      color: #3f7d4d;
      font-size: 9px;
      font-weight: 700;
      justify-self: end;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .selection-print-rooms {
      display: grid;
      gap: 0.1in;
    }

    .selection-print-room {
      border: 1px solid #6f471f;
      break-inside: auto;
      page-break-inside: auto;
    }

    .selection-print-room-sheet {
      break-before: page;
      page-break-before: always;
    }

    .selection-print-room-sheet:first-child {
      break-before: auto;
      page-break-before: auto;
    }

    .selection-print-room-page-header {
      align-items: baseline;
      background: #ffffff;
      border-bottom: 2px solid #6f471f;
      display: flex;
      justify-content: space-between;
      padding: 0.08in 0.1in;
    }

    .selection-print-room-page-header p {
      color: #6f471f;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin: 0 0 0.02in;
      text-transform: uppercase;
    }

    .selection-print-room-page-header h2 {
      color: #201105;
      font-size: 15px;
      font-weight: 800;
      margin: 0;
    }

    .selection-print-room-page-header span {
      font-size: 10px;
    }

    .selection-print-room-heading {
      align-items: baseline;
      background: #efe5d8;
      border-bottom: 1px solid #6f471f;
      display: flex;
      gap: 0.1in;
      justify-content: space-between;
      padding: 0.08in 0.1in;
    }

    .selection-print-room-heading h2 {
      color: #201105;
      font-size: 13px;
      font-weight: 800;
      margin: 0;
    }

    .selection-print-room-heading span {
      font-size: 10px;
    }

    .selection-print-item {
      break-inside: avoid;
      border-top: 1px solid #cccccc;
      padding: 0.1in;
      page-break-inside: avoid;
    }

    .selection-print-room .selection-print-item:first-of-type {
      border-top: 0;
    }

    .selection-print-item-title {
      align-items: baseline;
      display: flex;
      gap: 0.1in;
      justify-content: space-between;
    }

    .selection-print-item-title h3 {
      font-size: 12px;
      margin: 0;
    }

    .selection-print-item-title span,
    .selection-print-grid span,
    .selection-print-notes span {
      color: #444444;
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .selection-print-grid {
      display: grid;
      gap: 0.08in;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 0.08in;
    }

    .selection-print-grid div {
      border-bottom: 1px solid #999999;
      min-height: 0.24in;
    }

    .selection-print-grid p,
    .selection-print-link {
      font-size: 10px;
      line-height: 1.25;
      margin: 0.03in 0 0;
    }

    .selection-print-link {
      word-break: break-all;
    }

    .selection-print-notes {
      border: 1px solid #999999;
      height: 0.46in;
      margin-top: 0.1in;
      padding: 0.04in;
    }

    .selection-print-blank-row {
      min-height: 0.42in;
      padding: 0.1in;
    }

    .selection-print-blank-row p {
      color: #555555;
      font-size: 10px;
      margin: 0;
    }

    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }

      .print-help {
        display: none;
      }

      .selection-printable {
        box-shadow: none;
        margin: 0;
        max-width: none;
        min-height: 0;
        padding: 0;
      }
    }
  `
}

export function selectionPrintUrl({
  filters,
  mode,
  projectId,
}: {
  readonly filters: SelectionPrintFilters
  readonly mode: SelectionPrintMode
  readonly projectId: string
}): string {
  const params = new URLSearchParams({ mode })
  if (filters.division) params.set("division", filters.division)
  if (filters.costCode) params.set("costCode", filters.costCode)
  if (filters.roomName) params.set("room", filters.roomName)
  const query = params.toString()

  return `/print/projects/${projectId}/selections${
    query ? `?${query}` : ""
  }`
}

export function selectionPublicUrl(projectId: string, origin: string): string {
  return new URL(selectionLink(projectId), origin).toString()
}

export function totalSelectionPrompts(summary: ProjectSelectionsSummary): number {
  return selectionPromptCount(summary)
}
