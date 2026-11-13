import { describe, expect, it } from "vitest"

import { DEFAULT_SELECTION_STATUS_LABELS } from "@/lib/domain/selections/status-labels"
import type { ProjectSelectionItem, ProjectSelectionOptions, ProjectSelectionsSummary } from "@/lib/domain/selections/types"
import type { SelectionDecisionItem } from "@/lib/selections/types"
import { parseSelectionWorkArea } from "@/lib/selections/work-areas"
import {
  ALL_SELECTIONS,
  EMPTY_SELECTION_WORK_FILTER,
  filterDecisionItems,
  filterSelectionsSummary,
  groupByRoom,
  publishRoomPills,
  selectionFilterLabel,
  specRoomPills,
} from "@/lib/selections/work-filter"

function spec(id: string, roomName: string, overrides: Partial<ProjectSelectionItem> = {}): ProjectSelectionItem {
  return {
    id,
    projectId: "project-a",
    sourceSystem: "compass",
    sourceRecordId: null,
    sourceWorkbookId: null,
    sourceSheetName: null,
    roomName,
    roomType: null,
    category: "Plumbing",
    name: id,
    description: null,
    quantity: null,
    manufacturer: null,
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
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }
}

function decision(id: string, overrides: Partial<SelectionDecisionItem> = {}): SelectionDecisionItem {
  const specification = {
    roomName: "Kitchen",
    name: id,
    category: "Plumbing",
    description: null,
    quantity: null,
    manufacturer: null,
    model: null,
    colorFinish: null,
    supplierName: null,
    productUrl: null,
  }
  return {
    id,
    spec: specification,
    currentSpec: specification,
    revision: 1,
    published: true,
    current: true,
    decisionDueDate: null,
    allowanceCents: null,
    quotedCents: null,
    scheduleImpact: null,
    ownerNote: null,
    requiresChangeOrder: false,
    changeOrderId: null,
    approvedAt: null,
    approvedByName: null,
    approvalBlocker: null,
    status: "owner_review",
    selectionUpdatedAt: "2026-11-01T00:00:00Z",
    requests: [],
    history: [],
    links: [],
    ...overrides,
  }
}

const summary: ProjectSelectionsSummary = {
  totalCount: 3,
  roomCount: 2,
  sourceWorkbookCount: 0,
  needsDecisionCount: 2,
  approvedCount: 1,
  pricingCount: 0,
  orderedCount: 0,
  rooms: [
    {
      id: "r1", projectId: "project-a", sourceSystem: "compass", sourceWorkbookId: null, sourceSheetId: null,
      sourceSheetName: null, roomName: "Kitchen", roomType: null, sortOrder: 0, selectionCount: 2,
      selections: [spec("faucet", "Kitchen", { costCode: "22-100", manufacturer: "Brassworks" }), spec("pendant", "Kitchen", { category: "Lighting", status: "approved" })],
    },
    {
      id: "r2", projectId: "project-a", sourceSystem: "compass", sourceWorkbookId: null, sourceSheetId: null,
      sourceSheetName: null, roomName: "Bath", roomType: null, sortOrder: 1, selectionCount: 1,
      selections: [spec("tub", "Bath")],
    },
  ],
}

const divisions = new Map([["22-100", "22"]])

describe("selections work filter", () => {
  it("narrows by search, room and division and recounts", () => {
    const bySearch = filterSelectionsSummary(summary, { ...EMPTY_SELECTION_WORK_FILTER, search: "brass" }, divisions)
    expect(bySearch.rooms.map((room) => room.roomName)).toEqual(["Kitchen"])
    expect(bySearch.totalCount).toBe(1)
    const byRoom = filterSelectionsSummary(summary, { ...EMPTY_SELECTION_WORK_FILTER, roomName: "Bath" }, divisions)
    expect(byRoom.rooms.map((room) => room.roomName)).toEqual(["Bath"])
    const byDivision = filterSelectionsSummary(summary, { ...EMPTY_SELECTION_WORK_FILTER, division: "22" }, divisions)
    expect(byDivision.rooms.flatMap((room) => room.selections.map((item) => item.id))).toEqual(["faucet"])
  })

  it("filters decision items through the same selections", () => {
    const items = [decision("faucet"), decision("tub")]
    expect(filterDecisionItems(items, summary, EMPTY_SELECTION_WORK_FILTER)).toBe(items)
    const filter = { ...EMPTY_SELECTION_WORK_FILTER, roomName: "Bath" }
    const filtered = filterSelectionsSummary(summary, filter, divisions)
    expect(filterDecisionItems(items, filtered, filter).map((item) => item.id)).toEqual(["tub"])
  })

  it("labels the filter for printouts", () => {
    const options: ProjectSelectionOptions = {
      roomTypes: [],
      manufacturers: [],
      divisions: [{ value: "22", label: "22 Plumbing" }],
      costCodes: [],
      statusLabels: DEFAULT_SELECTION_STATUS_LABELS,
      rooms: [],
    }
    expect(selectionFilterLabel(EMPTY_SELECTION_WORK_FILTER, options)).toBeNull()
    expect(selectionFilterLabel({ ...EMPTY_SELECTION_WORK_FILTER, roomName: "Bath", division: "22", search: " tub " }, options)).toBe(
      "Bath / 22 Plumbing / “tub”"
    )
  })

  it("groups by room in first-seen order", () => {
    const groups = groupByRoom(["a:Kitchen", "b:Bath", "c:Kitchen"], (value) => value.split(":")[1] ?? "")
    expect(groups.map((group) => [group.roomName, group.items.length])).toEqual([["Kitchen", 2], ["Bath", 1]])
  })

  it("summarizes a publish room in one line of pills", () => {
    expect(publishRoomPills([decision("a"), decision("b"), decision("c", { published: false })], new Set(["b"])).map((pill) => pill.label)).toEqual([
      "2 waiting on owner",
      "1 unpublished",
      "1 late risk",
    ])
    expect(publishRoomPills([decision("a", { approvedAt: "2026-11-02" })]).map((pill) => pill.label)).toEqual(["all approved"])
    expect(publishRoomPills([decision("a", { current: false })]).map((pill) => pill.label)).toEqual(["1 revision needed"])
  })

  it("summarizes a specs room in one line of pills", () => {
    expect(specRoomPills(summary.rooms[0]?.selections ?? []).map((pill) => pill.label)).toEqual(["1 need decision"])
    expect(specRoomPills([spec("x", "Bath", { status: "ordered" })]).map((pill) => pill.label)).toEqual(["all approved"])
  })

  it("reads the work area from the URL", () => {
    expect(parseSelectionWorkArea("share")).toBe("share")
    expect(parseSelectionWorkArea("bogus")).toBe("sheet")
    expect(parseSelectionWorkArea(undefined)).toBe("sheet")
    expect(ALL_SELECTIONS).toBe("all")
  })
})
