"use client"

import * as React from "react"

import {
  updateProjectSelectionStatus,
  type ProjectSelectionStatus,
} from "@/app/actions/project-selections"
import { SearchableCombobox } from "@/components/searchable-combobox"

const STATUS_OPTIONS: readonly {
  readonly value: ProjectSelectionStatus
  readonly label: string
}[] = [
  { value: "needed", label: "Needed" },
  { value: "proposed", label: "Proposed" },
  { value: "owner_review", label: "Owner review" },
  { value: "approved", label: "Approved" },
  { value: "pricing", label: "Pricing" },
  { value: "rfq_sent", label: "RFQ sent" },
  { value: "ordered", label: "Ordered" },
  { value: "installed", label: "Installed" },
  { value: "unavailable", label: "Unavailable" },
  { value: "deferred", label: "Deferred" },
]

export function selectionStatusLabel(status: ProjectSelectionStatus): string {
  return (
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Needed"
  )
}

export function ProjectSelectionStatusSelect({
  projectId,
  selectionId,
  status,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly status: ProjectSelectionStatus
}): React.ReactElement {
  const [currentStatus, setCurrentStatus] =
    React.useState<ProjectSelectionStatus>(status)
  const [saving, setSaving] = React.useState(false)

  async function changeStatus(value: string): Promise<void> {
    const option = STATUS_OPTIONS.find((item) => item.value === value)
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
    }
  }

  return (
    <SearchableCombobox
      className="h-8 w-[150px] bg-background text-sm"
      value={currentStatus}
      onValueChange={(value) => void changeStatus(value)}
      disabled={saving}
      options={STATUS_OPTIONS}
      ariaLabel="Selection status"
      placeholder="Choose status"
      searchPlaceholder="Search statuses..."
      emptyMessage="No matching statuses."
    />
  )
}
