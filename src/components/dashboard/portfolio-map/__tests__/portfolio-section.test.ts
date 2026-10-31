// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import type { SalesPipeline } from "@/lib/sales-pipeline/load"
import type { NotificationCenterItem } from "@/app/actions/notifications"

const inboxMock = vi.hoisted(() => {
  const items: NotificationCenterItem[] = []
  return { items, push: vi.fn(), markRead: vi.fn(async () => {}), done: vi.fn(async () => {}), enabled: vi.fn() }
})
vi.mock("@/hooks/use-notification-inbox", () => ({
  useNotificationInbox: (enabled: boolean) => {
    inboxMock.enabled(enabled)
    return { items: inboxMock.items, loaded: true, markRead: inboxMock.markRead, done: inboxMock.done }
  },
}))

vi.mock("next/dynamic", () => ({ default: () => ({ onSelectJob, onSelectNotification }: {
  readonly onSelectJob: (id: string) => void
  readonly onSelectNotification: (id: string) => void
}) => React.createElement("div", null,
  React.createElement("button", { onClick: () => onSelectJob("p1") }, "Select Granby on map"),
  React.createElement("button", { onClick: () => onSelectNotification("rfi") }, "Open map notification")) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: inboxMock.push }), useSearchParams: () => new URLSearchParams() }))
vi.mock("@/app/actions/project-profile", () => ({
  updateProjectMapVisibility: vi.fn(async () => ({ success: true })),
  updateProjectJobStatus: vi.fn(async () => ({ success: true })),
  updateProjectDeliveryMethod: vi.fn(async () => ({ success: true })),
}))
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
  { id: "p1", name: "Granby Residence", projectNumber: "H-430-1900", phase: "construction", jobStatusId: "under_construction", statusLabel: "Under Construction", town: "Granby", lon: -105.94, lat: 40.09, progress: 22, pastDueCount: 1, stalledCount: 0, nextTaskTitle: "Footing inspection", nextTaskStart: "2026-10-09", health: "late", visibility: "default", followUp: null, planSetDocumentId: null },
  { id: "p2", name: "Calhan Residence", projectNumber: null, phase: "permitting", jobStatusId: null, statusLabel: "Permitting", town: "Calhan", lon: -104.3, lat: 39.03, progress: null, pastDueCount: 0, stalledCount: 0, nextTaskTitle: null, nextTaskStart: null, health: "ok", visibility: "default", followUp: null, planSetDocumentId: null },
]

function notification(id: string, projectId: string, href: string, sourceType = "rfi"): NotificationCenterItem {
  return { id, eventId: `event-${id}`, projectId, href, sourceType, eventType: `${sourceType}.updated`,
    title: `Source ${id}`, body: "Updated record", priority: "normal", projectLabel: projectId,
    readAt: null, createdAt: "2026-10-31T15:00:00Z" }
}

describe("PortfolioSection", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    localStorage.clear()
    inboxMock.items.splice(0)
    vi.clearAllMocks()
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

  it("opens a single pipeline notification at its exact source before marking it read", async () => {
    const href = "/dashboard/projects/p1/rfis?status=all&item=rfi-1#rfi-rfi-1"
    inboxMock.items.push(notification("one", "p1", href))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    expect(inboxMock.enabled).toHaveBeenLastCalledWith(true)
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="1 unread notification for Granby Residence"]')
    expect(link?.getAttribute("href")).toBe(href)
    expect(link?.closest("button")).toBeNull()
    await act(async () => link?.click())
    expect(inboxMock.push).toHaveBeenCalledWith(href)
    expect(inboxMock.markRead).toHaveBeenCalledOnce()
    expect(inboxMock.push.mock.invocationCallOrder[0]).toBeLessThan(inboxMock.markRead.mock.invocationCallOrder[0] ?? 0)
  })

  it("shows a per-project source chooser for multiple pipeline notifications", async () => {
    inboxMock.items.push(notification("rfi", "p1", "/dashboard/projects/p1/rfis?item=rfi-1"),
      notification("mail", "p1", "/dashboard/projects/p1/communications?messageId=mail-1", "project_correspondence"),
      notification("other", "p2", "/dashboard/projects/p2/todos?item=todo-2", "task"))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    const chooser = container.querySelector<HTMLButtonElement>('button[aria-label="2 unread notifications for Granby Residence; show sources"]')
    expect(chooser).not.toBeNull()
    await act(async () => chooser?.click())
    const sources = container.querySelector('section[aria-label="Unread for this job"]')
    expect([...sources?.querySelectorAll("a") ?? []].map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/projects/p1/rfis?item=rfi-1", "/dashboard/projects/p1/communications?messageId=mail-1",
    ])
    expect(inboxMock.push).not.toHaveBeenCalled()
    const source = sources?.querySelector<HTMLAnchorElement>("a")
    await act(async () => source?.click())
    expect(inboxMock.push).toHaveBeenCalledWith("/dashboard/projects/p1/rfis?item=rfi-1")
  })

  it("keeps map-selected notification rows linked to their source even with the messages layer off", async () => {
    localStorage.setItem("compass:portfolio-view:v1", "map")
    inboxMock.items.push(notification("todo", "p1", "/dashboard/projects/p1/todos?item=todo-1", "task"))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    await click("Select Granby on map")
    const source = container.querySelector<HTMLAnchorElement>('section[aria-label="Unread for this job"] a')
    expect(source?.getAttribute("href")).toBe("/dashboard/projects/p1/todos?item=todo-1")
    await act(async () => source?.click())
    expect(inboxMock.push).toHaveBeenCalledWith("/dashboard/projects/p1/todos?item=todo-1")
  })

  it("preserves modified-click browser navigation without consuming the notification", async () => {
    const href = "/dashboard/projects/p1/communications?messageId=mail-1"
    inboxMock.items.push(notification("mail", "p1", href, "project_correspondence"))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="1 unread notification for Granby Residence"]')
    // Stop jsdom's eventual document navigation after React has handled the click.
    const preserveNative = (event: MouseEvent): void => {
      expect(event.defaultPrevented).toBe(false)
      event.preventDefault()
    }
    document.addEventListener("click", preserveNative, { once: true })
    await act(async () => link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })))
    expect(link?.getAttribute("href")).toBe(href)
    expect(inboxMock.push).not.toHaveBeenCalled()
    expect(inboxMock.markRead).not.toHaveBeenCalled()
  })

  it("opens the exact notification selected on a map tile", async () => {
    localStorage.setItem("compass:portfolio-view:v1", "map")
    const href = "/dashboard/projects/p1/rfis?status=all&item=rfi-1#rfi-rfi-1"
    inboxMock.items.push(notification("rfi", "p1", href), notification("second", "p1", "/dashboard/projects/p1/todos?item=todo-1", "task"))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    await click("Open map notification")
    expect(inboxMock.push).toHaveBeenCalledWith(href)
    expect(inboxMock.markRead).toHaveBeenCalledWith(expect.objectContaining({ latest: expect.objectContaining({ id: "rfi" }) }))
  })

  it("counts only unread items and targets the unread message in a conversation", async () => {
    inboxMock.items.push({ ...notification("read", "p1", "/dashboard/projects/p1/communications?messageId=read", "project_correspondence"), readAt: "2026-10-31T16:00:00Z" },
      notification("unread", "p1", "/dashboard/projects/p1/communications?messageId=unread", "project_correspondence"),
      notification("unrelated", "p99", "/dashboard/projects/p99/todos?item=todo-99", "task"))
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    const link = container.querySelector('a[aria-label="1 unread notification for Granby Residence"]')
    expect(link?.getAttribute("href")).toBe("/dashboard/projects/p1/communications?messageId=unread")
    expect(container.querySelector('a[href*="p99"]')).toBeNull()
  })

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

  it("links staff to each job's files from the pipeline and the job panel", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null, canOpenFiles: true })))
    expect(container.querySelector('a[href="/dashboard/projects/p1/documents"][aria-label="All files for Granby Residence"]')).not.toBeNull()
    await click("Granby Residence")
    const filesLink = [...container.querySelectorAll('a[href="/dashboard/projects/p1/documents"]')].find((link) => link.textContent?.includes("Files"))
    expect(filesLink).toBeDefined()
  })

  it("opens the pinned plan set from the pipeline, and greys it out when none is set", async () => {
    const withPlan: readonly PortfolioMapJob[] = [
      { ...jobs[0], planSetDocumentId: "doc-plan-1" },
      jobs[1],
    ]
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs: withPlan, unplaced: [], hidden: [], travel: null, canOpenFiles: true })))
    const planLink = container.querySelector('a[href="/api/projects/p1/documents/doc-plan-1/download"]')
    expect(planLink).not.toBeNull()
    expect(planLink?.getAttribute("target")).toBe("_blank")
    // p2 has no plan set, so it shows a disabled marker rather than a download link.
    expect(container.querySelector('a[href^="/api/projects/p2/documents/"]')).toBeNull()
  })

  it("hides the Files links unless the person can open project files", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    await click("Granby Residence")
    expect(container.querySelector('a[href$="/documents"]')).toBeNull()
  })

  const clickMove = async (status: string): Promise<void> => {
    const button = [...container.querySelectorAll("fieldset button")].find((item) => item.textContent === status)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Move button not found: ${status}`)
    await act(async () => button.click())
  }

  it("moves a project to another status from its panel, like the sales panel", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null })))
    await click("Granby Residence")
    expect(container.querySelector('fieldset button[aria-pressed="true"]')?.textContent).toBe("Under Construction")
    await clickMove("Punchlist")
    const actions = await import("@/app/actions/project-profile")
    expect(actions.updateProjectJobStatus).toHaveBeenCalledWith({ projectId: "p1", jobStatusId: "punchlist" })
    expect(container.querySelector('fieldset button[aria-pressed="true"]')?.textContent).toBe("Punchlist")
    expect(container.textContent).toContain("Punchlist")
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

  it("switches the portfolio to the Nu-Tech Sales pipeline and moves a job", async () => {
    inboxMock.items.push(notification("sales", "n1", "/dashboard/projects/n1/communications?messageId=sales", "project_correspondence"))
    const salesPipelines: readonly SalesPipeline[] = [{
      department: "N",
      title: "Nu-Tech Sales",
      jobs: [
        { id: "n1", name: "Fairplay Garage", projectNumber: "N-901", clientName: "Lee", assignedTo: "Rebekah", address: "12 Main St, Fairplay", town: "Fairplay", lon: -106, lat: 39.22, stage: "estimate_sent", jobStatusId: "estimate_sent", statusLabel: "Estimate Sent", deliveryMethod: null, updatedAt: null, followUp: null },
        { id: "n2", name: "Salida Shop", projectNumber: "N-902", clientName: null, assignedTo: null, address: null, town: "Salida", lon: -106, lat: 38.53, stage: "ordered", jobStatusId: "ordered", statusLabel: "Ordered", deliveryMethod: "pickup", updatedAt: null, followUp: null },
      ],
    }]
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null, salesPipelines })))
    expect(container.textContent).not.toContain("Fairplay Garage")

    await click("NU-TECH SALES")
    expect(localStorage.getItem("compass:portfolio-scope:v1")).toBe("N")
    expect(container.textContent).toContain("2 OPEN · 0 AWAITING PAYMENT · 1 ORDERED")
    expect(container.textContent).toContain("BRACING OUT")
    expect(container.textContent).not.toContain("Granby Residence")

    await click("Fairplay Garage")
    expect(container.querySelector('section[aria-label="Unread for this job"] a')?.getAttribute("href"))
      .toBe("/dashboard/projects/n1/communications?messageId=sales")
    expect(container.querySelector('a[aria-label="1 unread notification for Fairplay Garage"]')).not.toBeNull()
    expect(container.textContent).toContain("12 Main St, Fairplay")
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    expect(hrefs).toEqual(expect.arrayContaining(["/dashboard/projects/n1", "/dashboard/projects/n1/information"]))
    await clickMove("Follow-up")
    const actions = await import("@/app/actions/project-profile")
    expect(actions.updateProjectJobStatus).toHaveBeenCalledWith({ projectId: "n1", jobStatusId: "follow_up" })
    await click("Customer pickup")
    expect(actions.updateProjectDeliveryMethod).toHaveBeenCalledWith({ projectId: "n1", deliveryMethod: "pickup" })

    await click("PROJECTS")
    expect(localStorage.getItem("compass:portfolio-scope:v1")).toBeNull()
    expect(container.textContent).toContain("Granby Residence")
    expect(container.textContent).not.toContain("Fairplay Garage")
  })

  it("renders nothing when there are no mapped jobs", async () => {
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs: [], unplaced: [], hidden: [], travel: null })))
    expect(container.innerHTML).toBe("")
  })

  it("keeps offices and yards on their own Internal view", async () => {
    inboxMock.items.push(notification("yard", "proj-wp-yard", "/dashboard/projects/proj-wp-yard/duty-log?item=yard-item", "task"))
    const office = { ...jobs[1], id: "proj-h-office", name: "H-Office", workspaceKind: "office" as const, address: "1304 E. Kiowa St." }
    const yard = { ...jobs[1], id: "proj-wp-yard", name: "Woodland Park Yard", workspaceKind: "field" as const, address: null }
    await act(async () => root.render(React.createElement(PortfolioSection, { jobs, unplaced: [], hidden: [], travel: null, internal: [office, yard] })))
    expect(container.textContent).not.toContain("H-Office")

    await click("INTERNAL")
    expect(container.textContent).toContain("1 OFFICE · 1 FIELD")
    expect(container.textContent).not.toContain("Granby Residence")
    await click("Woodland Park Yard")
    expect(container.querySelector('section[aria-label="Unread for this job"] a')?.getAttribute("href"))
      .toBe("/dashboard/projects/proj-wp-yard/duty-log?item=yard-item")
    expect(container.querySelector('a[aria-label="1 unread notification for Woodland Park Yard"]')).not.toBeNull()
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    expect(hrefs).toEqual(expect.arrayContaining(["/dashboard/projects/proj-wp-yard", "/dashboard/projects/proj-wp-yard/duty-log", "/dashboard/projects/proj-wp-yard/information"]))
  })
})
