import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { projectChangeOrders } from "@/db/schema"

describe("executed change-order document persistence", () => {
  it("stores the authoritative executed document separately from supporting files", () => {
    expect(projectChangeOrders.executedDocumentUrl.name).toBe(
      "executed_document_url"
    )
    expect(projectChangeOrders.executedDocumentLabel.name).toBe(
      "executed_document_label"
    )
  })

  it("adds both nullable columns without rebuilding historical change orders", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "drizzle/0163_change_order_executed_documents.sql"
      ),
      "utf8"
    )
    expect(migration).toContain("ADD `executed_document_url` text")
    expect(migration).toContain("ADD `executed_document_label` text")
  })
})
