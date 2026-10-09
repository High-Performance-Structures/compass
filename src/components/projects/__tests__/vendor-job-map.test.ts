import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/app/actions/portfolio-map", () => ({ getVendorJobScope: vi.fn() }))

import { VendorJobMap } from "@/components/projects/vendor-job-map"

function job(id: string, name: string, town: string | null): PortfolioMapJob {
  return {
    id, name, projectNumber: null, phase: "construction", statusLabel: "Current",
    town, lon: town ? -105.9 : null, lat: town ? 40.1 : null, progress: null,
    pastDueCount: 0, stalledCount: 0, nextTaskTitle: null, nextTaskStart: null,
    health: "ok", visibility: "default",
  }
}

describe("VendorJobMap", () => {
  it("lists only the jobs it is given and starts on the current job", () => {
    const markup = renderToStaticMarkup(React.createElement(VendorJobMap, {
      jobs: [job("a", "Ezell Residence", "Granby"), job("b", "Loomis Barn", null)],
      currentProjectId: "a",
    }))
    expect(markup).toContain("2 ASSIGNED")
    expect(markup).toContain("Ezell Residence")
    expect(markup).toContain("Loomis Barn")
    expect(markup).toContain("You&#x27;re viewing this job.")
    expect(markup).not.toMatch(/past due|on track|%/i)
  })

  it("renders nothing without jobs", () => {
    expect(renderToStaticMarkup(React.createElement(VendorJobMap, { jobs: [], currentProjectId: "a" }))).toBe("")
  })
})
