import { describe, expect, it } from "vitest"

import { projectBrandFor, projectDepartment } from "@/lib/project-branding"

describe("project branding", () => {
  it.each([
    ["O-202-595", "O"],
    ["H-OFFICE", "H"],
    ["N-830-8220", "N"],
    ["D-18-00", "D"],
  ])("detects the %s department", (projectNumber, department) => {
    expect(projectDepartment({ projectNumber })).toBe(department)
  })

  it("can infer the department from a Compass project id", () => {
    expect(projectDepartment({ projectId: "proj-bt-o-197-litten" })).toBe("O")
  })

  it("uses the ORC identity for both ORC and Design projects", () => {
    const orc = projectBrandFor({ projectNumber: "O-202-595" })
    const design = projectBrandFor({ projectNumber: "D-18-00" })

    expect(design.companyName).toBe(orc.companyName)
    expect(design.logoSrc).toBe(orc.logoSrc)
    expect(design.department).toBe("D")
  })

  it("uses distinct HPS and Nu-Tech identities", () => {
    expect(projectBrandFor({ projectNumber: "H-OFFICE" })).toMatchObject({
      companyName: "High Performance Structures, Inc.",
      logoSrc: "/department-logos/hps-h-green.svg",
    })
    expect(projectBrandFor({ projectNumber: "N-830-8220" })).toMatchObject({
      companyName: "Nu-Tech Systems",
      logoSrc: "/department-logos/nu-tech-n.png",
    })
  })

  it("keeps HPS as the safe fallback for unnumbered legacy projects", () => {
    expect(projectBrandFor({})).toMatchObject({
      department: "H",
      companyName: "High Performance Structures, Inc.",
    })
  })
})
