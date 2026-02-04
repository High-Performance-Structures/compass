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

interface SnapshotTask {
  id: string
  title: string
  startDate: string
  endDateCalculated: string
  workdays: number
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

    let snapshotTasks: SnapshotTask[] = []
    try {
      const parsed = JSON.parse(baseline.snapshotData)
      snapshotTasks = parsed.tasks || []
    } catch {
      return null
    }

    const snapshotMap = new Map(
      snapshotTasks.map((t) => [t.id, t])
    )

    return currentTasks.map((current) => {
      const original = snapshotMap.get(current.id)
      if (!original) {
        return {
          title: current.title,
          originalStart: "-",
          originalEnd: "-",
          currentStart: current.startDate,
          currentEnd: current.endDateCalculated,
          variance: "New",
        }
      }

      const origDays = original.workdays
      const currDays = current.workdays
      const diff = currDays - origDays

      return {
        title: current.title,
        originalStart: original.startDate,
        originalEnd: original.endDateCalculated,
        currentStart: current.startDate,
        currentEnd: current.endDateCalculated,
        variance:
          diff === 0
            ? "On track"
            : diff > 0
              ? `+${diff} days`
              : `${diff} days`,
      }
    })
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
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Baseline Start</TableHead>
                  <TableHead>Baseline End</TableHead>
                  <TableHead>Current Start</TableHead>
                  <TableHead>Current End</TableHead>
                  <TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">
                      {row.title}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.originalStart === "-"
                        ? "-"
                        : formatDate(row.originalStart)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.originalEnd === "-"
                        ? "-"
                        : formatDate(row.originalEnd)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.currentStart)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.currentEnd)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs font-medium ${
                          row.variance === "On track"
                            ? "text-green-600"
                            : row.variance === "New"
                              ? "text-blue-600"
                              : row.variance.startsWith("+")
                                ? "text-red-600"
                                : "text-green-600"
                        }`}
                      >
                        {row.variance}
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
