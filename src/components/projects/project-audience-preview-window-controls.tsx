"use client"

import { IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { closeProjectAudiencePreviewWindow } from "@/lib/project-audience-preview-window"

export function ProjectAudiencePreviewWindowControls({
  fallbackHref,
}: {
  readonly fallbackHref: string
}): React.ReactElement {
  function closePreview(): void {
    closeProjectAudiencePreviewWindow(fallbackHref)
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={closePreview}>
      <IconX className="size-4" />
      Close preview
    </Button>
  )
}
