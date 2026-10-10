import { describe, expect, it } from "vitest"
import { DEFAULT_DEPARTMENT_PROFILES, type DepartmentProfiles } from "@/lib/department-profiles"
import { canEditFeatureSettings, departmentProfilesSchema, parseFeatureSettings } from "@/lib/feature-settings/registry"
import { projectBrandFor, projectDepartmentDisplayName, projectLegalEntityName } from "@/lib/project-branding"

const custom: DepartmentProfiles = {
  ...DEFAULT_DEPARTMENT_PROFILES,
  H: {
    ...DEFAULT_DEPARTMENT_PROFILES.H,
    companyName: "Example Builders",
    legalName: "Example Builders LLC",
    telephone: "555-0100",
    email: "office@example.com",
    mailingAddress: "1 Main St\nAnytown, CO 80000",
    logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  },
}

describe("department profiles", () => {
  it("builds document branding from the saved profile", () => {
    const brand = projectBrandFor({ projectNumber: "H-430-1900", profiles: custom })
    expect(brand.companyName).toBe("Example Builders")
    expect(brand.logoSrc).toBe("data:image/png;base64,iVBORw0KGgo=")
    expect(brand.contactLines).toEqual(["1 Main St", "Anytown, CO 80000", "Tel: 555-0100", "Email: office@example.com"])
    expect(projectLegalEntityName("H", custom)).toBe("Example Builders LLC")
  })

  it("falls back to the built-in defaults and logo", () => {
    const brand = projectBrandFor({ projectNumber: "N-901" })
    expect(brand.logoSrc).toBe("/department-logos/nu-tech-n.png")
    expect(projectDepartmentDisplayName("N")).toBe(DEFAULT_DEPARTMENT_PROFILES.N.displayName)
  })

  it("lets only the owner-admin edit company identity", () => {
    expect(canEditFeatureSettings("admin", "department-profiles")).toBe(true)
    expect(canEditFeatureSettings("secondary_admin", "department-profiles")).toBe(false)
    expect(canEditFeatureSettings("secondary_admin", "project-aging")).toBe(true)
  })

  it("accepts only PNG logo uploads and falls back on invalid stored values", () => {
    const withJpeg = { departments: { ...custom, O: { ...custom.O, logoDataUrl: "data:image/jpeg;base64,AAAA" } } }
    expect(departmentProfilesSchema.safeParse(withJpeg).success).toBe(false)
    expect(departmentProfilesSchema.safeParse({ departments: custom }).success).toBe(true)
    expect(parseFeatureSettings("department-profiles", JSON.stringify(withJpeg)).departments).toEqual(DEFAULT_DEPARTMENT_PROFILES)
  })
})
