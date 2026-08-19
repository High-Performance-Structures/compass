import { describe, expect, it } from "vitest"

import { filterFieldDocumentRootFolders } from "@/lib/field/document-access"
import type { DriveFile } from "@/lib/google/client/types"

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

function folder(id: string, name: string): DriveFile {
  return { id, name, mimeType: FOLDER_MIME_TYPE }
}

describe("Field document access", () => {
  it("shows only plans/specifications and selections/finishes at project root", () => {
    const files: readonly DriveFile[] = [
      folder("plans", "04_PermittedPlansSpecifications"),
      folder("selections", "05_SelectionsFinishes"),
      folder("contracts", "01_ActiveContractDocuments"),
      folder("legacy-plans", "04_PermittedPlans"),
      {
        id: "file",
        name: "loose-plan.pdf",
        mimeType: "application/pdf",
      },
    ]

    expect(filterFieldDocumentRootFolders(files).map((file) => file.id)).toEqual(
      ["plans", "selections"]
    )
  })
})
