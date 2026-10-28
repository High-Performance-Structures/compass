"use client"

import * as React from "react"

import { DriveBrowseDialog } from "@/components/google/drive-browse-dialog"
import { driveIdFromInput } from "@/lib/google/drive-picker"
import type { PickedProjectFile } from "@/lib/files/picked-files"

export type { PickedProjectFile } from "@/lib/files/picked-files"

/**
 * Pick files (or whole folders) for a job instead of pasting links: opens on
 * this job's Drive folder, and can also reach all of Drive or upload from the
 * computer.
 */
export function ProjectDriveFilePicker({
  projectId,
  open,
  onOpenChange,
  onPick,
  alreadyPickedUrls = [],
}: {
  readonly projectId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPick: (files: readonly PickedProjectFile[]) => void
  readonly alreadyPickedUrls?: readonly string[]
}): React.ReactElement {
  const alreadyChosenIds = alreadyPickedUrls.flatMap((url) => {
    const id = driveIdFromInput(url)
    return id ? [id] : []
  })
  return (
    <DriveBrowseDialog
      open={open}
      onOpenChange={onOpenChange}
      choose="any"
      multiple
      projectId={projectId}
      title="Choose files"
      description="Open folders to find plan sheets, specs and addenda, then tick the ones to include. Whole folders work for Plans and Submittals. You can also search all of Drive or upload from this computer."
      alreadyChosenIds={alreadyChosenIds}
      onPick={(items) => onPick(items.map((item) => ({ id: item.id, name: item.name, url: item.url, kind: item.kind })))}
    />
  )
}
