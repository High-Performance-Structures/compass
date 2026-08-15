import { describe, expect, it } from "vitest"

import {
  projectInteractions,
  projectJobStatuses,
  projectNotes,
  projectNumberAliases,
  projectProfileAuditEvents,
  projectProfileSyncOperations,
  projectFollowUps,
  projectAudienceFiles,
  projectExternalResourceGrants,
  projects,
} from "@/db/schema"

describe("project profile persistence contract", () => {
  it("keeps mailing and project addresses distinct from legacy project data", () => {
    expect(projects.mailingAddress.name).toBe("mailing_address")
    expect(projects.clientStatus.name).toBe("client_status")
    expect(projects.jobStatusId.name).toBe("job_status_id")
  })

  it("persists governed job statuses separately from projects", () => {
    expect(projectJobStatuses.organizationId.name).toBe("organization_id")
    expect(projectJobStatuses.followUpCadenceDays.name).toBe("follow_up_cadence_days")
    expect(projectJobStatuses.active.name).toBe("active")
  })

  it("records editable notes, meaningful interactions, and before-after audit history", () => {
    expect(projectNotes.deletedAt.name).toBe("deleted_at")
    expect(projectInteractions.occurredAt.name).toBe("occurred_at")
    expect(projectInteractions.qualifiesForClientTouch.name).toBe("qualifies_for_client_touch")
    expect(projectInteractions.direction.name).toBe("direction")
    expect(projectProfileAuditEvents.beforeJson.name).toBe("before_json")
    expect(projectProfileAuditEvents.afterJson.name).toBe("after_json")
  })

  it("persists retryable external profile sync work", () => {
    expect(projectProfileSyncOperations.operation.name).toBe("operation")
    expect(projectProfileSyncOperations.status.name).toBe("status")
    expect(projectProfileSyncOperations.payloadJson.name).toBe("payload_json")
  })

  it("stores a project-owned next follow-up assignment", () => {
    expect(projectFollowUps.projectId.name).toBe("project_id")
    expect(projectFollowUps.nextFollowUpAt.name).toBe("next_follow_up_at")
    expect(projectFollowUps.ownerUserId.name).toBe("owner_user_id")
  })

  it("audits project-scoped external files by audience and uploader", () => {
    expect(projectAudienceFiles.projectId.name).toBe("project_id")
    expect(projectAudienceFiles.audience.name).toBe("audience")
    expect(projectAudienceFiles.uploadedBy.name).toBe("uploaded_by")
    expect(projectAudienceFiles.driveFileId.name).toBe("drive_file_id")
  })

  it("records auditable per-recipient grants for project files, photos, and videos", () => {
    expect(projectExternalResourceGrants.organizationId.name).toBe("organization_id")
    expect(projectExternalResourceGrants.projectId.name).toBe("project_id")
    expect(projectExternalResourceGrants.resourceType.name).toBe("resource_type")
    expect(projectExternalResourceGrants.resourceId.name).toBe("resource_id")
    expect(projectExternalResourceGrants.recipientUserId.name).toBe("recipient_user_id")
    expect(projectExternalResourceGrants.grantedBy.name).toBe("granted_by")
    expect(projectExternalResourceGrants.revokedAt.name).toBe("revoked_at")
  })

  it("retains historical project numbers for search and audit", () => {
    expect(projectNumberAliases.projectNumber.name).toBe("project_number")
    expect(projectNumberAliases.projectId.name).toBe("project_id")
  })
})
