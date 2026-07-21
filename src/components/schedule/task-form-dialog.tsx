"use client"

import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  IconCalendar,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react"
import { format, parseISO } from "date-fns"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { saveScheduleTask } from "@/app/actions/schedule"
import { calculateEndDate } from "@/lib/schedule/business-days"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  DependencyType,
} from "@/lib/schedule/types"
import { PHASE_ORDER, PHASE_LABELS, getPhaseColor } from "@/lib/schedule/phase-colors"
import { STATUS_OPTIONS } from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"

const phases = PHASE_ORDER.map((value) => ({
  value,
  label: PHASE_LABELS[value],
}))

const DEPENDENCY_TYPES: readonly { value: DependencyType; label: string }[] = [
  { value: "FS", label: "Finish-to-Start" },
  { value: "SS", label: "Start-to-Start" },
  { value: "FF", label: "Finish-to-Finish" },
  { value: "SF", label: "Start-to-Finish" },
]

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  workdays: z.number().min(1, "Must be at least 1 day"),
  phase: z.string().min(1, "Phase is required"),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]),
  isMilestone: z.boolean(),
  percentComplete: z.number().min(0).max(100),
  assignedTo: z.string(),
  notes: z.string(),
})

type TaskFormValues = z.infer<typeof taskSchema>

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingTask: ScheduleTaskData | null
  allTasks?: readonly ScheduleTaskData[]
  dependencies?: readonly TaskDependencyData[]
  assigneeOptions?: readonly ProjectTaskAssigneeOption[]
}

interface PendingPredecessor {
  taskId: string
  type: DependencyType
  lagDays: number
}

export function TaskFormDialog({
  open,
  onOpenChange,
  projectId,
  editingTask,
  allTasks = [],
  dependencies = [],
  assigneeOptions = [],
}: TaskFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingTask
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingPredecessors, setPendingPredecessors] = useState<
    PendingPredecessor[]
  >([])

  const existingPredecessors = useMemo(() => {
    if (!editingTask) return []
    return dependencies.filter((d) => d.successorId === editingTask.id)
  }, [editingTask, dependencies])

  const availableTasks = useMemo(() => {
    return allTasks.filter((t) => t.id !== editingTask?.id)
  }, [allTasks, editingTask])

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      startDate: new Date().toISOString().split("T")[0],
      workdays: 5,
      phase: "preconstruction",
      status: "PENDING",
      isMilestone: false,
      percentComplete: 0,
      assignedTo: "",
      notes: "",
    },
  })

  useEffect(() => {
    if (editingTask) {
      form.reset({
        title: editingTask.title,
        startDate: editingTask.startDate,
        workdays: editingTask.workdays,
        phase: editingTask.phase,
        status: editingTask.status,
        isMilestone: editingTask.isMilestone,
        percentComplete: editingTask.percentComplete,
        assignedTo: editingTask.assignedTo ?? "",
        notes: "",
      })
      // expand details when editing since they likely want to see everything
      setDetailsOpen(true)
    } else {
      form.reset({
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        workdays: 5,
        phase: "preconstruction",
        status: "PENDING",
        isMilestone: false,
        percentComplete: 0,
        assignedTo: "",
        notes: "",
      })
      setDetailsOpen(false)
    }
    setPendingPredecessors(
      existingPredecessors.map((dependency) => ({
        taskId: dependency.predecessorId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      }))
    )
  }, [editingTask, existingPredecessors, form])

  const watchedStart = form.watch("startDate")
  const watchedWorkdays = form.watch("workdays")
  const watchedPhase = form.watch("phase")
  const watchedPercent = form.watch("percentComplete")

  const calculatedEnd = useMemo(() => {
    if (!watchedStart || !watchedWorkdays || watchedWorkdays < 1) return ""
    return calculateEndDate(watchedStart, watchedWorkdays)
  }, [watchedStart, watchedWorkdays])

  async function onSubmit(values: TaskFormValues) {
    const incompletePredecessor = pendingPredecessors.some(
      (predecessor) => !predecessor.taskId
    )
    if (incompletePredecessor) {
      toast.error("Choose a schedule item for each predecessor")
      return
    }

    const result = await saveScheduleTask(projectId, {
      taskId: editingTask?.id ?? null,
      title: values.title,
      startDate: values.startDate,
      workdays: values.workdays,
      phase: values.phase,
      status: values.status,
      isMilestone: values.isMilestone,
      percentComplete: values.percentComplete,
      assignedTo: values.assignedTo || null,
      predecessors: pendingPredecessors.map((predecessor) => ({
        predecessorId: predecessor.taskId,
        type: predecessor.type,
        lagDays: predecessor.lagDays,
      })),
    })
    if (result.success) {
      onOpenChange(false)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  const addPendingPredecessor = () => {
    setPendingPredecessors((prev) => [
      ...prev,
      { taskId: "", type: "FS", lagDays: 0 },
    ])
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

  const hasPredecessors = pendingPredecessors.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 shrink-0">
          <DialogTitle className="text-base font-semibold">
            {isEditing ? "Edit Schedule Item" : "New Schedule Item"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="overflow-y-auto flex-1 min-h-0 px-5 pb-4 space-y-4">
              {/* === ESSENTIAL FIELDS === */}

              {/* Title */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder="Task name"
                        className="h-10 text-sm font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phase pills */}
              <div className="flex flex-wrap gap-1.5">
                {phases.map((p) => {
                  const colors = getPhaseColor(p.value)
                  const isSelected = watchedPhase === p.value
                  return (
                    <button
                      key={p.value}
                      type="button"
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                        isSelected
                          ? `${colors.badge} ring-1 ring-current/20`
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => form.setValue("phase", p.value)}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>

              {/* Date row: Start | Duration | End */}
              <div className="grid grid-cols-[1fr_100px_1fr] gap-2 items-end">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] text-muted-foreground font-medium">
                        Start
                      </FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className="w-full h-9 justify-start text-left font-normal text-sm"
                            >
                              <IconCalendar className="size-3.5 mr-1.5 text-muted-foreground shrink-0" />
                              {field.value
                                ? format(parseISO(field.value), "MMM d, yyyy")
                                : "Pick date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={
                              field.value ? parseISO(field.value) : undefined
                            }
                            onSelect={(date) => {
                              if (date) {
                                field.onChange(format(date, "yyyy-MM-dd"))
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="workdays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] text-muted-foreground font-medium">
                        Duration
                      </FormLabel>
                      <div className="flex items-center gap-1">
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            className="h-9 text-center"
                            value={field.value}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value) || 0)
                            }
                            onBlur={field.onBlur}
                            ref={field.ref}
                            name={field.name}
                          />
                        </FormControl>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          d
                        </span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel className="text-[11px] text-muted-foreground font-medium">
                    End
                  </FormLabel>
                  <div className="flex items-center h-9 px-3 rounded-md bg-muted/40 text-sm text-muted-foreground tabular-nums">
                    {calculatedEnd
                      ? format(parseISO(calculatedEnd), "MMM d, yyyy")
                      : "\u2014"}
                  </div>
                </FormItem>
              </div>

              {/* === DETAILS (collapsible) === */}
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 w-full"
                  >
                    {detailsOpen ? (
                      <IconChevronDown className="size-3.5" />
                    ) : (
                      <IconChevronRight className="size-3.5" />
                    )}
                    Details
                    {!detailsOpen && (isEditing || hasPredecessors) && (
                      <span className="text-[10px] text-primary ml-1">
                        (has data)
                      </span>
                    )}
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="space-y-4 pt-3">
                  {/* Status + Assignee + Milestone row */}
                  <div className="grid grid-cols-[140px_1fr_auto] gap-3 items-end">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] text-muted-foreground font-medium">
                            Status
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {STATUS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="assignedTo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] text-muted-foreground font-medium">
                            Assignee
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Name or team"
                              className="h-9"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isMilestone"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 pb-0.5">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0 text-[11px] text-muted-foreground font-medium">
                            Milestone
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Progress */}
                  <FormField
                    control={form.control}
                    name="percentComplete"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] text-muted-foreground font-medium">
                          Progress
                        </FormLabel>
                        <div className="flex items-center gap-3">
                          <FormControl>
                            <Slider
                              min={0}
                              max={100}
                              step={5}
                              value={[field.value]}
                              onValueChange={([val]) => field.onChange(val)}
                              className="flex-1"
                            />
                          </FormControl>
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {watchedPercent}%
                          </span>
                        </div>
                      </FormItem>
                    )}
                  />

                  {/* Predecessors */}
                  <div className="space-y-2">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Predecessors
                    </span>

                    {pendingPredecessors.map((pred, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_90px_60px_28px] gap-1.5 items-center"
                      >
                        <Select
                          value={pred.taskId}
                          onValueChange={(val) =>
                            updatePendingPredecessor(idx, "taskId", val)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select task" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableTasks.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={pred.type}
                          onValueChange={(val) =>
                            updatePendingPredecessor(idx, "type", val)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEPENDENCY_TYPES.map((d) => (
                              <SelectItem key={d.value} value={d.value}>
                                {d.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          placeholder="Lag / lead"
                          aria-label="Lag or lead days"
                          className="h-8 text-xs text-center"
                          value={pred.lagDays || ""}
                          onChange={(e) =>
                            updatePendingPredecessor(
                              idx,
                              "lagDays",
                              Number(e.target.value) || 0
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removePendingPredecessor(idx)}
                        >
                          <IconTrash className="size-3" />
                        </Button>
                      </div>
                    ))}

                    {availableTasks.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground h-7 px-2"
                        onClick={addPendingPredecessor}
                      >
                        <IconPlus className="size-3 mr-1" />
                        Add
                      </Button>
                    )}

                    {pendingPredecessors.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Positive days add lag; negative days create lead time.
                      </p>
                    )}

                    {availableTasks.length === 0 &&
                      pendingPredecessors.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/60">
                          No other tasks to link as predecessors.
                        </p>
                      )}
                  </div>

                  {/* Notes */}
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] text-muted-foreground font-medium">
                          Notes
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Add notes..."
                            className="min-h-[60px] resize-none text-sm"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
              {editingTask && (
                <div className="mr-auto">
                  <ProjectTaskCreateButton
                    projectId={projectId}
                    sourceLabel="Schedule item"
                    sourceRecordId={editingTask.id}
                    sourceRecordNumber={null}
                    sourceHref={`/dashboard/projects/${projectId}/schedule?task=${encodeURIComponent(editingTask.id)}`}
                    defaultTitle={`Follow up: ${editingTask.title}`}
                    defaultDescription={`${editingTask.phase} · ${editingTask.startDate} to ${editingTask.endDateCalculated}`}
                    defaultAssigneeName={editingTask.assignedTo}
                    defaultCompanyName={null}
                    defaultDueDate={editingTask.endDateCalculated}
                    defaultPriority={editingTask.isCriticalPath ? "high" : "normal"}
                    defaultTaskType="schedule_task"
                    assigneeOptions={assigneeOptions}
                    triggerLabel="Create To-Do"
                  />
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? "Saving..."
                  : isEditing
                    ? "Save"
                    : "Create Schedule Item"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
