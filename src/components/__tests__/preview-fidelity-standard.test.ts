import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { sourceFiles } from "@/test/source-tree"

/*
 * Enforces the preview fidelity standard in docs/development/ui-standards.md
 * (owner-approved 2026-11-13): staff previewing an owner's or vendor's
 * workspace see exactly what that person sees, with the same components and
 * controls. Controls are disabled with useAudiencePreviewReadOnly() /
 * <PreviewReadOnlyArea>, never swapped for a simplified staff version.
 *
 * `viewerIsInternal` is how a component tells it is a staff preview. Existing
 * uses disable controls or hide staff-only notices; the counts below may only
 * shrink. A new use means a screen is about to look different in preview than
 * for the person: disable the control instead.
 */

const CEILINGS: Readonly<Record<string, number>> = {
  "src/components/conversations/project-conversations-tab.tsx": 1,
  "src/components/projects/project-audience-change-orders.tsx": 3,
  "src/components/projects/project-audience-conversation-section.tsx": 1,
  "src/components/projects/project-audience-conversation.tsx": 2,
  "src/components/projects/project-audience-dashboard-view.tsx": 2,
  "src/components/projects/project-audience-preview-shell.tsx": 8,
  "src/components/projects/project-audience-preview.tsx": 21,
  "src/components/projects/project-audience-purchase-order-response-dialog.tsx": 4,
  "src/components/projects/project-audience-rfi-create-dialog.tsx": 5,
  "src/components/projects/project-audience-rfq-response-dialog.tsx": 4,
  "src/components/projects/project-audience-warranty.tsx": 3,
  "src/components/projects/project-vendor-warranty.tsx": 2,
  "src/components/projects/project-warranty-workspace.tsx": 15,
  "src/components/projects/vendor-warranty-list.tsx": 2,
  "src/components/selections/audience-selection-page.tsx": 3,
}

function uses(path: string): number {
  return readFileSync(join(process.cwd(), path), "utf8").match(/viewerIsInternal/g)?.length ?? 0
}

describe("preview fidelity standard", () => {
  it("never adds staff-only branches to owner and vendor screens", () => {
    const files = sourceFiles("src/components", { skipDirectories: ["__tests__", "node_modules"], include: /\.tsx$/ })
    const grown = files
      .map((path) => [path, uses(path)] as const)
      .filter(([path, count]) => count > (CEILINGS[path] ?? 0))
      .map(([path, count]) => `${path}: ${CEILINGS[path] ?? 0} -> ${count}`)
    expect(grown, "Disable the control in preview (useAudiencePreviewReadOnly / PreviewReadOnlyArea) instead of rendering something different for staff.").toEqual([])
  })

  it("lowers a ceiling when a staff-only branch is removed", () => {
    const stale = Object.entries(CEILINGS)
      .filter(([path, ceiling]) => !existsSync(join(process.cwd(), path)) || uses(path) < ceiling)
      .map(([path, ceiling]) => `${path}: ${ceiling} -> ${existsSync(join(process.cwd(), path)) ? uses(path) : "deleted"}`)
    expect(stale, "Lower these ceilings so they can't grow back.").toEqual([])
  })

  it("shows the real conversation and email screens in preview", () => {
    const conversation = readFileSync(join(process.cwd(), "src/components/projects/project-audience-conversation.tsx"), "utf8")
    expect(conversation).not.toContain("Read-only conversation preview")
    for (const path of [
      "src/components/conversations/message-composer.tsx",
      "src/components/conversations/message-item.tsx",
      "src/components/conversations/message-list.tsx",
      "src/components/conversations/thread-panel.tsx",
      "src/components/correspondence/project-correspondence-workspace.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), path), "utf8"), path).toMatch(/useAudiencePreviewReadOnly|PreviewReadOnlyArea/)
    }
  })
})
