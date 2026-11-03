/**
 * Pure rules for the project Information page: client status, tracker
 * department, address parts, and the sync payload. No database or network.
 */
import { field } from "@/lib/shared/guards"
import type { ProjectIntakeDepartment } from "@/lib/google/project-intake-tracker"
import type { ProjectClientStatus } from "@/lib/project-profile"

export type ProjectProfileResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function isProjectClientStatus(value: string): value is ProjectClientStatus {
  return value === "lead" || value === "customer"
}

/** Stored client status, with anything unrecognized shown as a customer. */
export function projectClientStatus(value: string): ProjectClientStatus {
  return isProjectClientStatus(value) ? value : "customer"
}

/** The department tracker a project number belongs to, from its prefix. */
export function trackerDepartment(projectNumber: string | null): ProjectIntakeDepartment | null {
  const prefix = projectNumber?.trim().slice(0, 1).toUpperCase()
  if (prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D") {
    return prefix
  }
  return null
}

/** "123 Main St, Town, ST 80000" → street number, street name, and the rest. */
export function projectAddressParts(address: string | null): {
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

/** The previous and new project numbers a sync operation carries, or null when malformed. */
export function syncProjectNumbers(payloadJson: string): {
  readonly previousProjectNumber: string
  readonly projectNumber: string
} | null {
  let payload: unknown
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    return null
  }
  const previousProjectNumber = field(payload, "previousProjectNumber")
  const projectNumber = field(payload, "projectNumber")
  if (typeof previousProjectNumber === "string" && typeof projectNumber === "string") {
    return { previousProjectNumber, projectNumber }
  }
  return null
}

/** Only an unfinished sync operation can be retried. */
export function canRetrySyncOperation(status: string): boolean {
  return status !== "completed"
}
