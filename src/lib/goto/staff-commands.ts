import type { ProjectDepartment } from "@/lib/project-branding"

export type StaffSmsCommand =
  | { readonly kind: "none" }
  | { readonly kind: "help" }
  | {
      readonly kind: "list"
      readonly department: ProjectDepartment | null
    }
  | { readonly kind: "invalid_list" }

export type SmsProjectListItem = {
  readonly name: string
  readonly projectNumber: string
  readonly department: ProjectDepartment
}

const LIST_COMMAND = /^\[list(?:\s+([^\]]+))?\]\s*$/i
const SMS_BODY_LIMIT = 850

export function projectSmsHelp(
  departmentNumbers: readonly {
    readonly label: string
    readonly phoneNumber: string
  }[]
): string {
  return [
    "Compass project texting",
    ...departmentNumbers.map(
      (department) => `${department.label}: ${department.phoneNumber}`
    ),
    "Text the project number, a tag, and your update.",
    "Example: <project number> [DAILY LOG] Crew arrived at 7:00. Framing started.",
    "Tags: [DAILY LOG] notes/photos; [TO-DO] tasks; [DELIVERY] deliveries; [RFI] questions; [VIDEO] video clips.",
    "Attach photos or video to the same text. Verified staff can text [list] for active project numbers.",
  ].join("\n")
}

function projectDepartment(value: string): ProjectDepartment | null {
  const normalized = value.trim().toUpperCase()
  if (
    normalized === "O" ||
    normalized === "H" ||
    normalized === "N" ||
    normalized === "D"
  ) {
    return normalized
  }
  return null
}

export function parseStaffSmsCommand(body: string): StaffSmsCommand {
  const normalized = body.trim()
  if (/^\[help\]\s*$/i.test(normalized)) return { kind: "help" }
  if (!normalized.toLowerCase().startsWith("[list")) return { kind: "none" }

  const match = LIST_COMMAND.exec(normalized)
  if (!match) return { kind: "invalid_list" }
  const requestedDepartment = match[1]
  if (requestedDepartment === undefined) {
    return { kind: "list", department: null }
  }
  const department = projectDepartment(requestedDepartment)
  return department === null
    ? { kind: "invalid_list" }
    : { kind: "list", department }
}

function chunkLines(lines: readonly string[]): readonly string[] {
  const chunks: string[] = []
  let current = ""

  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}\n${line}`
    if (next.length <= SMS_BODY_LIMIT) {
      current = next
      continue
    }
    if (current.length > 0) chunks.push(current)
    current = line.slice(0, SMS_BODY_LIMIT)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function projectListSmsChunks(input: {
  readonly departments: readonly ProjectDepartment[]
  readonly projects: readonly SmsProjectListItem[]
}): readonly string[] {
  const departmentSet = new Set(input.departments)
  const projects = input.projects.filter((project) =>
    departmentSet.has(project.department)
  )
  const heading =
    input.departments.length === 1
      ? `Active ${input.departments[0]} projects (${projects.length})`
      : `Active ${input.departments.join("/")} projects (${projects.length})`
  if (projects.length === 0) return [`${heading}\nNone found.`]

  return chunkLines([
    heading,
    ...projects.map(
      (project) => `${project.projectNumber} - ${project.name.trim()}`
    ),
  ])
}

export function inboundRouteLabel(
  status:
    | "routed_rfi"
    | "routed_todo"
    | "routed_daily_log"
    | "routed_rfq"
    | "routed_change_order"
    | "routed_video"
    | "routed_message"
): string {
  if (status === "routed_rfi") return "an RFI"
  if (status === "routed_todo") return "a to-do"
  if (status === "routed_rfq") return "an RFQ draft"
  if (status === "routed_change_order") return "a change-order draft"
  if (status === "routed_video") return "a project video"
  if (status === "routed_message") return "a project message"
  return "a daily log"
}
