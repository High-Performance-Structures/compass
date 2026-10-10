import type { ProjectDepartment } from "@/lib/project-branding"

/**
 * A department's (or company's) identity as it appears on documents, emails,
 * portals and print views. Edited by the owner-admin in Settings → Company;
 * see "Company identity and templates" in the UI standards.
 */
export type DepartmentProfile = {
  /** Full name shown in the app and on department labels. */
  readonly displayName: string
  /** Short label for tabs and tiles ("ORC", "Nu-Tech"). */
  readonly shortName: string
  /** One line describing the department's work, shown on the Projects hub. */
  readonly description: string
  /** Name on letterhead and in email signatures. */
  readonly companyName: string
  /** Contracting entity, including any dba. */
  readonly legalName: string
  readonly email: string
  readonly telephone: string
  /** One address line per line. */
  readonly mailingAddress: string
  readonly website: string
  readonly licenseNumber: string
  readonly officeHours: string
  /** Workspace mailbox this department's emails are sent from; blank uses the sender's own address. */
  readonly senderAddress: string
  readonly senderName: string
  /** Uploaded PNG logo as a data URL; blank uses the built-in logo. */
  readonly logoDataUrl: string
}

export type DepartmentProfiles = Readonly<Record<ProjectDepartment, DepartmentProfile>>

export const DEPARTMENT_CODES: readonly ProjectDepartment[] = ["O", "H", "N", "D"]

/** Logos shipped with Compass, used until a company uploads its own. */
export const BUILT_IN_DEPARTMENT_LOGOS: Readonly<Record<ProjectDepartment, string>> = {
  O: "/department-logos/orc-mark.png",
  H: "/department-logos/hps-h-green.svg",
  N: "/department-logos/nu-tech-n.png",
  D: "/department-logos/orc-mark.png",
}

/**
 * The defaults a company starts from. These are the only place identity
 * values may be written in code; everything else reads the saved profiles.
 */
export const DEFAULT_DEPARTMENT_PROFILES: DepartmentProfiles = {
  O: {
    shortName: "ORC",
    description: "Custom builds and owner-facing construction.",
    displayName: "Open Range Construction, Ltd.",
    companyName: "Open Range Construction, Ltd.",
    legalName: "High Performance Structures Inc. dba Open Range Construction, Ltd.",
    email: "accounting@openrangeconstruction.com",
    telephone: "719.630.8767",
    mailingAddress: "PO Box 9046\nWoodland Park, CO 80866",
    website: "",
    licenseNumber: "",
    officeHours: "",
    senderAddress: "",
    senderName: "",
    logoDataUrl: "",
  },
  H: {
    shortName: "HPS",
    description: "Subcontracted scopes of work and internal construction.",
    displayName: "High Performance Structures",
    companyName: "High Performance Structures Inc.",
    legalName: "High Performance Structures Inc.",
    email: "accounting@hps-colorado.com",
    telephone: "719.900.8850",
    mailingAddress: "PO Box 1813\nWoodland Park, CO 80866",
    website: "",
    licenseNumber: "",
    officeHours: "",
    senderAddress: "",
    senderName: "",
    logoDataUrl: "",
  },
  N: {
    shortName: "Nu-Tech",
    description: "ICF sales, bracing rental, support, and related projects.",
    displayName: "Nu-Tech Systems",
    companyName: "Nu-Tech Systems",
    legalName: "High Performance Structures Inc. dba Nu-Tech Systems",
    email: "orders@nutechcolorado.com",
    telephone: "719.686.0770",
    mailingAddress: "PO Box 1813\nWoodland Park, CO 80866",
    website: "",
    licenseNumber: "",
    officeHours: "",
    senderAddress: "",
    senderName: "",
    logoDataUrl: "",
  },
  D: {
    shortName: "Design",
    description: "Design-only scopes, drafting, estimating, and handoff work.",
    displayName: "Design only",
    companyName: "Open Range Construction, Ltd.",
    legalName: "High Performance Structures Inc. dba Open Range Construction, Ltd.",
    email: "accounting@openrangeconstruction.com",
    telephone: "719.630.8767",
    mailingAddress: "PO Box 9046\nWoodland Park, CO 80866",
    website: "",
    licenseNumber: "",
    officeHours: "",
    senderAddress: "",
    senderName: "",
    logoDataUrl: "",
  },
}

export function addressLines(address: string): readonly string[] {
  return address
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function departmentLogoSrc(department: ProjectDepartment, profile: DepartmentProfile): string {
  return profile.logoDataUrl || BUILT_IN_DEPARTMENT_LOGOS[department]
}
