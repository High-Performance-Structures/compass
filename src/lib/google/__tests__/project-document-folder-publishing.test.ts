import { describe, expect, it, vi } from "vitest"

import type { DriveFile } from "@/lib/google/client/types"
import { collectPublishableProjectDocumentFolderFiles } from "@/lib/google/project-document-folder-publishing"

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

function driveItem(id: string, name: string, mimeType: string): DriveFile {
  return { id, name, mimeType }
}

describe("project document folder publishing", () => {
  it("recursively collects downloadable files and skips unsupported items", async () => {
    const root = driveItem("root", "Project", FOLDER_MIME_TYPE)
    const selections = driveItem("selections", "05_SelectionsFinishes", FOLDER_MIME_TYPE)
    const specification = driveItem("spec", "Specifications.pdf", "application/pdf")
    const finishSchedule = driveItem(
      "finish-schedule",
      "Finish Schedule",
      "application/vnd.google-apps.spreadsheet"
    )
    const unsupportedForm = driveItem(
      "form",
      "Selections Form",
      "application/vnd.google-apps.form"
    )
    const listFolderItems = vi.fn(async (folderId: string) => {
      if (folderId === root.id) {
        return [specification, selections, unsupportedForm]
      }
      if (folderId === selections.id) {
        // The repeated file and root folder prove files are deduplicated and
        // malformed folder cycles cannot make traversal loop forever.
        return [finishSchedule, specification, root]
      }
      return []
    })

    const result = await collectPublishableProjectDocumentFolderFiles({
      folderId: root.id,
      listFolderItems,
    })

    expect(result.files.map((file) => file.id)).toEqual([
      specification.id,
      finishSchedule.id,
    ])
    expect(result.unsupportedCount).toBe(1)
    expect(listFolderItems).toHaveBeenCalledTimes(2)
  })

  it("rejects folders that exceed the safe publication size", async () => {
    const documents = Array.from({ length: 101 }, (_, index) =>
      driveItem(`file-${index}`, `Specification ${index}.pdf`, "application/pdf")
    )

    await expect(
      collectPublishableProjectDocumentFolderFiles({
        folderId: "root",
        listFolderItems: async () => documents,
      })
    ).rejects.toThrow("more than 100 downloadable documents")
  })
})
