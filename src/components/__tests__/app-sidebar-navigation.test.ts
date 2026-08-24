import { describe, expect, it } from "vitest"

import { buildMainNavigation } from "@/components/app-sidebar"

function officeNavigation(canUseExecutiveAdmin: boolean) {
  return buildMainNavigation({
    activeProjectId: null,
    canViewActivity: true,
    canManageFeedback: false,
    canUseExecutiveAdmin,
  }).find((item) => item.kind === "group" && item.title === "Office")
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
