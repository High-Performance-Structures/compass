/**
 * Pure rules for project families and their phases: input validation, the
 * department a phased number belongs to, tracker row inputs and the family
 * summary shape. No database or network access.
 */
import type { projectFamilyPhases } from "@/db/schema-project-families"
import type { ProjectIntakeDepartment, ProjectIntakeTrackerInput } from "@/lib/google/project-intake-tracker"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { cleanText } from "@/lib/shared/guards"

export type ProjectFamilyPhaseSummary = {
  readonly id: string
  readonly sequence: number
  readonly name: string
  readonly description: string | null
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly projectId: string | null
  readonly projectNumber: string | null
  readonly projectName: string | null
  readonly projectStatus: string | null
  readonly googleDriveFolderId: string | null
  readonly originatingChangeOrder: {
    readonly id: string
    readonly number: string
    readonly title: string
    readonly status: string
    readonly amountCents: number | null
  } | null
  readonly authorizedContractAmountCents: number | null
  readonly authorizedAt: string | null
}

export type ProjectFamilySummary = {
  readonly family: {
    readonly id: string
    readonly name: string
    readonly description: string | null
    readonly clientName: string | null
    readonly address: string | null
    readonly status: string
    readonly googleDriveFolderId: string | null
  }
  readonly currentPhaseId: string
  readonly phases: readonly ProjectFamilyPhaseSummary[]
}

export type CreateProjectFamilyPhaseInput = {
  readonly familyId: string
  readonly sequence: number
  readonly name: string
  readonly description: string | null
  readonly jobStatusId: string
  readonly originatingChangeOrderId: string | null
  readonly authorizedContractAmountCents: number | null
  readonly authorizedAt: string | null
}

export type LinkProjectToFamilyPhaseInput = {
  readonly phaseId: string
  readonly projectId: string
}

export type LinkExistingProjectToFamilyInput = {
  readonly familyId: string
  readonly projectNumber: string
  readonly sequence: number
  readonly phaseName: string
}

export type CreateProjectFamilyFromProjectInput = {
  readonly projectId: string
  readonly familyName: string
  readonly phaseName: string
}

export type ProjectFamilyMutationResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber?: string
      readonly driveStatus?: "provisioned" | "pending"
      readonly warning?: string | null
    }
  | { readonly success: false; readonly error: string }

/** A family write's result plus the pages it changed, revalidated by the action. */
export type FamilyWrite = {
  readonly result: ProjectFamilyMutationResult
  readonly revalidate: readonly string[]
}

export function familyFailure(error: string): FamilyWrite {
  return { result: { success: false, error }, revalidate: [] }
}

export type ProjectFamilyPhaseRow = {
  readonly phase: typeof projectFamilyPhases.$inferSelect
  readonly customJobStatusLabel: string | null
  readonly projectNumber: string | null
  readonly phaseProjectNumber: string | null
  readonly projectName: string | null
  readonly projectStatus: string | null
  readonly googleDriveFolderId: string | null
  readonly phaseGoogleDriveFolderId: string | null
  readonly changeOrderId: string | null
  readonly changeOrderNumber: string | null
  readonly changeOrderTitle: string | null
  readonly changeOrderStatus: string | null
  readonly changeOrderAmountCents: number | null
}

export function phaseSummary(
  row: ProjectFamilyPhaseRow,
  includeGovernance: boolean,
): ProjectFamilyPhaseSummary {
  const changeOrder =
    row.changeOrderId &&
    row.changeOrderNumber &&
    row.changeOrderTitle &&
    row.changeOrderStatus
      ? {
          id: row.changeOrderId,
          number: row.changeOrderNumber,
          title: row.changeOrderTitle,
          status: row.changeOrderStatus,
          amountCents: row.changeOrderAmountCents,
        }
      : null

  return {
    id: row.phase.id,
    sequence: row.phase.sequence,
    name: row.phase.name,
    description: row.phase.description,
    jobStatusId: row.phase.jobStatusId,
    jobStatusLabel: projectJobStatusLabel({
      jobStatusId: row.phase.jobStatusId,
      customLabel: row.customJobStatusLabel,
    }),
    projectId: row.phase.projectId,
    projectNumber: row.projectNumber ?? row.phaseProjectNumber,
    projectName: row.projectName,
    projectStatus: row.projectStatus,
    googleDriveFolderId:
      row.googleDriveFolderId ?? row.phaseGoogleDriveFolderId,
    originatingChangeOrder: includeGovernance ? changeOrder : null,
    authorizedContractAmountCents: includeGovernance
      ? row.phase.authorizedContractAmountCents
      : null,
    authorizedAt: includeGovernance ? row.phase.authorizedAt : null,
  }
}

/** Trimmed text within a limit; throws the message the form shows. */
export function requiredText(value: string, label: string, maximumLength: number): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`)
  }
  return cleaned
}

export function nullableLimitedText(
  value: string | null,
  label: string,
  maximumLength: number,
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`)
  }
  return cleaned
}

/** Why a new planned phase's sequence or authorized amount is invalid, if it is. */
export function newPhaseInputError(input: {
  readonly sequence: number
  readonly authorizedContractAmountCents: number | null
}): string | null {
  if (!Number.isInteger(input.sequence) || input.sequence < 2) {
    return "Additional phase sequence must be 2 or greater; the original project is phase 1."
  }
  if (
    input.authorizedContractAmountCents !== null &&
    (!Number.isSafeInteger(input.authorizedContractAmountCents) ||
      input.authorizedContractAmountCents < 0)
  ) {
    return "Authorized contract amount is invalid."
  }
  return null
}

export function projectFamilyDepartment(
  projectNumber: string,
): "O" | "H" | "N" | "D" | null {
  const prefix = projectNumber.trim().slice(0, 1).toUpperCase()
  return prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D"
    ? prefix
    : null
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

export function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replaceAll("'", "''")}'!${range}`
}

export function phaseAddressParts(address: string | null): {
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
} {
  const parts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  const street = parts[0] ?? ""
  const match = /^(\S+)\s+(.+)$/.exec(street)
  return {
    streetNumber: match?.[1] ?? null,
    streetName: match?.[2] ?? (street || null),
    cityStateZip: parts.slice(1).join(", ") || null,
  }
}

export function phaseTrackerInput(input: {
  readonly department: ProjectIntakeDepartment
  readonly phaseName: string
  readonly clientName: string | null
  readonly address: string | null
  readonly projectManager: string | null
  readonly intakeDate: string
}): ProjectIntakeTrackerInput {
  const clientName = cleanText(input.clientName)
  const nameParts = clientName?.split(/\s+/).filter(Boolean) ?? []
  const address = phaseAddressParts(input.address)
  return {
    department: input.department,
    projectName: input.phaseName,
    clientName,
    companyName: null,
    clientFirstName: nameParts[0] ?? null,
    clientLastName: nameParts.slice(1).join(" ") || null,
    contactPhone: null,
    contactEmail: null,
    streetNumber: address.streetNumber,
    streetName: address.streetName,
    cityStateZip: address.cityStateZip,
    billingAddress: null,
    assignedTo: cleanText(input.projectManager),
    referredBy: null,
    notes: "Created from an authorized project family phase.",
    intakeDate: input.intakeDate,
  }
}

/** The "pending" note shown when the registry/tracker rows could not be written. */
export function trackerPendingWarning(previous: string | null, error: unknown): string {
  const reason = error instanceof Error ? error.message : "Google Sheets could not be updated."
  return previous
    ? `${previous} Registry/tracker sync is pending: ${reason}`
    : `Registry/tracker sync is pending: ${reason}`
}
