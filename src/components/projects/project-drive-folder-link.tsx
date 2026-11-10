import type * as React from "react"
import { IconBrandGoogleDrive } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

/**
 * The job's Google Drive folder, opened in a new tab. Sits at the top of the
 * project overview so staff reach the folder in one click.
 */
export function ProjectDriveFolderLink({
  folderId,
}: {
  readonly folderId: string
}): React.ReactElement {
  return (
    <Button asChild variant="outline" size="sm" className="print:hidden">
      <a
        href={`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <IconBrandGoogleDrive className="size-4" />
        Drive folder
      </a>
    </Button>
  )
}
