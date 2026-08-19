"use client"

import * as React from "react"
import { IconMessageCircle } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { ProjectAudienceDirectMessageDialog } from "@/components/projects/project-audience-direct-message-dialog"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

export function ProjectAudienceMessageLauncher({
  shortcut,
  className,
}: {
  readonly shortcut: ProjectAudienceMessageShortcut | null
  readonly className?: string
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  if (!shortcut) return null

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>
        <IconMessageCircle className="size-4" />
        Message project team
      </Button>
      <ProjectAudienceDirectMessageDialog
        open={open}
        onOpenChange={setOpen}
        shortcut={shortcut}
      />
    </>
  )
}
