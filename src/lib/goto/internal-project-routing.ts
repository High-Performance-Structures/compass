import { projectEmailDestination } from "@/lib/email/project-address"

export type GotoProjectMatchReason =
  | "project_number"
  | "conversation"
  | "contact_phone"

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function gotoInboundSmsSubject(input: {
  readonly body: string
  readonly projectNumber: string | null
}): string {
  const firstLine = input.body.split(/\r?\n/, 1)[0]?.trim() ?? ""
  return (input.projectNumber
    ? firstLine.replace(
        new RegExp(
          `(^|\\s)${regexEscape(input.projectNumber)}(?=\\s|$)`,
          "i"
        ),
        " "
      )
    : firstLine)
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function shouldRouteInternalProjectSms(input: {
  readonly body: string
  readonly projectNumber: string | null
  readonly matchReason: GotoProjectMatchReason
}): boolean {
  if (input.matchReason !== "project_number" || !input.projectNumber) {
    return false
  }
  return projectEmailDestination(gotoInboundSmsSubject(input)) !== null
}
