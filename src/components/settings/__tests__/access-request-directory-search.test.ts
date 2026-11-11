// @vitest-environment jsdom

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
})

const mocks = vi.hoisted(() => ({ directory: vi.fn() }))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock("@/app/actions/access-requests", () => ({
  approveCompanyAccessRequest: vi.fn(),
  declineCompanyAccessRequest: vi.fn(),
  getAccessRequestDirectoryOptions: mocks.directory,
}))
// A plain stand-in so the test can type a search and read the listed names.
vi.mock("@/components/searchable-combobox", () => ({
  SearchableCombobox: ({ options, onSearchChange }: { readonly options: readonly { readonly value: string; readonly label: string }[]; readonly onSearchChange?: (search: string) => void }) =>
    React.createElement("div", null,
      React.createElement("input", { "aria-label": "search", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onSearchChange?.(event.target.value) }),
      React.createElement("ul", null, options.map((option) => React.createElement("li", { key: option.value }, option.label)))),
}))

import { AccessRequestReviewDialog } from "@/components/settings/access-request-review-dialog"

const request = {
  id: "request-1", kind: "vendor" as const, status: "pending" as const, requesterUserId: "user-1",
  requesterName: "Requester", requesterEmail: "office@rockstar.test", companyName: "Rockstar Marble & Granite",
  phone: null, jobReference: null, note: null, createdAt: "2026-11-11T00:00:00Z", decidedAt: null,
  decidedByName: null, grantedRole: null, grantedProjectCount: null, linkedPerson: null,
}
const option = (name: string): { readonly id: string; readonly name: string; readonly label: string; readonly email: null; readonly linkedElsewhere: false } =>
  ({ id: name, name, label: "Vendor company · Supplier", email: null, linkedElsewhere: false })

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

describe("access request directory search", () => {
  it("searches the whole directory on the server, not only the first page", async () => {
    mocks.directory.mockImplementation(async (_id: string, search: string) =>
      ({ success: true, data: search ? [option("Rockstar Marble & Granite")] : [option("Aardvark Plumbing")] }))
    container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(AccessRequestReviewDialog, { request, onOpenChange: vi.fn(), onDecided: vi.fn() }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(document.body.textContent).toContain("Aardvark Plumbing")

    const input = document.querySelector<HTMLInputElement>('input[aria-label="search"]')
    if (!input) throw new Error("Expected search input")
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "rockstar")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(mocks.directory).toHaveBeenLastCalledWith("request-1", "rockstar")
    expect(document.body.textContent).toContain("Rockstar Marble & Granite")
    act(() => root.unmount())
  })
})
