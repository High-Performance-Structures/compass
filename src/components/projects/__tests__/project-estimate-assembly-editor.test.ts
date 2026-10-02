// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { ProjectEstimateLineItem } from "@/app/actions/project-estimates"

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock("@/app/actions/estimate-assemblies", () => ({ saveProjectEstimateAssembly: mocks.save, deleteProjectEstimateAssembly: mocks.remove }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ProjectEstimateAssemblyEditor } from "@/components/projects/project-estimate-assembly-editor"

const assembly = { id: "foundation", name: "Foundation", description: null, sortOrder: 0 }
const lines: readonly ProjectEstimateLineItem[] = [
  { id: "earth", divisionCode: "31", divisionName: "Earthwork", costCode: "31-100", description: "Excavation", lineTotalCents: 1200000 },
  { id: "concrete", divisionCode: "03", divisionName: "Concrete", costCode: "03-100", description: "Footings", lineTotalCents: 1800000 },
].map((line, sortOrder) => ({ ...line, reportPhaseId: null, costItems: [], assemblyId: "foundation", costCodeName: line.description, specifications: null,
  quantity: 1, unit: "LS", unitCostCents: line.lineTotalCents, directCostCents: line.lineTotalCents,
  markupRateBasisPoints: 0, markupCents: 0, taxable: false, taxEntityId: null, taxCode: null, taxName: null,
  taxRateBasisPoints: 0, taxCents: 0, ownerVisible: true, includeInBuilderFee: true, sortOrder,
}))
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ success: true, id: "foundation" })
  mocks.remove.mockResolvedValue({ success: true, id: "foundation" })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(ProjectEstimateAssemblyEditor, { projectId: "project", estimateId: "estimate", assembly, assemblies: [assembly], lines })))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function clickButton(text: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => button.click())
}

describe("assembly editing interactions", () => {
  it("updates the live subtotal and saves the selected cross-division items", async () => {
    await clickButton("Edit assembly")
    expect(document.body.textContent).toContain("$30,000.00")
    const label = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes("31-100"))
    const checkbox = label?.querySelector("input")
    if (!checkbox) throw new Error("Item checkbox not found")
    await act(async () => checkbox.click())
    expect(document.body.textContent).toContain("$18,000.00")
    const form = document.querySelector("form")
    if (!form) throw new Error("Assembly form not found")
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(mocks.save).toHaveBeenCalledWith("project", "estimate", "foundation", { name: "Foundation", description: "", lineIds: ["concrete"] })
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it("requires deletion confirmation and explains that estimate items remain", async () => {
    await clickButton("Edit assembly")
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false)
    await clickButton("Delete assembly")
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining("items and costs will be kept"))
    confirmation.mockReturnValue(true)
    await clickButton("Delete assembly")
    expect(mocks.remove).toHaveBeenCalledWith("project", "estimate", "foundation")
  })

  it("keeps the editor open if saving fails", async () => {
    mocks.save.mockResolvedValue({ success: false, error: "Estimate locked" })
    await clickButton("Edit assembly")
    const form = document.querySelector("form")
    if (!form) throw new Error("Assembly form not found")
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(document.querySelector("form")).not.toBeNull()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
