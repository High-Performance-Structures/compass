export type ProjectDepartment = "O" | "H" | "N" | "D"

export type ProjectBrand = {
  readonly companyName: string
  readonly contactLines: readonly string[]
  readonly department: ProjectDepartment
  readonly email: string
  readonly logoAlt: string
  readonly logoSrc: string
  readonly mailingAddress: readonly string[]
  readonly telephone: string
}

const PROJECT_LEGAL_ENTITY_NAMES: Readonly<Record<ProjectDepartment, string>> = {
  O: "High Performance Structures Inc. dba Open Range Construction, Ltd.",
  D: "High Performance Structures Inc. dba Open Range Construction, Ltd.",
  N: "High Performance Structures Inc. dba Nu-Tech Systems",
  H: "High Performance Structures Inc.",
}

type BrandIdentity = Omit<ProjectBrand, "contactLines" | "department">

const ORC_BRAND: BrandIdentity = {
  companyName: "Open Range Construction, Ltd.",
  email: "accounting@openrangeconstruction.com",
  logoAlt: "Open Range Construction, Ltd.",
  logoSrc: "/department-logos/orc-mark.png",
  mailingAddress: ["PO Box 9046", "Woodland Park, CO 80866"],
  telephone: "719.630.8767",
}

const HPS_BRAND: BrandIdentity = {
  companyName: "High Performance Structures, Inc.",
  email: "accounting@hps-colorado.com",
  logoAlt: "High Performance Structures",
  logoSrc: "/department-logos/hps-h-green.svg",
  mailingAddress: ["PO Box 1813", "Woodland Park, CO 80866"],
  telephone: "719.900.8850",
}

const NUTECH_BRAND: BrandIdentity = {
  companyName: "Nu-Tech Systems",
  email: "orders@nutechcolorado.com",
  logoAlt: "Nu-Tech Systems",
  logoSrc: "/department-logos/nu-tech-n.png",
  mailingAddress: ["PO Box 1813", "Woodland Park, CO 80866"],
  telephone: "719.686.0770",
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
    contactLines: [
      ...identity.mailingAddress,
      `Tel: ${identity.telephone}`,
      `Email: ${identity.email}`,
    ],
    department,
  }
}

export function projectLegalEntityName(
  department: ProjectDepartment
): string {
  return PROJECT_LEGAL_ENTITY_NAMES[department]
}
