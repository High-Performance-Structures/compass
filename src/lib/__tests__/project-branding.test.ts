import { describe, expect, it } from "vitest"
import { statSync } from "node:fs"
import { join } from "node:path"

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

  it.each([
    ["O-202-595", "Open Range Construction", "/department-logos/orc-mark.png"],
    ["D-18-00", "Open Range Construction", "/department-logos/orc-mark.png"],
    ["H-OFFICE", "High Performance Structures, Inc.", "/department-logos/hps-h-green.svg"],
    ["N-830-8220", "Nu-Tech Systems", "/department-logos/nu-tech-n.png"],
  ])(
    "maps %s to a deployable department logo",
    (projectNumber, companyName, logoSrc) => {
      expect(projectBrandFor({ projectNumber })).toMatchObject({
        companyName,
        logoSrc,
      })
      expect(
        statSync(join(process.cwd(), "public", logoSrc)).size
      ).toBeGreaterThan(0)
    }
  )

  it("keeps HPS as the safe fallback for unnumbered legacy projects", () => {
    expect(projectBrandFor({})).toMatchObject({
      department: "H",
      companyName: "High Performance Structures, Inc.",
    })
  })
})
