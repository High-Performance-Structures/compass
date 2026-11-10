import { describe, expect, it } from "vitest"

import type {
  ProjectSelectionItem,
  ProjectSelectionRoom,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { PROJECT_DEPARTMENTS } from "@/lib/domain/project/statuses"
import type { ProjectBrand } from "@/lib/project-branding"
import { packetHtml, packetSelectionRows, selectionSheetText } from "@/lib/selections/selection-packet"

function selection(id: string, roomName: string, category: string): ProjectSelectionItem {
  return {
    id,
    projectId: "project-a",
    sourceSystem: "compass",
    sourceRecordId: null,
    sourceWorkbookId: null,
    sourceSheetName: null,
    roomName,
    roomType: null,
    category,
    name: `${roomName} ${id}`,
    description: null,
    quantity: 1,
    manufacturer: "Maker",
    model: null,
    colorFinish: null,
    choiceOptions: [],
    parentSelectionId: null,
    parentChoiceValue: null,
    selectionLevel: 0,
    supplierName: null,
    productUrl: null,
    costCode: null,
    phaseCode: null,
    status: "needed",
    ownerVisible: false,
    ownerApproved: false,
    rfqOperationId: null,
    purchaseOrderOperationId: null,
    notes: null,
    syncStatus: "synced",
  }
}

function room(roomName: string, selections: readonly ProjectSelectionItem[]): ProjectSelectionRoom {
  return {
    id: roomName,
    projectId: "project-a",
    sourceSystem: "compass",
    sourceWorkbookId: null,
    sourceSheetId: null,
    sourceSheetName: null,
    roomName,
    roomType: "Wet room",
    sortOrder: 0,
    selectionCount: selections.length,
    selections,
  }
}

const summary: ProjectSelectionsSummary = {
  totalCount: 4,
  roomCount: 2,
  sourceWorkbookCount: 0,
  needsDecisionCount: 4,
  approvedCount: 0,
  pricingCount: 0,
  orderedCount: 0,
  rooms: [
    room("Kitchen", [selection("k1", "Kitchen", "Plumbing"), selection("k2", "Kitchen", "Lighting")]),
    room("Bath", [selection("b1", "Bath", "Plumbing"), selection("b2", "Bath", "")]),
  ],
}

const brand: ProjectBrand = {
  companyName: "Builder Co",
  legalName: "Builder Co",
  contactLines: ["555-0100"],
  department: PROJECT_DEPARTMENTS[0],
  email: "office@example.test",
  logoAlt: "Logo",
  logoSrc: "/logo.png",
  mailingAddress: [],
  telephone: "555-0100",
  website: "example.test",
  licenseNumber: "",
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => match[1] ?? "")
}

describe("selection packet", () => {
  it("keeps room packets grouped by room with the category beside each item", () => {
    const html = packetSelectionRows(summary, "packet", "Job 1")
    expect(headings(html)).toEqual(["Kitchen", "Bath"])
    expect(html).toContain("<span>Wet room</span>")
    expect(html).toContain("<h3>Kitchen k1</h3>\n                      <span>Plumbing</span>")
    expect(html).not.toContain("selection-print-room-sheet")
  })

  it("starts each room on its own page for room sheets", () => {
    const html = packetSelectionRows(summary, "room_sheets", "Job 1")
    expect(html.match(/selection-print-room-sheet/g)).toHaveLength(2)
    expect(html).toContain("<p>Job 1 · Finish Schedule</p>")
  })

  it("groups a category packet A-Z, Uncategorized last, and names each item's room", () => {
    const html = packetSelectionRows(summary, "packet", "Job 1", "category")
    expect(headings(html)).toEqual(["Lighting", "Plumbing", "Uncategorized"])
    const plumbing = html.slice(html.indexOf("<h2>Plumbing</h2>"), html.indexOf("<h2>Uncategorized</h2>"))
    expect(plumbing).toContain("<h3>Kitchen k1</h3>\n                      <span>Kitchen</span>")
    expect(plumbing).toContain("<h3>Bath b1</h3>\n                      <span>Bath</span>")
    expect(html).not.toContain("Wet room")
    expect(html).not.toContain("selection-print-room-sheet")
  })

  it("starts each category on its own page for category sheets", () => {
    const html = packetSelectionRows(summary, "room_sheets", "Job 1", "category")
    expect(html.match(/selection-print-room-sheet/g)).toHaveLength(3)
    expect(headings(html)).toEqual(["Lighting", "Plumbing", "Uncategorized"])
  })

  it("titles the document for the grouping and escapes text", () => {
    const html = packetHtml({
      brand,
      projectLabel: "Job <1>",
      clientName: null,
      filterLabel: null,
      selectionUrl: "https://example.test/s",
      summary,
      mode: "room_sheets",
      organizeBy: "category",
    })
    expect(html).toContain("<h1>Category Finish Schedules</h1>")
    expect(html).toContain("Job &lt;1&gt;")
    expect(html).toContain('data-project-brand-logo="true"')
    expect(packetHtml({ brand, projectLabel: "J", clientName: null, filterLabel: null, selectionUrl: "u", summary, mode: "packet" })).toContain(
      "<h1>Finish Selections</h1>"
    )
  })

  it("copies the spreadsheet in room or category order", () => {
    const byRoom = selectionSheetText(summary).split("\n").map((line) => line.split("\t").slice(0, 3))
    expect(byRoom[0]).toEqual(["Room", "Selection", "Category"])
    expect(byRoom.slice(1).map((row) => row[0])).toEqual(["Kitchen", "Kitchen", "Bath", "Bath"])
    const byCategory = selectionSheetText(summary, "category").split("\n").map((line) => line.split("\t").slice(0, 3))
    expect(byCategory[0]).toEqual(["Category", "Selection", "Room"])
    expect(byCategory.slice(1)).toEqual([
      ["Lighting", "Kitchen k2", "Kitchen"],
      ["Plumbing", "Kitchen k1", "Kitchen"],
      ["Plumbing", "Bath b1", "Bath"],
      ["Uncategorized", "Bath b2", "Bath"],
    ])
  })
})
