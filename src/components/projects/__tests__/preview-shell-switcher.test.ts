import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ children, href }: { readonly children: React.ReactNode; readonly href: string }) => React.createElement("a", { href }, children),
}))
vi.mock("@/components/projects/project-audience-switcher", () => ({
  ProjectAudienceSwitcher: ({ projects }: { readonly projects: readonly { readonly id: string }[] }) =>
    React.createElement("div", { "data-testid": "job-switcher" }, projects.map((project) => project.id).join(",")),
}))
vi.mock("@/components/projects/project-audience-preview-window-controls", () => ({ ProjectAudiencePreviewWindowControls: () => null }))
vi.mock("@/components/projects/project-audience-header-controls", () => ({ ProjectAudienceHeaderControls: () => null }))
vi.mock("@/components/projects/project-audience-sidebar-profile", () => ({ ProjectAudienceSidebarProfile: () => null }))
vi.mock("@/components/release-stage-label", () => ({ ReleaseStageLabel: () => null }))

import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"

const jobs = [
  { id: "job-a", name: "A", projectNumber: "O-1", status: "active" },
  { id: "job-b", name: "B", projectNumber: "O-2", status: "active" },
]

function shell(viewerIsInternal: boolean): string {
  return renderToStaticMarkup(React.createElement(ProjectAudiencePreviewShell, {
    audience: "sub_vendor", projectId: "job-a", projectName: "A", projectNumber: "O-1", projectOptions: jobs,
    viewer: { name: "Doug", email: "doug@example.test", avatarUrl: null, sidebarPhotoUrl: null },
    viewerIsInternal, messageShortcut: null, children: null,
  }))
}

describe("preview job switcher", () => {
  // Staff preview sets viewerIsInternal; the person's job list is navigation,
  // not one of their own controls, so it stays.
  it("shows the previewed person's jobs in staff preview", () => {
    expect(shell(true)).toContain("job-a,job-b")
  })
  it("shows the person's jobs when they are signed in", () => {
    expect(shell(false)).toContain("job-a,job-b")
  })
})
