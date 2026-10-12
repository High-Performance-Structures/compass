"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  updateProjectOperationStatus,
  type ProjectOperationKind,
} from "@/app/actions/project-operations"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import {
  PURCHASE_ORDER_STATUS_OPTIONS,
  RFQ_STATUS_OPTIONS,
} from "@/lib/project-operations/status"

export function ProjectOperationStatusSelect({
  projectId,
  operationId,
  operationKind,
  status,
}: {
  readonly projectId: string
  readonly operationId: string
  readonly operationKind: ProjectOperationKind
  readonly status: string
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [selectedStatus, setSelectedStatus] = React.useState(status)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const options =
    operationKind === "purchase_order"
      ? PURCHASE_ORDER_STATUS_OPTIONS
      : RFQ_STATUS_OPTIONS
  const hasImportedStatus = !options.some(
    (option) => option.value === selectedStatus
  )

  function changeStatus(nextStatus: string): void {
    const previousStatus = selectedStatus
    setSelectedStatus(nextStatus)
    setError(null)
    startTransition(async () => {
      const result = await updateProjectOperationStatus(
        projectId,
        operationId,
        operationKind,
        nextStatus
      )
      if (!result.success) {
        setSelectedStatus(previousStatus)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="min-w-40">
      <label
        className="sr-only"
        htmlFor={`${operationKind}-status-${operationId}`}
      >
        Status
      </label>
      <SearchableCombobox
        id={`${operationKind}-status-${operationId}`}
        className="h-8 px-2 text-xs font-medium"
        value={selectedStatus}
        disabled={isPending}
        // Each choice saves immediately; ignore the picker's empty reset and
        // re-picks of the current status.
        onValueChange={(value) => {
          if (value !== "" && value !== selectedStatus) changeStatus(value)
        }}
        options={[
          ...(hasImportedStatus
            ? [
                {
                  value: selectedStatus,
                  label: `${selectedStatus.replaceAll("_", " ")}${developerModeEnabled ? " (imported)" : ""}`,
                },
              ]
            : []),
          ...options,
        ]}
        ariaLabel={`Change ${operationKind === "purchase_order" ? "purchase order" : "RFQ"} status`}
        placeholder="Choose status"
        searchPlaceholder="Search statuses..."
        emptyMessage="No matching statuses."
      />
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
