import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  projectFamilies,
  projectFamilyPhases,
} from "@/db/schema-project-families"

describe("project family persistence contract", () => {
  it("keeps family identity and shared Drive mapping separate from projects", () => {
    expect(projectFamilies.organizationId.name).toBe("organization_id")
    expect(projectFamilies.googleDriveFolderId.name).toBe(
      "google_drive_folder_id",
    )
    expect(projectFamilies.status.name).toBe("status")
  })

  it("allows a planned phase to exist before its operational project", () => {
    expect(projectFamilyPhases.projectId.name).toBe("project_id")
    expect(projectFamilyPhases.projectNumber.name).toBe("project_number")
    expect(projectFamilyPhases.googleDriveFolderId.name).toBe(
      "google_drive_folder_id",
    )
    expect(projectFamilyPhases.jobStatusId.name).toBe("job_status_id")
    expect(projectFamilyPhases.originatingChangeOrderId.name).toBe(
      "originating_change_order_id",
    )
  })

  it("keeps the migration contract explicit", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0159_project_families.sql"),
      "utf8",
    )
    expect(migration).toContain("CREATE TABLE `project_families`")
    expect(migration).toContain("CREATE TABLE `project_family_phases`")
    expect(migration).toContain("project_change_orders")
    expect(migration).toContain("project_family_phases_project_unique")
    expect(migration).toContain("project_family_phases_project_number_idx")
  })
})
