"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RefreshCwIcon,
  Trash2Icon,
  Loader2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CompassRenderer } from "@/lib/agent/render/compass-renderer"
import {
  deleteCustomDashboard,
  executeDashboardQueries,
} from "@/app/actions/dashboards"
import type { Spec } from "@json-render/react"

interface SavedDashboardViewProps {
  readonly dashboard: {
    readonly id: string
    readonly name: string
    readonly description: string
  }
  readonly spec: Spec
  readonly dataContext: Record<string, unknown>
}

export function SavedDashboardView({
  dashboard,
  spec,
  dataContext: initialData,
}: SavedDashboardViewProps) {
  const router = useRouter()
  const [refreshing, setRefreshing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [data, setData] =
    React.useState<Record<string, unknown>>(initialData)

  const handleRefresh = async () => {
    setRefreshing(true)
    const result = await executeDashboardQueries(
      JSON.stringify([]),
    )
    if (result.success) {
      setData(result.data)
    }
    setRefreshing(false)
  }

  const handleDelete = async () => {
    if (!confirm("Delete this dashboard?")) return
    setDeleting(true)
    const result = await deleteCustomDashboard(dashboard.id)
    if (result.success) {
      router.push("/dashboard")
    } else {
      setDeleting(false)
      window.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: {
            message: result.error,
            type: "error",
          },
        })
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold">
            {dashboard.name}
          </h1>
          {dashboard.description && (
            <p className="text-sm text-muted-foreground">
              {dashboard.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2Icon className="size-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl">
          <CompassRenderer spec={spec} data={data} />
        </div>
      </div>
    </div>
  )
}
