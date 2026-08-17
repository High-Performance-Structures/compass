import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe("Staff Message Desk archive control", () => {
  it("uses a confirmation dialog with explicit archive and cancel choices", () => {
    const component = readFileSync(
      resolve(process.cwd(), "src/components/office/staff-message-archive-dialog.tsx"),
      "utf8"
    )
    const page = readFileSync(
      resolve(
        process.cwd(),
        "src/app/dashboard/office-maintenance/message-desk/page.tsx"
      ),
      "utf8"
    )

    expect(page).toContain("StaffMessageArchiveDialog")
    expect(component).toContain("AlertDialogTitle")
    expect(component).toContain("Archive this staff message?")
    expect(component).toContain("This removes the record from the active desk")
    expect(component).toContain("Keep record")
    expect(component).toContain("Archive record")
  })
})
