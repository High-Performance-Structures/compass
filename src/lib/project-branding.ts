import {
  addressLines,
  DEFAULT_DEPARTMENT_PROFILES,
  departmentLogoSrc,
  type DepartmentProfiles,
} from "@/lib/department-profiles"

export type ProjectDepartment = "O" | "H" | "N" | "D"

export type ProjectBrand = {
  readonly companyName: string
  readonly legalName: string
  readonly contactLines: readonly string[]
  readonly department: ProjectDepartment
  readonly email: string
  readonly logoAlt: string
  readonly logoSrc: string
  readonly mailingAddress: readonly string[]
  readonly telephone: string
  readonly website: string
  readonly licenseNumber: string
}

export function isProjectDepartment(value: string): value is ProjectDepartment {
  return value === "O" || value === "H" || value === "N" || value === "D"
}

export function projectDepartmentFromDivisionLabel(
  value: string | null | undefined,
): ProjectDepartment | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "") ?? ""
  if (normalized === "O" || normalized === "ORC") return "O"
  if (normalized === "H" || normalized === "HPS") return "H"
  if (normalized === "N" || normalized === "NUTECH") return "N"
  if (normalized === "D" || normalized === "DESIGN") return "D"
  return null
}

function departmentFromIdentifier(
  value: string | null | undefined
): ProjectDepartment | null {
  const normalized = value?.trim().toUpperCase() ?? ""
  if (normalized.length === 0) return null

  const segments = normalized.split(/[^A-Z0-9]+/).filter(Boolean)
  for (const segment of segments) {
    if (isProjectDepartment(segment)) return segment
  }

  return null
}

export function projectDepartment({
  department,
  projectId,
  projectNumber,
}: {
  readonly department?: string | null
  readonly projectId?: string | null
  readonly projectNumber?: string | null
}): ProjectDepartment {
  return resolvedProjectDepartment({ department, projectId, projectNumber }) ?? "H"
}

export function resolvedProjectDepartment({
  department,
  projectId,
  projectNumber,
}: {
  readonly department?: string | null
  readonly projectId?: string | null
  readonly projectNumber?: string | null
}): ProjectDepartment | null {
  const normalizedDepartment = department?.trim().toUpperCase() ?? ""
  return (
    (isProjectDepartment(normalizedDepartment) ? normalizedDepartment : null) ??
    departmentFromIdentifier(projectNumber) ??
    departmentFromIdentifier(projectId)
  )
}

/**
 * A project's brand from its department's profile. Pass the company's saved
 * profiles (readDepartmentProfiles) wherever they are available; without
 * them the built-in defaults are used.
 */
export function projectBrandFor({
  department: explicitDepartment,
  projectId,
  projectNumber,
  profiles = DEFAULT_DEPARTMENT_PROFILES,
}: {
  readonly department?: string | null
  readonly projectId?: string | null
  readonly projectNumber?: string | null
  readonly profiles?: DepartmentProfiles
}): ProjectBrand {
  const department = projectDepartment({
    department: explicitDepartment,
    projectId,
    projectNumber,
  })
  return brandForDepartment(department, profiles)
}

export function brandForDepartment(department: ProjectDepartment, profiles: DepartmentProfiles = DEFAULT_DEPARTMENT_PROFILES): ProjectBrand {
  const profile = profiles[department]
  const mailingAddress = addressLines(profile.mailingAddress)
  return {
    companyName: profile.companyName,
    legalName: profile.legalName,
    email: profile.email,
    telephone: profile.telephone,
    website: profile.website,
    licenseNumber: profile.licenseNumber,
    logoAlt: profile.companyName,
    logoSrc: departmentLogoSrc(department, profile),
    mailingAddress,
    contactLines: [
      ...mailingAddress,
      ...(profile.telephone ? [`Tel: ${profile.telephone}`] : []),
      ...(profile.email ? [`Email: ${profile.email}`] : []),
    ],
    department,
  }
}

// Department displays and project documents must resolve names here so the
// operating brand and contracting entity cannot drift between surfaces.
export function projectLegalEntityName(
  department: ProjectDepartment,
  profiles: DepartmentProfiles = DEFAULT_DEPARTMENT_PROFILES,
): string {
  return profiles[department].legalName
}

export function projectDepartmentDisplayName(
  department: ProjectDepartment,
  profiles: DepartmentProfiles = DEFAULT_DEPARTMENT_PROFILES,
): string {
  return profiles[department].displayName
}
