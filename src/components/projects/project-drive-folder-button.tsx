"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFolderPlus, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"
import { provisionProjectDriveFolder } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"

/**
 * Shown wherever a job is missing its Google Drive folder. Builds the folder
 * from the company's template (or relinks one already in Drive) and refreshes
 * the page so Drive-backed actions light up.
 */
export function ProjectDriveFolderButton({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function create(): void {
    startTransition(async () => {
      const result = await provisionProjectDriveFolder(projectId)
      if (!result.success) {
        toast.error(`Could not create the Drive folder: ${result.error}`)
        return
      }
      toast.success(
        result.createdRoot
          ? "Project Drive folder created and linked."
          : "Existing project Drive folder found and linked."
      )
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={create}
      className="print:hidden"
    >
      {pending ? (
        <IconRefresh className="size-4 animate-spin" />
      ) : (
        <IconFolderPlus className="size-4" />
      )}
      {pending ? "Creating…" : "Create Drive folder"}
    </Button>
  )
}
