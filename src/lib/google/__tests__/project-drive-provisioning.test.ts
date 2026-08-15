import { describe, expect, it } from "vitest"

import { projectDriveChildFolders } from "@/lib/google/project-drive-provisioning"

describe("project Drive audience folders", () => {
  it.each(["O", "H", "D", "N"] as const)(
    "provisions Owner and Sub-Supplier upload folders for %s projects",
    (department) => {
      expect(projectDriveChildFolders(department)).toEqual(
        expect.arrayContaining(["Owner Uploads", "Sub-Supplier Uploads"])
      )
    }
  )
})
