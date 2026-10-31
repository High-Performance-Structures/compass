"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { deleteDependency } from "@/app/actions/schedule-dependencies"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"
import { predecessorEditsFor, type PendingPredecessor } from "./form-model"

export interface PredecessorEditsState {
  readonly existingPredecessors: readonly TaskDependencyData[]
  readonly availableTasks: readonly ScheduleTaskData[]
  readonly pendingPredecessors: readonly PendingPredecessor[]
  readonly existingPredecessorEdits: Readonly<Record<string, PendingPredecessor>>
  readonly setPendingPredecessors: (predecessors: PendingPredecessor[]) => void
  readonly addPendingPredecessor: () => void
  readonly removePendingPredecessor: (index: number) => void
  readonly updatePendingPredecessor: (
    index: number,
    field: keyof PendingPredecessor,
    value: string | number
  ) => void
  readonly updateExistingPredecessor: (
    dependencyId: string,
    field: keyof PendingPredecessor,
    value: string | number
  ) => void
  readonly handleDeleteExistingDep: (depId: string) => Promise<void>
}

/** Saved predecessors being edited plus new ones not yet saved. */
export function usePredecessorEdits(
  projectId: string,
  editingTask: ScheduleTaskData | null,
  allTasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[]
): PredecessorEditsState {
  const router = useRouter()
  const [pendingPredecessors, setPendingPredecessors] = useState<PendingPredecessor[]>([])
  const [existingPredecessorEdits, setExistingPredecessorEdits] = useState<
    Record<string, PendingPredecessor>
  >({})

  const existingPredecessors = useMemo(() => {
    if (!editingTask) return []
    return dependencies.filter((d) => d.successorId === editingTask.id)
  }, [editingTask, dependencies])

  const availableTasks = useMemo(() => {
    return allTasks.filter((t) => t.id !== editingTask?.id)
  }, [allTasks, editingTask])

  useEffect(() => {
    if (!editingTask) {
      setExistingPredecessorEdits({})
      return
    }

    setExistingPredecessorEdits(predecessorEditsFor(dependencies, editingTask.id))
  }, [dependencies, editingTask])

  const addPendingPredecessor = () => {
    setPendingPredecessors((prev) => [...prev, { taskId: "", type: "FS", lagDays: 0 }])
  }

  const removePendingPredecessor = (index: number) => {
    setPendingPredecessors((prev) => prev.filter((_, i) => i !== index))
  }

  const updatePendingPredecessor = (
    index: number,
    field: keyof PendingPredecessor,
    value: string | number
  ) => {
    setPendingPredecessors((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    )
  }

  const handleDeleteExistingDep = async (depId: string) => {
    const result = await deleteDependency(depId, projectId)
    if (result.success) {
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  const updateExistingPredecessor = (
    dependencyId: string,
    field: keyof PendingPredecessor,
    value: string | number
  ): void => {
    setExistingPredecessorEdits((current) => {
      const existing = current[dependencyId]
      if (!existing) return current
      return {
        ...current,
        [dependencyId]: { ...existing, [field]: value }
      }
    })
  }

  return {
    existingPredecessors,
    availableTasks,
    pendingPredecessors,
    existingPredecessorEdits,
    setPendingPredecessors,
    addPendingPredecessor,
    removePendingPredecessor,
    updatePendingPredecessor,
    updateExistingPredecessor,
    handleDeleteExistingDep,
  }
}
