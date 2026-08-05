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
    const projectNumberColumn = headers.findIndex(
      (header) => normalizedHeader(header) === "project number"
    )
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

export function allocateProjectNumber(input: {
  readonly department: ProjectIntakeDepartment
  readonly streetNumber: string | null
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>
  readonly layout: ProjectTrackerLayout
  readonly reservedProjectNumbers?: readonly string[]
}): string {
  let maximumSequence = 0
  const pattern = new RegExp(`^${input.department}-(\\d+)-`, "i")
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

function valueForHeader(
  header: string,
  input: ProjectIntakeTrackerInput,
  projectNumber: string
): string {
  const normalized = normalizedHeader(header)
  const values: Readonly<Record<string, string | null>> = {
    "project number": projectNumber,
    type: input.department,
    "intake date": input.intakeDate,
    "assigned to": input.assignedTo,
    status: "OPEN",
    "company name": input.companyName,
    "client last name": input.clientLastName,
    "client first name": input.clientFirstName,
    "contact phone": input.contactPhone,
    "contact email": input.contactEmail,
    "project street number": input.streetNumber,
    "project street name": input.streetName,
    "city state zip": input.cityStateZip,
    "billing address": input.billingAddress,
    "referred by": input.referredBy,
    notes: input.notes,
  }
  if (normalized === "active projects") return input.projectName
  if (normalized === "client name") return input.clientName ?? ""
  return values[normalized] ?? ""
}

export function buildProjectTrackerRow(input: {
  readonly layout: ProjectTrackerLayout
  readonly project: ProjectIntakeTrackerInput
  readonly projectNumber: string
}): readonly string[] {
  return input.layout.headers.map((header) =>
    valueForHeader(header, input.project, input.projectNumber)
  )
}
