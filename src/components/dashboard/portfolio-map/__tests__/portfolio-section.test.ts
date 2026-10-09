// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"

vi.mock("next/dynamic", () => ({ default: () => () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/project-profile", () => ({ updateProjectMapVisibility: vi.fn(async () => ({ success: true })) }))
vi.mock("@/app/actions/portfolio-map", () => ({
  listProjectsToAddToMap: vi.fn(async () => [
    { id: "p20", name: "Breckenridge Residence", projectNumber: "H-300-1", statusLabel: "Complete" },
    { id: "p21", name: "Nu-Tech Order", projectNumber: "N-830-8220", statusLabel: "Ordered" },
  ]),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { readonly href: string; readonly children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}))

import { PortfolioSection } from "../portfolio-section"

const jobs: readonly PortfolioMapJob[] = [
  { id: "p1", name: "Granby Residence", projectNumber: "H-430-1900", phase: "construction", statusLabel: "Under Construction", town: "Granby", lon: -105.94, lat: 40.09, progress: 22, pastDueCount: 1, stalledCount: 0, nextTaskTitle: "Footing inspection", nextTaskStart: "2026-10-09", health: "late", visibility: "default" },
  { id: "p2", name: "Calhan Residence", projectNumber: null, phase: "permitting", statusLabel: "Permitting", town: "Calhan", lon: -104.3, lat: 39.03, progress: null, pastDueCount: 0, stalledCount: 0, nextTaskTitle: null, nextTaskStart: null, health: "ok", visibility: "default" },
]

describe("PortfolioSection", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const click = async (text: string): Promise<void> => {
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))
    if (!button) throw new Error(`Button not found: ${text}`)
    await act(async () => button.click())
  }

  it("falls back to the pipeline and opens a job's quick info with links into the job", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [{ id: "p9", name: "Twinkle Rd - Rogers Residence", projectNumber: "O-1" }], hidden: [{ id: "p7", name: "Compass Developer", projectNumber: "H-DEV", restoreVisibility: "shown" }], travel: null })))
    expect(container.textContent).toContain("1 BUILDING · 1 IN PIPELINE · 0 CLOSING OUT")
    expect(container.textContent).toContain("NEEDS ATTENTION · 1")
    expect(container.textContent).toContain("1 job is not on the map yet")
    expect(container.textContent).toContain("1 job is hidden from the map.")
    expect(container.querySelector('a[href="/dashboard/projects/p9/information"]')?.textContent).toContain("Twinkle Rd - Rogers Residence")

    await click("Granby Residence")
    expect(container.textContent).toContain("H-430-1900")
    expect(container.textContent).toContain("Footing inspection · Oct 9")
    expect(container.textContent).toContain("1 item")
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    expect(hrefs).toEqual(expect.arrayContaining(["/dashboard/projects/p1", "/dashboard/projects/p1/schedule", "/dashboard/projects/p1/daily-logs"]))

    await click("Hide from map")
    const actions = await import("@/app/actions/project-profile")
    expect(actions.updateProjectMapVisibility).toHaveBeenCalledWith({ projectId: "p1", visibility: "hidden" })

    await click("PIPELINE")
    expect(localStorage.getItem("compass:portfolio-view:v1")).toBe("pipeline")
  })

  it("adds a project that its status keeps off the map", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    const details = [...container.querySelectorAll("details")].find((item) => item.textContent?.includes("Add a project to the map"))
    if (!details) throw new Error("Add to map not found")
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event("toggle"))
      await Promise.resolve()
    })
    expect(container.textContent).toContain("2 projects are off the map by their status")
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search projects to add to the map"]')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
      setValue?.call(input, "breck")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(container.textContent).toContain("Breckenridge Residence")
    expect(container.textContent).not.toContain("Nu-Tech Order")
    await click("Add")
    const actions = await import("@/app/actions/project-profile")
    expect(actions.updateProjectMapVisibility).toHaveBeenCalledWith({ projectId: "p20", visibility: "shown" })
  })

  it("renders nothing when there are no mapped jobs", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs: [], unplaced: [], hidden: [], travel: null })))
    expect(container.innerHTML).toBe("")
  })
})
