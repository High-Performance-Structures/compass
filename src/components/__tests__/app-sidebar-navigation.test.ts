import { describe, expect, it } from "vitest"

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
      item.kind === "group" && item.title === "Office",
  )
}

describe("Executive Admin sidebar navigation", () => {
  it("shows the nested CHERISH review link to Executive Admin users", () => {
    const office = officeNavigation(true)
    const executiveAdmin = office?.items.find(
      (item) => item.kind === "subgroup" && item.title === "Executive Admin",
    )

    expect(executiveAdmin).toMatchObject({
      kind: "subgroup",
      title: "Executive Admin",
      items: [
        {
          kind: "link",
          title: "CHERISH Review",
          url: "/dashboard/executive-admin/cherish",
        },
      ],
    })
  })

  it("removes the entire Executive Admin subgroup for everyone else", () => {
    const office = officeNavigation(false)

    expect(
      office?.items.some(
        (item) => item.kind === "subgroup" && item.title === "Executive Admin",
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
