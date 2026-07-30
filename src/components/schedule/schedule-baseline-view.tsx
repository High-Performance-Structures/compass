"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconTrash, IconGitCompare } from "@tabler/icons-react"
import { createBaseline, deleteBaseline } from "@/app/actions/baselines"
import type {
  ScheduleBaselineData,
  ScheduleTaskData,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format, parseISO } from "date-fns"
import {
  parseBaselineTasks,
  scheduleBaselineVariance,
} from "@/lib/schedule/baseline-variance"

interface ScheduleBaselineViewProps {
  projectId: string
  baselines: ScheduleBaselineData[]
  currentTasks: ScheduleTaskData[]
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy")
  } catch {
    return dateStr
  }
}

function varianceLabel(value: number | null): string {
  if (value === null) return "—"
  if (value === 0) return "On plan"
  return `${value > 0 ? "+" : ""}${value} days`
}

export function ScheduleBaselineView({
  projectId,
  baselines,
  currentTasks,
}: ScheduleBaselineViewProps) {
  const router = useRouter()
  const [baselineName, setBaselineName] = useState("")
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!baselineName.trim()) {
      toast.error("Baseline name is required")
      return
    }
    setSaving(true)
    const result = await createBaseline(projectId, baselineName.trim())
    setSaving(false)
    if (result.success) {
      setBaselineName("")
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }, [projectId, baselineName, router])

  const handleDelete = useCallback(
    async (id: string) => {
      const result = await deleteBaseline(id)
      if (result.success) {
        if (selectedId === id) setSelectedId(null)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    },
    [router, selectedId]
  )

  const comparison = useMemo(() => {
    if (!selectedId) return null
    const baseline = baselines.find((b) => b.id === selectedId)
    if (!baseline) return null

    const snapshotTasks = parseBaselineTasks(baseline.snapshotData)
    if (!snapshotTasks) return null
    return scheduleBaselineVariance(currentTasks, snapshotTasks)
  }, [selectedId, baselines, currentTasks])

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-6">
        <Input
          placeholder="Baseline name..."
          value={baselineName}
          onChange={(e) => setBaselineName(e.target.value)}
          className="flex-1 sm:max-w-[250px]"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !baselineName.trim()}
          className="whitespace-nowrap"
        >
          Save Baseline
        </Button>
      </div>

      {baselines.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2">Saved Baselines</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {baselines.map((b) => (
                  <TableRow
                    key={b.id}
                    className={
                      selectedId === b.id ? "bg-muted/50" : ""
                    }
                  >
                    <TableCell className="font-medium text-sm">
                      {b.name}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(b.createdAt.split("T")[0])}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() =>
                            setSelectedId(
                              selectedId === b.id ? null : b.id
                            )
                          }
                        >
                          <IconGitCompare className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleDelete(b.id)}
                        >
                          <IconTrash className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {comparison && (
        <div>
          <h3 className="text-sm font-medium mb-2">
            Comparison: Current vs Baseline
          </h3>
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 border-y py-3 text-sm md:grid-cols-4">
            <div>
              <span className="block text-xs text-muted-foreground">
                Baseline finish
              </span>
              {comparison.baselineFinish
                ? formatDate(comparison.baselineFinish)
                : "—"}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Current finish
              </span>
              {comparison.currentFinish
                ? formatDate(comparison.currentFinish)
                : "—"}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Project slippage
              </span>
              <span
                className={
                  comparison.finishVarianceDays !== null &&
                  comparison.finishVarianceDays > 0
                    ? "font-medium text-red-600"
                    : "font-medium text-green-700"
                }
              >
                {varianceLabel(comparison.finishVarianceDays)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Item movement
              </span>
              {comparison.delayedItemCount} delayed ·{" "}
              {comparison.aheadItemCount} ahead
            </div>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Schedule Item</TableHead>
                  <TableHead>Baseline Start</TableHead>
                  <TableHead>Baseline End</TableHead>
                  <TableHead>Current Start</TableHead>
                  <TableHead>Current End</TableHead>
                  <TableHead>Start Variance</TableHead>
                  <TableHead>Finish Variance</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-sm">
                      {row.title}
                      {row.state !== "existing" && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {row.state === "new" ? "New" : "Removed"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.baselineStart
                        ? formatDate(row.baselineStart)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.baselineFinish
                        ? formatDate(row.baselineFinish)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.currentStart
                        ? formatDate(row.currentStart)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.currentFinish
                        ? formatDate(row.currentFinish)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.startVarianceDays !== null &&
                          row.startVarianceDays > 0
                            ? "text-xs font-medium text-red-600"
                            : "text-xs font-medium text-green-700"
                        }
                      >
                        {varianceLabel(row.startVarianceDays)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.finishVarianceDays !== null &&
                          row.finishVarianceDays > 0
                            ? "text-xs font-medium text-red-600"
                            : "text-xs font-medium text-green-700"
                        }
                      >
                        {varianceLabel(row.finishVarianceDays)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">
                        {varianceLabel(row.durationVarianceDays)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
