// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard/projects/project-a/selections",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => React.createElement("a", props) }))
vi.mock("@/app/actions/selection-decisions", () => ({
  publishSelectionDecision: vi.fn(),
  approveSelectionDecision: vi.fn(),
  linkSelectionPurchaseOrder: vi.fn(),
  unlinkSelectionProcurement: vi.fn(),
}))
vi.mock("@/app/actions/selection-requests", () => ({
  saveSelectionRequest: vi.fn(),
  closeSelectionRequest: vi.fn(),
}))

import { SelectionPublishRooms } from "@/components/selections/selection-publish-rooms"
import { DEFAULT_SELECTION_STATUS_LABELS } from "@/lib/domain/selections/status-labels"
import type { SelectionDecisionItem, SelectionWorkspace } from "@/lib/selections/types"

function item(id: string, roomName: string, overrides: Partial<SelectionDecisionItem> = {}): SelectionDecisionItem {
  const spec = {
    roomName,
    name: `${roomName} ${id}`,
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
    spec,
    currentSpec: spec,
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
    signed: false,
    ownerApproved: false,
    status: "owner_review",
    selectionUpdatedAt: "2026-11-01T00:00:00Z",
    requests: [],
    history: [],
    links: [],
    ...overrides,
  }
}

const items = [item("a", "Kitchen"), item("b", "Kitchen", { approvedAt: "2026-11-02T00:00:00Z" }), item("c", "Bath", { published: false })]
const workspace: SelectionWorkspace = {
  projectId: "project-a",
  audience: "staff",
  canWrite: false,
  ownerChoiceConfirmation: true,
  statusLabels: DEFAULT_SELECTION_STATUS_LABELS,
  items,
  changeOrders: [],
  purchaseOrders: [],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(name))
  if (!found) throw new Error(`no button ${name}`)
  return found
}

describe("SelectionPublishRooms", () => {
  it("starts with every room folded to one header line", () => {
    act(() => root.render(React.createElement(SelectionPublishRooms, { workspace, items, leadTimeWarnings: [] })))
    const headers = Array.from(host.querySelectorAll("button[aria-expanded]"))
    expect(headers.map((header) => header.getAttribute("aria-expanded"))).toEqual(["false", "false"])
    expect(headers[0]?.textContent).toContain("Kitchen")
    expect(headers[0]?.textContent).toContain("2 items")
    expect(headers[0]?.textContent).toContain("1 waiting on owner")
    expect(headers[1]?.textContent).toContain("1 unpublished")
    expect(host.textContent).not.toContain("Kitchen a")
  })

  it("expands and collapses all rooms", () => {
    act(() => root.render(React.createElement(SelectionPublishRooms, { workspace, items, leadTimeWarnings: [] })))
    act(() => button("Expand all").click())
    expect(host.textContent).toContain("Kitchen a")
    expect(host.textContent).toContain("Bath c")
    act(() => button("Collapse all").click())
    expect(host.textContent).not.toContain("Kitchen a")
  })

  it("opens a selection's decision in the side drawer instead of inline", () => {
    act(() => root.render(React.createElement(SelectionPublishRooms, { workspace, items, leadTimeWarnings: [] })))
    act(() => button("Bath").click())
    const row = host.querySelector<HTMLButtonElement>('button[aria-label="Review Bath: Bath c"]')
    expect(row).not.toBeNull()
    act(() => row?.click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.querySelector("article[aria-label='Bath c']")).not.toBeNull()
    expect(host.querySelector("article")).toBeNull()
  })
})
