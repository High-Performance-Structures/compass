"use client"

import { staffStatusChoices } from "@/lib/domain/selections/locks"
import { selectionStatusOptions, type SelectionStatusLabels } from "@/lib/domain/selections/status-labels"
import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"
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
  replaced = false,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly status: ProjectSelectionStatus
  /** The company's status names, read on the server. */
  readonly labels: SelectionStatusLabels
  /** Called after a change saves (e.g. to refresh the sheet). */
  readonly onChanged?: () => void
  /** A selection another one replaced: its status stays as it was. */
  readonly replaced?: boolean
}): React.ReactElement {
  const [currentStatus, setCurrentStatus] =
    React.useState<ProjectSelectionStatus>(status)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Ordered moves on only to Installed; installed and replaced selections don't move (locks.ts).
  const allowed = new Set(staffStatusChoices(status, PROJECT_SELECTION_STATUSES, replaced))
  const statusOptions = selectionStatusOptions(labels).filter((option) => allowed.has(option.value))

  async function changeStatus(value: string): Promise<void> {
    const option = statusOptions.find((item) => item.value === value)
    if (!option) return

    const previous = currentStatus
    setError(null)
    setCurrentStatus(option.value)
    setSaving(true)
    const result = await updateProjectSelectionStatus(
      projectId,
      selectionId,
      option.value,
      previous
    )
    setSaving(false)

    if (!result.success) {
      setCurrentStatus(previous)
      setError(result.error)
      return
    }
    onChanged?.()
  }

  return (
    <>
    <SearchableCombobox
      className="h-8 w-[150px] bg-background text-sm"
      value={currentStatus}
      onValueChange={(value) => void changeStatus(value)}
      disabled={saving || statusOptions.length <= 1}
      options={statusOptions}
      ariaLabel="Selection status"
      placeholder="Choose status"
      searchPlaceholder="Search statuses..."
      emptyMessage="No matching statuses."
    />
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </>
  )
}
