import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  buildCherishNavigation,
  buildMainNavigation,
} from "@/components/app-sidebar"
import type { NavGroupItem } from "@/components/nav-main"

function officeNavigation(
  canUseExecutiveAdmin: boolean,
): NavGroupItem | undefined {
  return buildMainNavigation({
    activeProjectId: null,
    canViewActivity: true,
    canManageFeedback: false,
    canUseExecutiveAdmin,
  }).find(
    (item): item is NavGroupItem =>
      item.kind === "group" && item.title === "Office Tools",
  )
}

function projectsNavigation(
  activeProjectId: string | null,
  projectConversationReturnHref: string | null = null,
): NavGroupItem | undefined {
  return buildMainNavigation({
    activeProjectId,
    projectConversationReturnHref,
    canViewActivity: true,
    canManageFeedback: false,
    canUseExecutiveAdmin: false,
  }).find(
    (item): item is NavGroupItem =>
      item.kind === "group" && item.title === "Projects",
  )
}

describe("Projects sidebar navigation", () => {
  it("keeps All Projects and adds the active project's Overview", () => {
    const projects = projectsNavigation("project-123")
    const links = projects?.items.filter((item) => item.kind === "link") ?? []

    expect(links).toMatchObject([
      {
        title: "All Projects",
        url: "/dashboard/projects",
      },
      {
        title: "Overview",
        url: "/dashboard/projects/project-123",
      },
    ])
  })

  it("sends Overview to the picker when no project is active", () => {
    const projects = projectsNavigation(null)
    const overview = projects?.items.find(
      (item) => item.kind === "link" && item.title === "Overview",
    )

    expect(overview).toMatchObject({
      kind: "link",
      url: "/dashboard/projects/select",
    })
  })

  it("records the current project location in the conversations link", () => {
    const projects = projectsNavigation(
      "project-123",
      "/dashboard/projects/project-123/schedule?view=gantt",
    )
    const collaboration = projects?.items.find(
      (item) =>
        item.kind === "subgroup" && item.title === "Collaboration & Access",
    )
    const conversations =
      collaboration?.kind === "subgroup"
        ? collaboration.items.find(
            (item) =>
              item.kind === "link" && item.title === "Project Conversations",
          )
        : undefined
    const url = new URL(
      conversations?.kind === "link" ? conversations.url : "",
      "https://compass.local",
    )

    expect(url.pathname).toBe(
      "/dashboard/projects/project-123/conversations",
    )
    expect(url.searchParams.get("returnTo")).toBe(
      "/dashboard/projects/project-123/schedule?view=gantt",
    )
  })
})

describe("restricted sidebar navigation", () => {
  it("shows review and archive links to staff granted both permissions", () => {
    const office = officeNavigation(true)
    const executiveAdmin = office?.items.find(
      (item) => item.kind === "subgroup" && item.title === "Restricted Workflows",
    )

    expect(executiveAdmin).toMatchObject({
      kind: "subgroup",
      title: "Restricted Workflows",
      items: [
        {
          kind: "link",
          title: "CHERISH Review",
          url: "/dashboard/executive-admin/cherish",
        },
        {
          kind: "link",
          title: "Project Archive",
          url: "/dashboard/executive-admin/project-archive",
        },
      ],
    })
  })

  it("removes the restricted subgroup without a grant", () => {
    const office = officeNavigation(false)

    expect(
      office?.items.some(
        (item) => item.kind === "subgroup" && item.title === "Restricted Workflows",
      ),
    ).toBe(false)
  })

  it("shows Project Archive without exposing CHERISH when only archive access is granted", () => {
    const office = buildMainNavigation({
      activeProjectId: null,
      canViewActivity: true,
      canManageFeedback: false,
      canUseExecutiveAdmin: false,
      canViewProjectArchive: true,
    }).find(
      (item): item is NavGroupItem =>
        item.kind === "group" && item.title === "Office Tools",
    )
    const restricted = office?.items.find(
      (item) => item.kind === "subgroup" && item.title === "Restricted Workflows",
    )
    expect(restricted).toMatchObject({
      kind: "subgroup",
      items: [{ title: "Project Archive" }],
    })
  })
})

describe("Greeting Cards sidebar navigation", () => {
  it("shows the office greeting-card workspace to preparers", () => {
    const office = buildMainNavigation({
      activeProjectId: null,
      canViewActivity: true,
      canManageFeedback: false,
      canUseExecutiveAdmin: false,
      canPrepareGreetingCards: true,
    }).find(
      (item): item is NavGroupItem =>
        item.kind === "group" && item.title === "Office Tools",
    )

    expect(
      office?.items.find(
        (item) => item.kind === "link" && item.title === "Greeting Cards",
      ),
    ).toMatchObject({
      kind: "link",
      url: "/dashboard/cards",
    })
  })

  it("hides the card workspace when a role cannot prepare cards", () => {
    const office = officeNavigation(false)
    expect(
      office?.items.some(
        (item) => item.kind === "link" && item.title === "Greeting Cards",
      ),
    ).toBe(false)
  })
})

describe("CHERISH sidebar navigation", () => {
  it("opens the dedicated full Compass page for eligible team members", () => {
    expect(buildCherishNavigation(true)).toMatchObject([
      {
        kind: "link",
        title: "CHERISH",
        url: "/dashboard/cherish",
      },
    ])
  })

  it("remains hidden from users without Field Desk access", () => {
    expect(buildCherishNavigation(false)).toEqual([])
  })
})
