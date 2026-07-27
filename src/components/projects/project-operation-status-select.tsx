"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  updateProjectOperationStatus,
  type ProjectOperationKind,
} from "@/app/actions/project-operations"
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
      <select
        id={`${operationKind}-status-${operationId}`}
        value={selectedStatus}
        disabled={isPending}
        onChange={(event) => changeStatus(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs font-medium"
        aria-label={`Change ${operationKind === "purchase_order" ? "purchase order" : "RFQ"} status`}
      >
        {hasImportedStatus && (
          <option value={selectedStatus}>
            {selectedStatus.replaceAll("_", " ")} (imported)
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
