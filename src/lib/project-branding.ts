export type ProjectDepartment = "O" | "H" | "N" | "D"

export type ProjectBrand = {
  readonly companyName: string
  readonly department: ProjectDepartment
  readonly logoAlt: string
  readonly logoSrc: string
  readonly mailingAddress: readonly string[]
}

type BrandIdentity = Omit<ProjectBrand, "department">

const ORC_BRAND: BrandIdentity = {
  companyName: "Open Range Construction",
  logoAlt: "Open Range Construction",
  logoSrc: "/department-logos/orc-mark.png",
  mailingAddress: [],
}

const HPS_BRAND: BrandIdentity = {
  companyName: "High Performance Structures, Inc.",
  logoAlt: "High Performance Structures",
  logoSrc: "/department-logos/hps-h-green.svg",
  mailingAddress: ["P.O. Box 878", "Woodland Park, CO 80866"],
}

const NUTECH_BRAND: BrandIdentity = {
  companyName: "Nu-Tech Systems",
  logoAlt: "Nu-Tech Systems",
  logoSrc: "/department-logos/nu-tech-n.png",
  mailingAddress: [],
}

function isProjectDepartment(value: string): value is ProjectDepartment {
  return value === "O" || value === "H" || value === "N" || value === "D"
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
  projectId,
  projectNumber,
}: {
  readonly projectId?: string | null
  readonly projectNumber?: string | null
}): ProjectDepartment {
  return (
    departmentFromIdentifier(projectNumber) ??
    departmentFromIdentifier(projectId) ??
    "H"
  )
}

export function projectBrandFor({
  projectId,
  projectNumber,
}: {
  readonly projectId?: string | null
  readonly projectNumber?: string | null
}): ProjectBrand {
  const department = projectDepartment({ projectId, projectNumber })
  const identity =
    department === "H"
      ? HPS_BRAND
      : department === "N"
        ? NUTECH_BRAND
        : ORC_BRAND

  return {
    ...identity,
    department,
  }
}
