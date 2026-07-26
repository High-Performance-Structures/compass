"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { createDependency } from "@/app/actions/schedule"
import { wouldCreateCycle } from "@/lib/schedule/dependency-validation"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  DependencyType,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const depTypes: { value: DependencyType; label: string }[] = [
  { value: "FS", label: "Finish-to-Start" },
  { value: "SS", label: "Start-to-Start" },
  { value: "FF", label: "Finish-to-Finish" },
  { value: "SF", label: "Start-to-Finish" },
]

interface DependencyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  tasks: ScheduleTaskData[]
  dependencies: TaskDependencyData[]
}

export function DependencyDialog({
  open,
  onOpenChange,
  projectId,
  tasks,
  dependencies,
}: DependencyDialogProps) {
  const router = useRouter()
  const [predecessorId, setPredecessorId] = useState("")
  const [successorId, setSuccessorId] = useState("")
  const [type, setType] = useState<DependencyType>("FS")
  const [lagDays, setLagDays] = useState(0)
  const [error, setError] = useState("")

  function validate() {
    if (!predecessorId || !successorId) {
      setError("Select both schedule items")
      return false
    }
    if (predecessorId === successorId) {
      setError("A schedule item cannot depend on itself")
      return false
    }
    if (wouldCreateCycle(dependencies, predecessorId, successorId)) {
      setError("This dependency would create a circular reference")
      return false
    }
    setError("")
    return true
  }

  async function handleSubmit() {
    if (!validate()) return

    const result = await createDependency({
      predecessorId,
      successorId,
      type,
      lagDays,
      projectId,
    })

    if (result.success) {
      onOpenChange(false)
      setPredecessorId("")
      setSuccessorId("")
      setType("FS")
      setLagDays(0)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Dependency</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Predecessor (must finish first)</Label>
            <Select value={predecessorId} onValueChange={setPredecessorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select schedule item" />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Successor (depends on predecessor)</Label>
            <Select value={successorId} onValueChange={setSuccessorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select schedule item" />
              </SelectTrigger>
              <SelectContent>
                {tasks
                  .filter((t) => t.id !== predecessorId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as DependencyType)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {depTypes.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Lag / lead (days)</Label>
              <Input
                type="number"
                value={lagDays}
                onChange={(e) => setLagDays(Number(e.target.value))}
                className="mt-1"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Add Dependency</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
