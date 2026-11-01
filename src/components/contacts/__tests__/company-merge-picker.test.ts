/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { INTERNAL_MERGE_BLOCKER } from "@/lib/domain/contacts/directory-page"

const mocks = vi.hoisted(() => ({ find: vi.fn(), preview: vi.fn(), merge: vi.fn() }))
vi.mock("@/app/actions/contact-directory", () => ({ findCompanyMergeCandidates: mocks.find }))
vi.mock("@/app/actions/contact-duplicates", () => ({ previewContactMerge: mocks.preview, mergeDuplicateContacts: mocks.merge }))
vi.mock("@/components/searchable-combobox", () => ({ SearchableCombobox: () => React.createElement("div") }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { CompanyMergePicker, type MergeChoice } from "@/components/contacts/company-merge-picker"
import { ContactMergeDialog } from "@/components/contacts/contact-merge-dialog"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

const anchor: MergeChoice = { id: "vendor-a", name: "Acme Concrete", email: "office@acme.example" }

async function settle(ms = 0): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/** The contacts page wiring: the picker fills the second record of the existing dialog. */
function Harness(): React.ReactElement {
  const [choices, setChoices] = React.useState<readonly [MergeChoice, MergeChoice] | null>(null)
  return React.createElement(ContactMergeDialog, {
    kind: "vendor_company",
    choices,
    onOpenChange: () => undefined,
    onMerged: () => undefined,
    picker: React.createElement(CompanyMergePicker, {
      kind: "vendor",
      anchor,
      selectedId: choices?.[1].id ?? null,
      onSelect: (other: MergeChoice) => setChoices([anchor, other]),
    }),
  })
}

describe("Merge with… picker", () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.find.mockResolvedValue({
      success: true,
      data: [
        { id: "vendor-b", name: "ACME Concrete LLC", email: "acme@example.com", detail: "Subcontractor", blockedReason: null },
        { id: "vendor-in", name: "Acme (internal)", email: null, detail: "Internal", blockedReason: INTERNAL_MERGE_BLOCKER },
      ],
    })
    mocks.preview.mockResolvedValue({
      success: true,
      preview: {
        kind: "vendor_company", sourceName: "ACME Concrete LLC", destinationName: "Acme Concrete",
        sourceEmail: null, destinationEmail: null, peopleCount: 1, projectContactCount: 2,
        retainedIdentityNotice: null, blockers: [],
        moves: [{ category: "trade_docs", label: "Trade documents", count: 3 }],
        warnings: ["Open purchase orders move with the vendor."],
      },
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  it("opens the merge dialog with the row chosen, searches the server for the other, and previews the pair", async () => {
    await act(async () => root.render(React.createElement(Harness)))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Merging: Acme Concrete")
    expect(mocks.preview).not.toHaveBeenCalled()

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Find the duplicate vendor"]')
    expect(search).not.toBeNull()
    if (!search) return
    await act(async () => typeInto(search, "acme"))
    await settle(300)
    expect(mocks.find).toHaveBeenCalledWith({ kind: "vendor", search: "acme", excludeId: "vendor-a" })

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(options).toHaveLength(2)
    const internal = options.find((option) => option.textContent?.includes("Acme (internal)"))
    expect(internal?.disabled).toBe(true)
    expect(internal?.textContent).toContain(INTERNAL_MERGE_BLOCKER)

    const duplicate = options.find((option) => option.textContent?.includes("ACME Concrete LLC"))
    await act(async () => duplicate?.click())
    await settle()
    expect(mocks.preview).toHaveBeenCalledWith({ kind: "vendor_company", sourceId: "vendor-b", destinationId: "vendor-a" })
    const previewText = document.querySelector('[role="dialog"]')?.textContent ?? ""
    expect(previewText).toContain("1 people and 2 project contacts will be relinked.")
    // The merged preview (what moves, warnings) shows under the picker.
    expect(previewText).toContain("Moves to the kept record")
    expect(previewText).toContain("Trade documents: 3")
    expect(previewText).toContain("Open purchase orders move with the vendor.")
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain("ACME Concrete LLC")
  })

  it("asks for a search before calling the server", async () => {
    await act(async () => root.render(React.createElement(Harness)))
    await settle(300)
    expect(mocks.find).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Type to find the duplicate vendor.")
  })
})
