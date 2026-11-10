/**
 * The finish selection printout and spreadsheet copy, organized by room (the
 * owner packet and jobsite room sheets) or by category (for trades: one
 * document grouped by category, or each category on its own page). Rows
 * under a category name their room. Pure: returns HTML / tab-separated text;
 * the print snapshot styles it with the `selection-print-*` rules in
 * globals.css.
 */
import type {
  ProjectSelectionItem,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import type { ProjectBrand } from "@/lib/project-branding"
import { escapeHtml } from "@/lib/shared/text"

/** "packet" = one flowing document; "room_sheets" = each group starts a new page. */
export type SelectionPrintMode = "packet" | "room_sheets"
export type SelectionOrganizeBy = "room" | "category"

const UNCATEGORIZED = "Uncategorized"

type PacketGroup = {
  readonly heading: string
  readonly subheading: string | null
  readonly rows: readonly {
    readonly selection: ProjectSelectionItem
    /** The small label beside each item: its category by room, its room by category. */
    readonly tag: string
    readonly roomName: string
  }[]
}

function plainText(value: string | null): string {
  return value?.trim() ?? ""
}

function categoryName(selection: ProjectSelectionItem): string {
  return selection.category.trim() || UNCATEGORIZED
}

/** Selections in category order (A-Z, Uncategorized last), rooms in page order within each. */
function packetGroups(
  summary: ProjectSelectionsSummary,
  organizeBy: SelectionOrganizeBy
): readonly PacketGroup[] {
  if (organizeBy === "room") {
    return summary.rooms.map((room) => ({
      heading: room.roomName,
      subheading: room.roomType,
      rows: room.selections.map((selection) => ({
        selection,
        tag: selection.category,
        roomName: room.roomName,
      })),
    }))
  }
  const byCategory = new Map<string, PacketGroup["rows"][number][]>()
  for (const room of summary.rooms) {
    for (const selection of room.selections) {
      const category = categoryName(selection)
      const rows = byCategory.get(category) ?? []
      rows.push({ selection, tag: room.roomName, roomName: room.roomName })
      byCategory.set(category, rows)
    }
  }
  return [...byCategory.keys()]
    .sort((a, b) =>
      a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b, "en-US", { sensitivity: "base" })
    )
    .map((category) => ({ heading: category, subheading: null, rows: byCategory.get(category) ?? [] }))
}

function packetItemHtml(selection: ProjectSelectionItem, tag: string): string {
  return `
                  <div class="selection-print-item">
                    <div class="selection-print-item-title">
                      <h3>${escapeHtml(selection.name)}</h3>
                      <span>${escapeHtml(tag)}</span>
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
}

export function packetSelectionRows(
  summary: ProjectSelectionsSummary,
  mode: SelectionPrintMode,
  projectLabel: string,
  organizeBy: SelectionOrganizeBy = "room"
): string {
  return packetGroups(summary, organizeBy)
    .map((group) => {
      const selectionRows =
        group.rows.length === 0
          ? `<div class="selection-print-blank-row"><p>No selection prompts added yet.</p></div>`
          : group.rows.map((row) => packetItemHtml(row.selection, row.tag)).join("")
      const subheading = group.subheading ? `<span>${escapeHtml(group.subheading)}</span>` : ""

      if (mode === "room_sheets") {
        return `
          <section class="selection-print-room selection-print-room-sheet">
            <header class="selection-print-room-page-header">
              <div>
                <p>${escapeHtml(projectLabel)} · Finish Schedule</p>
                <h2>${escapeHtml(group.heading)}</h2>
              </div>
              ${subheading}
            </header>
            ${selectionRows}
          </section>`
      }

      return `
        <section class="selection-print-room">
          <div class="selection-print-room-heading">
            <h2>${escapeHtml(group.heading)}</h2>
            ${subheading}
          </div>
          ${selectionRows}
        </section>`
    })
    .join("")
}

/** The printout's title, intro note and file name words for a mode and grouping. */
export function packetTitles(
  mode: SelectionPrintMode,
  organizeBy: SelectionOrganizeBy
): { readonly title: string; readonly note: string; readonly documentWords: string } {
  if (organizeBy === "category") {
    return mode === "room_sheets"
      ? {
          title: "Category Finish Schedules",
          note: "Category sheets are formatted for trades. Each category starts on its own page, and each item names its room.",
          documentWords: "category sheets",
        }
      : {
          title: "Finish Selections by Category",
          note: "Selections are grouped by category, and each item names its room.",
          documentWords: "selections by category",
        }
  }
  return mode === "room_sheets"
    ? {
        title: "Room Finish Schedules",
        note: "Room sheets are formatted for jobsite posting. Each room starts on its own page.",
        documentWords: "room sheets",
      }
    : {
        title: "Finish Selections",
        note: "Please review each room and fill in the selections that are ready for your decision. Product links, supplier notes, colors, finishes, and questions are all helpful.",
        documentWords: "selections",
      }
}

export function packetHtml({
  brand,
  projectLabel,
  clientName,
  filterLabel,
  selectionUrl,
  summary,
  mode,
  organizeBy = "room",
}: {
  readonly brand: ProjectBrand
  readonly projectLabel: string
  readonly clientName: string | null
  readonly filterLabel: string | null
  readonly selectionUrl: string
  readonly summary: ProjectSelectionsSummary
  readonly mode: SelectionPrintMode
  readonly organizeBy?: SelectionOrganizeBy
}): string {
  const { title, note } = packetTitles(mode, organizeBy)

  return `
    <header class="selection-print-header">
      <div class="selection-print-brand">
        <img src="${escapeHtml(brand.logoSrc)}" alt="${escapeHtml(brand.logoAlt)}" loading="eager" decoding="sync" data-project-brand-logo="true" />
        <div>
          <p>${escapeHtml(brand.companyName)}</p>
          <span>Finish Selection Packet</span>
          <div data-project-brand-contact="true">
            ${brand.contactLines
              .map(
                (line) =>
                  `<span style="display:block;margin-top:0.02in;text-align:left;text-transform:none;">${escapeHtml(line)}</span>`
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="selection-print-meta">
        <p>${escapeHtml(projectLabel)}</p>
        ${clientName ? `<span>${escapeHtml(clientName)}</span>` : ""}
        ${filterLabel ? `<span>${escapeHtml(filterLabel)}</span>` : ""}
      </div>
    </header>

    <section class="selection-print-intro">
      <h1>${title}</h1>
      <p>${escapeHtml(note)}</p>
      <a class="selection-print-open-link" href="${escapeHtml(selectionUrl)}">
        Open this selection page in Compass
      </a>
    </section>

    <div class="selection-print-rooms">
      ${packetSelectionRows(summary, mode, projectLabel, organizeBy)}
    </div>`.trim()
}

function tsvCell(value: string | number | null): string {
  return String(value ?? "").replaceAll("\t", " ").replaceAll("\n", " ")
}

/** The tab-separated sheet copy: room order with Room first, or category order with Category first. */
export function selectionSheetText(
  summary: ProjectSelectionsSummary,
  organizeBy: SelectionOrganizeBy = "room"
): string {
  const detail = (selection: ProjectSelectionItem): string[] => [
    selection.quantity === null ? "" : String(selection.quantity),
    plainText(selection.manufacturer),
    plainText(selection.model),
    plainText(selection.colorFinish),
    plainText(selection.supplierName),
    plainText(selection.costCode),
    plainText(selection.productUrl),
    "",
  ]
  const tail = ["Quantity", "Manufacturer", "Model", "Color / Finish", "Supplier", "Cost Code", "Product Link", "Owner Notes"]
  const rows: string[][] = []

  if (organizeBy === "category") {
    rows.push(["Category", "Selection", "Room", ...tail])
    for (const group of packetGroups(summary, "category")) {
      for (const row of group.rows) {
        rows.push([group.heading, row.selection.name, row.roomName, ...detail(row.selection)])
      }
    }
  } else {
    rows.push(["Room", "Selection", "Category", ...tail])
    for (const room of summary.rooms) {
      if (room.selections.length === 0) {
        rows.push([room.roomName, "", "", "", "", "", "", "", "", "", ""])
        continue
      }
      for (const selection of room.selections) {
        rows.push([room.roomName, selection.name, selection.category, ...detail(selection)])
      }
    }
  }

  return rows.map((row) => row.map((cell) => tsvCell(cell)).join("\t")).join("\n")
}
