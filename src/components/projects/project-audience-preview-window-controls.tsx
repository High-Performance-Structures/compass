"use client"

import { IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export function ProjectAudiencePreviewWindowControls(): React.ReactElement {
  function closePreview(): void {
    window.close()
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={closePreview}>
      <IconX className="size-4" />
      Close preview
    </Button>
  )
}
