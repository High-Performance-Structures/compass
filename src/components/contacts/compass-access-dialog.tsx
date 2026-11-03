"use client"

import type * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TeamTab } from "@/components/settings/team-tab"

/** Account and project-access management, opened from the Contacts page. */
export function CompassAccessDialog({
  open,
  onOpenChange,
  initialSection,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initialSection: React.ComponentProps<typeof TeamTab>["initialSection"]
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compass access</DialogTitle>
          <DialogDescription>
            Manage invitations, account roles, and project access. Contact records remain in the directories behind this dialog.
          </DialogDescription>
        </DialogHeader>
        <TeamTab initialSection={initialSection} />
      </DialogContent>
    </Dialog>
  )
}
