"use client"

import { selectionStatusOptions, type SelectionStatusLabels } from "@/lib/domain/selections/status-labels"
import * as React from "react"

import {
  updateProjectSelectionStatus,
} from "@/app/actions/project-selections"
import type {
  ProjectSelectionStatus,
} from "@/lib/domain/selections/types"
import { SearchableCombobox } from "@/components/searchable-combobox"

export function ProjectSelectionStatusSelect({
  projectId,
  selectionId,
  status,
  labels,
  onChanged,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly status: ProjectSelectionStatus
  /** The company's status names, read on the server. */
  readonly labels: SelectionStatusLabels
  /** Called after a change saves (e.g. to refresh the sheet). */
  readonly onChanged?: () => void
}): React.ReactElement {
  const [currentStatus, setCurrentStatus] =
    React.useState<ProjectSelectionStatus>(status)
  const [saving, setSaving] = React.useState(false)
  const statusOptions = selectionStatusOptions(labels)

  async function changeStatus(value: string): Promise<void> {
    const option = statusOptions.find((item) => item.value === value)
    if (!option) return

    const previous = currentStatus
    setCurrentStatus(option.value)
    setSaving(true)
    const result = await updateProjectSelectionStatus(
      projectId,
      selectionId,
      option.value
    )
    setSaving(false)

    if (!result.success) {
      setCurrentStatus(previous)
      return
    }
    onChanged?.()
  }

  return (
    <SearchableCombobox
      className="h-8 w-[150px] bg-background text-sm"
      value={currentStatus}
      onValueChange={(value) => void changeStatus(value)}
      disabled={saving}
      options={statusOptions}
      ariaLabel="Selection status"
      placeholder="Choose status"
      searchPlaceholder="Search statuses..."
      emptyMessage="No matching statuses."
    />
  )
}
