/**
 * Pure project rules: numbering, intake text, duplicate pairs and the Sage
 * client/job handoff payload. No database or network access.
 */
import { cleanText } from "@/lib/shared/guards"
import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import type { ProjectIntakeDepartment } from "@/lib/google/project-intake-tracker"
import {
  sageClientStatusName,
  sageJobName,
  sageJobTypeName,
  sageShortName,
  type SageClientStatusId,
  type SageJobTypeId,
} from "@/lib/sage/client-project-write"

export type ProjectShellDepartment = "O" | "H" | "N" | "D" | "UNASSIGNED"

export function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} is required`)
  return trimmed
}

export function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

export function departmentPrefix(department: ProjectShellDepartment): string {
  if (department === "O") return "o"
  if (department === "H") return "h"
  if (department === "N") return "n"
  if (department === "D") return "d"
  return "unassigned"
}

/** A shell's record id: its number, or its department and name, plus a random suffix. */
export function shellProjectId(
  projectNumber: string | null,
  department: ProjectShellDepartment,
  name: string,
  suffix: string,
): string {
  const idBase = projectNumber
    ? slugPart(projectNumber)
    : `${departmentPrefix(department)}-${slugPart(name)}`
  return `proj-${idBase}-${suffix}`
}

/** The department sequence in a project number such as `O-58-3674`. */
export function projectSequence(projectNumber: string): number {
  const match = /^[A-Z]-(\d+)-/i.exec(projectNumber)
  if (!match) throw new Error("Compass could not reserve the project sequence.")
  const sequence = Number(match[1])
  if (!Number.isInteger(sequence)) {
    throw new Error("Compass could not reserve the project sequence.")
  }
  return sequence
}

/** A unique-index failure on the number reservation or the project number. */
export function isProjectSequenceConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("project_number_reservations") ||
      error.message.toLowerCase().includes("unique constraint"))
  )
}

export function normalizedIntakeDepartment(value: unknown): ProjectIntakeDepartment | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (normalized === "O" || normalized === "H" || normalized === "N" || normalized === "D") {
    return normalized
  }
  return null
}

export function projectDepartment(projectNumber: string | null): ProjectIntakeDepartment | null {
  return normalizedIntakeDepartment(projectNumber?.slice(0, 1) ?? null)
}

/** The folder name saved on a Drive link's metadata, if any. */
export function metadataFolderName(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "folderName" in parsed &&
      typeof parsed.folderName === "string"
    ) {
      return cleanText(parsed.folderName)
    }
  } catch {
    return null
  }
  return null
}

export function appendWarning(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next
}

export function intakeAssigneeName(input: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  return (
    cleanText(input.displayName) ??
    ([cleanText(input.firstName), cleanText(input.lastName)]
      .filter((value) => value !== null)
      .join(" ") || input.email)
  )
}

type IntakeAddressInput = {
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
}

export function joinedAddress(input: IntakeAddressInput): string | null {
  const street = [cleanText(input.streetNumber), cleanText(input.streetName)]
    .filter((value) => value !== null)
    .join(" ")
  return [street || null, cleanText(input.cityStateZip)]
    .filter((value) => value !== null)
    .join(", ") || null
}

export function intakeClientName(input: {
  readonly clientName: string | null
  readonly clientFirstName: string | null
  readonly clientLastName: string | null
  readonly companyName: string | null
}): string | null {
  const explicit = cleanText(input.clientName)
  if (explicit) return explicit
  const contact = [cleanText(input.clientFirstName), cleanText(input.clientLastName)]
    .filter((value) => value !== null)
    .join(" ")
  return contact || cleanText(input.companyName)
}

/** The existing project a prospective-duplicate candidate points at. */
export function candidateExistingProjectId(candidate: ProjectDuplicateCandidate): string {
  return candidate.second.id
}

/** Duplicate decisions store each pair once, lower id first. */
export function orderedProjectPair(
  firstProjectId: string,
  secondProjectId: string,
): readonly [string, string] {
  return firstProjectId < secondProjectId
    ? [firstProjectId, secondProjectId]
    : [secondProjectId, firstProjectId]
}

/** Candidates the person has not yet confirmed are different projects. */
export function unconfirmedDuplicateCandidates(
  candidates: readonly ProjectDuplicateCandidate[],
  confirmedDistinctProjectIds: readonly string[] | undefined,
): readonly ProjectDuplicateCandidate[] {
  const confirmed = new Set(confirmedDistinctProjectIds ?? [])
  return candidates.filter((candidate) => !confirmed.has(candidateExistingProjectId(candidate)))
}

export function hasIncompleteSageClientLink(
  customer: {
    readonly sageClientId: string | null
    readonly sageClientNumber: string | null
  } | null,
): boolean {
  return customer !== null && Boolean(customer.sageClientId) !== Boolean(customer.sageClientNumber)
}

/** An existing client without a Sage status or link takes the intake's status. */
export function customerNeedsSageStatus(customer: {
  readonly sageClientStatusId: number | null
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
}): boolean {
  return customer.sageClientStatusId === null && !customer.sageClientId && !customer.sageClientNumber
}

type SageHandoffClient = {
  readonly compassCustomerId: string
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
  readonly name: string
  /** The value the Sage short name is built from. */
  readonly shortNameSource: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly billingAddress: string | null
  readonly notes: string | null
  readonly statusId: SageClientStatusId
}

type SageHandoffJob = {
  readonly compassProjectId: string
  readonly compassProjectNumber: string | null
  readonly projectName: string
  readonly address: string | null
  readonly statusName: string
  readonly jobType: SageJobTypeId
}

export type SageClientJobPayload = {
  readonly operationType: "ensure_client_and_job"
  readonly company: "High Performance Structures Inc"
  readonly client: {
    readonly compassCustomerId: string
    readonly sageClientId: string | null
    readonly sageClientNumber: string | null
    readonly name: string
    readonly shortName: string
    readonly company: string | null
    readonly email: string | null
    readonly phone: string | null
    readonly address: string | null
    readonly billingAddress: string | null
    readonly notes: string | null
    readonly status: { readonly expectedNumber: SageClientStatusId; readonly name: string }
  }
  readonly job: {
    readonly compassProjectId: string
    readonly compassProjectNumber: string | null
    readonly name: string
    readonly shortName: string
    readonly address: string | null
    readonly statusName: string
    readonly typeName: string
  }
}

/**
 * The queued `ensure_client_and_job` payload for the Sage client/job writer.
 * Key order is part of the stored JSON, so it matches the payload built
 * before this moved here.
 */
export function sageClientJobPayload(
  client: SageHandoffClient,
  job: SageHandoffJob,
): SageClientJobPayload {
  const fullSageJobName = sageJobName(job.compassProjectNumber, job.projectName)
  return {
    operationType: "ensure_client_and_job" as const,
    company: "High Performance Structures Inc" as const,
    client: {
      compassCustomerId: client.compassCustomerId,
      sageClientId: client.sageClientId,
      sageClientNumber: client.sageClientNumber,
      name: client.name,
      shortName: sageShortName(client.shortNameSource),
      company: client.company,
      email: client.email,
      phone: client.phone,
      address: client.address,
      billingAddress: client.billingAddress,
      notes: client.notes,
      status: {
        expectedNumber: client.statusId,
        name: sageClientStatusName(client.statusId),
      },
    },
    job: {
      compassProjectId: job.compassProjectId,
      compassProjectNumber: job.compassProjectNumber,
      name: fullSageJobName,
      shortName: sageShortName(fullSageJobName),
      address: job.address,
      statusName: job.statusName,
      typeName: sageJobTypeName(job.jobType),
    },
  }
}
