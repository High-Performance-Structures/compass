import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REACT_PRINT_DOCUMENTS = [
  "src/app/dashboard/projects/[id]/budget/page.tsx",
  "src/app/dashboard/projects/[id]/purchase-orders/page.tsx",
  "src/app/preview/projects/[id]/owner/budget/page.tsx",
  "src/app/print/projects/[id]/estimate/page.tsx",
  "src/components/projects/daily-log-print-document.tsx",
  "src/components/projects/owner-update-document.tsx",
  "src/components/schedule/schedule-view.tsx",
] as const

const GENERATED_PRINT_DOCUMENTS = [
  "src/components/projects/project-rfq-share-actions.tsx",
  "src/components/projects/project-selection-share-actions.tsx",
] as const

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("project document branding coverage", () => {
  it.each(REACT_PRINT_DOCUMENTS)(
    "%s uses the eager shared department logo",
    (file) => {
      expect(source(file)).toContain("ProjectBrandLogo")
    }
  )

  it.each(GENERATED_PRINT_DOCUMENTS)(
    "%s waits for its department logo before printing",
    (file) => {
      const contents = source(file)
      expect(contents).toContain('data-project-brand-logo="true"')
      expect(contents).toContain("new window.Image()")
      expect(contents).toContain("waitForPrintLayout(printRoot)")
    }
  )
})
