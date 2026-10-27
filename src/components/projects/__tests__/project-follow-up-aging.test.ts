// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectInteractionFormOptions } from "@/app/actions/project-profile"
import type { SearchableComboboxProps } from "@/components/searchable-combobox"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"

const actions = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(async () => ({ success: true })),
  snooze: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }))
vi.mock("@/app/actions/project-profile", () => ({
  getProjectInteractionFormOptions: actions.options,
  createProjectInteraction: actions.create,
  snoozeProjectFollowUp: actions.snooze,
}))
// Native selection keeps these tests focused on project ownership, using the real interaction form.
vi.mock("@/components/searchable-combobox", () => ({
  SearchableCombobox: (props: SearchableComboboxProps) => React.createElement("select", {
    id: props.id,
    "aria-label": props.ariaLabel,
    value: props.value,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onValueChange(event.target.value),
  }, React.createElement("option", { value: "" }, props.placeholder),
  ...props.options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))),
}))

import { FollowUpSection } from "../project-follow-up-aging"

const signal: ProjectFollowUpSignal = {
  level: "due", businessDaysSinceLastTouch: 3, lastContactAt: null,
  nextFollowUpAt: null, thresholds: { dueDays: 3, overdueDays: 4 },
}
function options(id: string, displayName: string): ProjectInteractionFormOptions {
  return {
    contacts: [{ id, displayName }],
    interactionTypes: [{ id: "call", label: "Call" }],
    rules: { minimumSummaryCharacters: 15, maximumBackdateDays: 30 },
  }
}
const scottOptions = options("scott-contact", "Scott Thompson")
const squiresOptions = options("squires-contact", "Squires client")

describe("FollowUpSection project switching", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.clearAllMocks()
    actions.options.mockImplementation(async (id: string) => ({
      success: true, options: id === "scott" ? scottOptions : squiresOptions,
    }))
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })
  async function render(projectId: string): Promise<void> {
    await act(async () => root.render(React.createElement(FollowUpSection, { projectId, signal, compact: true })))
  }
  async function click(label: string): Promise<void> {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    await act(async () => button.click())
  }
  function contacts(): string[] {
    return [...document.querySelectorAll('select[aria-label="Client contact"] option')].map((option) => option.textContent ?? "")
  }
  async function select(label: string, value: string): Promise<void> {
    const element = document.querySelector(`select[aria-label="${label}"]`)
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing select: ${label}`)
    await act(async () => {
      element.value = value
      element.dispatchEvent(new Event("change", { bubbles: true }))
    })
  }
  async function setSummary(value: string): Promise<void> {
    const element = document.querySelector("textarea")
    if (!(element instanceof HTMLTextAreaElement)) throw new Error("Missing interaction summary")
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    if (!setter) throw new Error("Missing textarea value setter")
    await act(async () => {
      setter.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  async function log(contactId: string): Promise<void> {
    await select("Client contact", contactId)
    await select("Interaction type", "call")
    await click("We contacted them")
    await click("Now")
    await setSummary("Discussed the estimate and agreed on next steps.")
    await click("Log interaction")
  }

  it("loads and saves Squires contacts after logging Scott's interaction in the same panel", async () => {
    await render("scott")
    await click("Log contact")
    expect(contacts()).toContain("Scott Thompson")
    await log("scott-contact")
    expect(actions.create).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "scott", contactId: "scott-contact" }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await render("squires")
    await click("Log contact")
    expect(actions.options).toHaveBeenLastCalledWith("squires")
    expect(contacts()).toContain("Squires client")
    expect(contacts()).not.toContain("Scott Thompson")
    await log("squires-contact")
    expect(actions.create).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "squires", contactId: "squires-contact" }))
  })

  it("does not let Scott's delayed contact response replace Squires' options", async () => {
    let resolveScott: ((result: { readonly success: true; readonly options: ProjectInteractionFormOptions }) => void) | undefined
    actions.options.mockImplementationOnce(() => new Promise((resolve) => { resolveScott = resolve }))
    await render("scott")
    await click("Log contact")
    expect(document.body.textContent).toContain("Loading client contacts")
    await click("Close")
    await render("squires")
    await click("Log contact")
    expect(contacts()).toContain("Squires client")
    if (!resolveScott) throw new Error("Missing pending Scott load")
    await act(async () => resolveScott?.({ success: true, options: scottOptions }))
    expect(contacts()).toContain("Squires client")
    expect(contacts()).not.toContain("Scott Thompson")
  })

  it("closes an old project's draft and clears its selections when the project changes", async () => {
    await render("scott")
    await click("Log contact")
    await select("Client contact", "scott-contact")
    await select("Interaction type", "call")
    await setSummary("Unfinished notes for Scott only")
    await render("squires")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click("Log contact")
    expect(contacts()).toContain("Squires client")
    expect(document.querySelector("textarea")?.value).toBe("")
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Client contact"]')?.value).toBe("")
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Interaction type"]')?.value).toBe("")
    expect(actions.create).not.toHaveBeenCalled()
  })
})
