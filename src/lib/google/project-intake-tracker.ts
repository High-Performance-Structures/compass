export type ProjectIntakeDepartment = "O" | "H" | "N" | "D"

export type ProjectIntakeTrackerInput = {
  readonly department: ProjectIntakeDepartment
  readonly projectName: string
  readonly clientName: string | null
  readonly companyName: string | null
  readonly clientFirstName: string | null
  readonly clientLastName: string | null
  readonly contactPhone: string | null
  readonly contactEmail: string | null
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
  readonly billingAddress: string | null
  readonly assignedTo: string | null
  readonly referredBy: string | null
  readonly notes: string | null
  readonly intakeDate: string
}

export type ProjectTrackerLayout = {
  readonly headerRowNumber: number
  readonly headers: readonly string[]
  readonly projectNumberColumn: number
}

export type ProjectTrackingDestination = {
  readonly spreadsheetId: string
  readonly workbookTitle: string
  readonly sheetTitle: "Tracker"
  readonly divisionLabel: "ORC" | "HPS" | "NuTech" | "Design"
}

export const PROJECT_REGISTRY_DESTINATION = {
  spreadsheetId: "1Gwmxfm2wzVgrmov9qSxnFxyX_WJDa5gPbk6VgoZI46I",
  workbookTitle: "Project Registry",
  sheetTitle: "Registry",
} as const

const DEPARTMENT_TRACKING_DESTINATIONS: Readonly<
  Record<ProjectIntakeDepartment, ProjectTrackingDestination>
> = {
  O: {
    spreadsheetId: "1A2vaXdNdhv_J5XX1iFCiNCH5c1Lm-YaHJ8fqWIJevIg",
    workbookTitle: "ORC Tracker",
    sheetTitle: "Tracker",
    divisionLabel: "ORC",
  },
  H: {
    spreadsheetId: "1t-RRoL5iE8ZFIxEr2KtlrTHSbx_HqmM_DHzjRjL5jIc",
    workbookTitle: "HPS Tracker",
    sheetTitle: "Tracker",
    divisionLabel: "HPS",
  },
  N: {
    spreadsheetId: "1ySa3VgHB-6gZHvJY4DKskPTJX8LdnwB6PhAE-D3JVxE",
    workbookTitle: "Nu-Tech Tracker",
    sheetTitle: "Tracker",
    divisionLabel: "NuTech",
  },
  D: {
    spreadsheetId: "1reeTLmijIxZ-xeegidJcZoW3vbYkfSXHBw24-veu7-w",
    workbookTitle: "Design Tracker",
    sheetTitle: "Tracker",
    divisionLabel: "Design",
  },
}

export function departmentTrackingDestination(
  department: ProjectIntakeDepartment
): ProjectTrackingDestination {
  return DEPARTMENT_TRACKING_DESTINATIONS[department]
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function normalizedHeader(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function locateProjectTrackerLayout(
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): ProjectTrackerLayout | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = (rows[rowIndex] ?? []).map(cellText)
    const projectNumberColumn = headers.findIndex((header) => {
      const normalized = normalizedHeader(header)
      return normalized === "project number" || normalized === "project id"
    })
    if (projectNumberColumn >= 0) {
      return {
        headerRowNumber: rowIndex + 1,
        headers,
        projectNumberColumn,
      }
    }
  }
  return null
}

export function projectRowNumber(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  layout: ProjectTrackerLayout,
  projectNumber: string
): number | null {
  const normalizedProjectNumber = projectNumber.trim().toUpperCase()
  for (
    let rowIndex = layout.headerRowNumber;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const value = cellText(rows[rowIndex]?.[layout.projectNumberColumn])
    if (value.toUpperCase() === normalizedProjectNumber) return rowIndex + 1
  }
  return null
}

export function allocateProjectNumber(input: {
  readonly department: ProjectIntakeDepartment
  readonly streetNumber: string | null
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>
  readonly layout: ProjectTrackerLayout
  readonly reservedProjectNumbers?: readonly string[]
}): string {
  let maximumSequence = 0
  const pattern = new RegExp(`^${input.department}-(\\d+)(?:-|$)`, "i")
  for (const row of input.rows.slice(input.layout.headerRowNumber)) {
    const value = cellText(row[input.layout.projectNumberColumn])
    const match = pattern.exec(value)
    if (!match) continue
    const sequence = Number(match[1])
    if (Number.isInteger(sequence) && sequence > maximumSequence) {
      maximumSequence = sequence
    }
  }
  for (const value of input.reservedProjectNumbers ?? []) {
    const match = pattern.exec(cellText(value))
    if (!match) continue
    const sequence = Number(match[1])
    if (Number.isInteger(sequence) && sequence > maximumSequence) {
      maximumSequence = sequence
    }
  }
  const streetNumber = cellText(input.streetNumber).replace(/[^a-z0-9]+/gi, "") || "00"
  return `${input.department}-${String(maximumSequence + 1).padStart(2, "0")}-${streetNumber}`
}

function joinedName(input: ProjectIntakeTrackerInput): string {
  return [cellText(input.clientFirstName), cellText(input.clientLastName)]
    .filter(Boolean)
    .join(" ")
}

function joinedAddress(input: ProjectIntakeTrackerInput): string {
  const street = [cellText(input.streetNumber), cellText(input.streetName)]
    .filter(Boolean)
    .join(" ")
  return [street, cellText(input.cityStateZip)].filter(Boolean).join(", ")
}

function intakeNotes(input: ProjectIntakeTrackerInput): string {
  const notes = cellText(input.notes)
  const referredBy = cellText(input.referredBy)
  return [notes, referredBy ? `Referred by ${referredBy}` : ""]
    .filter(Boolean)
    .join(" · ")
}

function sequenceFromProjectNumber(projectNumber: string): string {
  return projectNumber.match(/^[A-Z]-(\d+)-/i)?.[1] ?? ""
}

export function buildProjectRegistryRow(input: {
  readonly layout: ProjectTrackerLayout
  readonly project: ProjectIntakeTrackerInput
  readonly projectNumber: string
  readonly driveFolderUrl: string | null
  readonly departmentTrackerUrl: string
  readonly createdBy: string
}): readonly string[] {
  const destination = departmentTrackingDestination(input.project.department)
  const values: Readonly<Record<string, string>> = {
    "project id": input.projectNumber,
    "project number": input.projectNumber,
    division: destination.divisionLabel,
    sequence: sequenceFromProjectNumber(input.projectNumber),
    "street number code": cellText(input.project.streetNumber),
    "street name label": cellText(input.project.streetName) || input.project.projectName,
    "client last name": cellText(input.project.clientLastName),
    "client first name": cellText(input.project.clientFirstName),
    "company name": cellText(input.project.companyName),
    "city state zip": cellText(input.project.cityStateZip),
    "folder link": input.driveFolderUrl ?? "",
    "lead tracker link": input.departmentTrackerUrl,
    "created date": input.project.intakeDate,
    "created by": input.createdBy,
    status: "I - Intake",
    notes: intakeNotes(input.project),
  }
  return input.layout.headers.map(
    (header) => values[normalizedHeader(header)] ?? ""
  )
}

export function buildDepartmentTrackerRow(input: {
  readonly layout: ProjectTrackerLayout
  readonly project: ProjectIntakeTrackerInput
  readonly projectNumber: string
  readonly driveFolderUrl: string | null
}): readonly string[] {
  const project = input.project
  const client = cellText(project.clientName) || joinedName(project)
  const company = cellText(project.companyName)
  const address = joinedAddress(project)
  const common: Record<string, string> = {
    "project id": input.projectNumber,
    "project number": input.projectNumber,
    "folder link": input.driveFolderUrl ?? "",
    notes: intakeNotes(project),
    phone: cellText(project.contactPhone),
    email: cellText(project.contactEmail),
    "billing address": cellText(project.billingAddress),
    "client id": "",
    "project address": address,
    "update status": "Weekly",
  }
  const departmentValues: Readonly<Record<ProjectIntakeDepartment, Record<string, string>>> = {
    H: {
      "builder gc": company || client || "Homeowner",
      "contact person": client,
      estimator: cellText(project.assignedTo),
      "quote status": "I - Intake",
    },
    O: {
      client,
      address,
      "assigned to": cellText(project.assignedTo),
      "lead status": "I - Intake",
    },
    N: {
      customer: client || company,
      "assigned to": cellText(project.assignedTo),
      "quote status": "I - Intake",
      "order status": "I - Intake",
    },
    D: {
      client,
      address,
      "assigned designer": cellText(project.assignedTo),
      "proposal status": "I - Intake",
    },
  }
  const values = { ...common, ...departmentValues[project.department] }
  return input.layout.headers.map(
    (header) => values[normalizedHeader(header)] ?? ""
  )
}
