/** Input and result shapes for project intake and project shells. */
import type { ProjectIntakeTrackerInput } from "@/lib/google/project-intake-tracker"
import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import type { SageClientStatusId, SageJobTypeId } from "@/lib/sage/client-project-write"

import type { ProjectShellDepartment } from "./rules"

export type ProjectStatusValue =
  | "OPEN"
  | "WARRANTY"
  | "COMPLETE"
  | "INACTIVE"
  | "ARCHIVE"
  | "OTHER"

export type CreateProjectShellInput = {
  readonly projectNumber: string | null
  readonly name: string
  readonly department: ProjectShellDepartment
  readonly clientName: string | null
  readonly address: string | null
  readonly status: string
  readonly sageClientStatusId: SageClientStatusId
  readonly sageJobStatusId: string
  readonly sageJobType: SageJobTypeId
  readonly confirmedDistinctProjectIds?: readonly string[]
}

export type CreateProjectShellResult =
  | {
      readonly success: true
      readonly id: string
      readonly sageStatus: "queued"
    }
  | {
      readonly success: false
      readonly duplicateWarning: true
      readonly candidates: readonly ProjectDuplicateCandidate[]
    }
  | { readonly success: false; readonly error: string }

export type ProjectIntakeAssignee = {
  readonly id: string
  readonly name: string
  readonly email: string
}

export type ProjectIntakeCustomerOption = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly sageClientStatusId: number | null
  readonly sageLinkNeedsReview: boolean
}

export type CreateProjectIntakeInput = Omit<ProjectIntakeTrackerInput, "intakeDate"> & {
  readonly existingCustomerId?: string | null
  readonly sageClientStatusId: SageClientStatusId
  readonly sageJobStatusId: string
  readonly sageJobType: SageJobTypeId
  readonly confirmedDistinctProjectIds?: readonly string[]
}

export type CreateProjectIntakeResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber: string
      readonly trackerStatus: "written" | "pending"
      readonly driveStatus: "provisioned" | "pending"
      readonly sageStatus: "queued"
      readonly warning: string | null
    }
  | {
      readonly success: false
      readonly duplicateWarning: true
      readonly candidates: readonly ProjectDuplicateCandidate[]
    }
  | { readonly success: false; readonly error: string }

export type ProvisionProjectDriveResult =
  | {
      readonly success: true
      readonly folderId: string
      readonly folderUrl: string
      readonly createdRoot: boolean
      readonly createdChildCount: number
      readonly copiedFileCount: number
    }
  | { readonly success: false; readonly error: string }
