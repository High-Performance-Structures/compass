"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Confirms adding the selected directory companies to a project. */
export function ProjectAssociationConfirmDialog({
  open,
  onOpenChange,
  count,
  projectName,
  associating,
  onConfirm,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly count: number
  readonly projectName: string
  readonly associating: boolean
  readonly onConfirm: () => void
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add selected directory records to project?</DialogTitle>
          <DialogDescription>
            {count} directory record{count === 1 ? "" : "s"} will be associated internally with {projectName}. This does not change the project&apos;s legal client or Sage link, invite anyone, grant login access, or make contacts visible in an external portal.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={associating} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={associating} onClick={onConfirm}>{associating ? "Adding..." : "Add to project"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
