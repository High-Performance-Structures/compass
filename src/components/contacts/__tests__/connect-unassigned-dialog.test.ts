/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ find: vi.fn(), suggest: vi.fn(), connect: vi.fn(), connected: vi.fn() }))
vi.mock("@/app/actions/unassigned-people", () => ({
  findUnassignedConnectCompanies: mocks.find,
  getUnassignedCompanySuggestion: mocks.suggest,
  connectUnassignedPersonToCompany: mocks.connect,
}))
vi.mock("@/app/actions/contact-directory", () => ({ findCompanyMergeCandidates: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { ConnectUnassignedDialog } from "@/components/contacts/connect-unassigned-dialog"
import type { UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

const person: UnassignedPerson = {
  identity: "bt-person:jane",
  name: "Jane Doe",
  email: "jane@acme.example",
  phone: null,
  companyName: "Acme Framing, L.L.C.",
  hasAccount: false,
  projects: [{ projectId: "project-1", projectName: "Smith Residence", projectNumber: "O-1", contactId: "pc-1" }],
}
const KINDS = ["vendor", "customer"] as const

async function settle(ms = 0): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === text)
}

describe("Connect to company… dialog", () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.suggest.mockResolvedValue({ kind: "vendor", id: "vendor-acme", name: "ACME Framing Inc" })
    mocks.connect.mockResolvedValue({
      success: true,
      data: { companyName: "ACME Framing Inc", personId: "vp-1", createdPerson: true, compassOnlyOnSageLinked: false, connected: [{ projectId: "project-1", contactId: "pc-1", archivedDuplicate: false }], failed: [] },
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  it("prefills the vendor the imported company name matches, connects, and points to sharing", async () => {
    await act(async () => root.render(React.createElement(ConnectUnassignedDialog, {
      person, kinds: KINDS, onOpenChange: () => undefined, onConnected: mocks.connected,
    })))
    await settle()
    expect(mocks.suggest).toHaveBeenCalledWith("Acme Framing, L.L.C.")
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Suggested: ACME Framing Inc")

    await act(async () => button("Connect")?.click())
    await settle()
    expect(mocks.connect).toHaveBeenCalledWith({ identity: "bt-person:jane", kind: "vendor", companyId: "vendor-acme" })
    expect(mocks.connected).toHaveBeenCalledWith("bt-person:jane", true)
    const text = document.querySelector('[role="dialog"]')?.textContent ?? ""
    expect(text).toContain("stay staff-only")
    expect(document.querySelector('a[href="/dashboard/projects/project-1/messages"]')).not.toBeNull()
  })

  it("waits for a company choice when nothing matches", async () => {
    mocks.suggest.mockResolvedValue(null)
    await act(async () => root.render(React.createElement(ConnectUnassignedDialog, {
      person, kinds: KINDS, onOpenChange: () => undefined, onConnected: mocks.connected,
    })))
    await settle()
    expect(button("Connect")?.disabled).toBe(true)
  })
})
