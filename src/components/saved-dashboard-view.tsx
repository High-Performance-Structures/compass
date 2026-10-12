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
import { PageHeader } from "@/components/page-header"

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
      <PageHeader
        className="mb-4"
        title={dashboard.name}
        // The description is what the user wrote for this dashboard, so it stays.
        meta={dashboard.description || undefined}
        actions={
          <>
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
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        <CompassRenderer spec={spec} data={data} />
      </div>
    </div>
  )
}
