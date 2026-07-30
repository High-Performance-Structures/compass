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
import {
  createTask,
  updateTask,
  createDependency,
  updateDependency,
  deleteDependency,
} from "@/app/actions/schedule"
import { sendScheduleTaskReminder } from "@/app/actions/schedule-confirmations"
import { calculateEndDate } from "@/lib/schedule/business-days"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  DependencyType,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import { PHASE_ORDER, PHASE_LABELS, getPhaseColor } from "@/lib/schedule/phase-colors"
import {
  DEFAULT_DISPLAY_COLOR,
  DISPLAY_COLOR_OPTIONS,
} from "@/lib/schedule/appearance"
import { STATUS_OPTIONS } from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { ScheduleItemLinks } from "@/components/schedule/schedule-item-links"

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

const scheduleItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  workdays: z.number().min(1, "Must be at least 1 day"),
  phase: z.string().min(1, "Phase is required"),
  displayColor: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]),
  isMilestone: z.boolean(),
  percentComplete: z.number().min(0).max(100),
  assignedTo: z.string(),
  ownerVisible: z.boolean(),
  subVendorVisible: z.boolean(),
  confirmationRequired: z.boolean(),
  notes: z.string(),
})

type ScheduleItemFormValues = z.infer<typeof scheduleItemSchema>

interface ScheduleItemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingTask: ScheduleTaskData | null
  allTasks?: readonly ScheduleTaskData[]
  dependencies?: readonly TaskDependencyData[]
  exceptions?: readonly WorkdayExceptionData[]
  assigneeOptions?: readonly ProjectTaskAssigneeOption[]
}

interface PendingPredecessor {
  taskId: string
  type: DependencyType
  lagDays: number
}

export function ScheduleItemFormDialog({
  open,
  onOpenChange,
  projectId,
  editingTask,
  allTasks = [],
  dependencies = [],
  exceptions = [],
  assigneeOptions = [],
}: ScheduleItemFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingTask
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingPredecessors, setPendingPredecessors] = useState<
    PendingPredecessor[]
  >([])
  const [existingPredecessorEdits, setExistingPredecessorEdits] = useState<
    Record<string, PendingPredecessor>
  >({})
  const [assignedOptionId, setAssignedOptionId] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState(false)

  const existingPredecessors = useMemo(() => {
    if (!editingTask) return []
    return dependencies.filter((d) => d.successorId === editingTask.id)
  }, [editingTask, dependencies])

  const availableTasks = useMemo(() => {
    return allTasks.filter((t) => t.id !== editingTask?.id)
  }, [allTasks, editingTask])

  const form = useForm<ScheduleItemFormValues>({
    resolver: zodResolver(scheduleItemSchema),
    defaultValues: {
      title: "",
      startDate: new Date().toISOString().split("T")[0],
      workdays: 5,
      phase: "preconstruction",
      displayColor: DEFAULT_DISPLAY_COLOR,
      status: "PENDING",
      isMilestone: false,
      percentComplete: 0,
      assignedTo: "",
      ownerVisible: true,
      subVendorVisible: false,
      confirmationRequired: false,
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
        displayColor: editingTask.displayColor ?? DEFAULT_DISPLAY_COLOR,
        status: editingTask.status,
        isMilestone: editingTask.isMilestone,
        percentComplete: editingTask.percentComplete,
        assignedTo: editingTask.assignedTo ?? "",
        ownerVisible: editingTask.ownerVisible ?? true,
        subVendorVisible: editingTask.subVendorVisible ?? false,
        confirmationRequired: editingTask.confirmationRequired ?? false,
        notes: "",
      })
      setAssignedOptionId(
        assigneeOptions.find(
          (option) =>
            option.name.trim().toLowerCase() ===
            (editingTask.assignedTo ?? "").trim().toLowerCase()
        )?.id ?? null
      )
      // expand details when editing since they likely want to see everything
      setDetailsOpen(true)
    } else {
      form.reset({
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        workdays: 5,
        phase: "preconstruction",
        displayColor: DEFAULT_DISPLAY_COLOR,
        status: "PENDING",
        isMilestone: false,
        percentComplete: 0,
        assignedTo: "",
        ownerVisible: true,
        subVendorVisible: false,
        confirmationRequired: false,
        notes: "",
      })
      setAssignedOptionId(null)
      setDetailsOpen(false)
    }
    setPendingPredecessors([])
  }, [assigneeOptions, editingTask, form])

  useEffect(() => {
    if (!editingTask) {
      setExistingPredecessorEdits({})
      return
    }

    setExistingPredecessorEdits(
      Object.fromEntries(
        dependencies
          .filter((dependency) => dependency.successorId === editingTask.id)
          .map((dependency) => [
            dependency.id,
            {
              taskId: dependency.predecessorId,
              type: dependency.type,
              lagDays: dependency.lagDays,
            },
          ])
      )
    )
  }, [dependencies, editingTask])

  const watchedStart = form.watch("startDate")
  const watchedWorkdays = form.watch("workdays")
  const watchedPhase = form.watch("phase")
  const watchedDisplayColor = form.watch("displayColor")
  const watchedStatus = form.watch("status")
  const watchedPercent = form.watch("percentComplete")

  const calculatedEnd = useMemo(() => {
    if (!watchedStart || !watchedWorkdays || watchedWorkdays < 1) return ""
    return calculateEndDate(watchedStart, watchedWorkdays, exceptions)
  }, [exceptions, watchedStart, watchedWorkdays])

  async function onSubmit(values: ScheduleItemFormValues) {
    const { notes, ...taskValues } = values
    void notes
    let savedTaskId: string
    if (isEditing) {
      const result = await updateTask(editingTask.id, {
        ...taskValues,
        assignedTo: taskValues.assignedTo || null,
        assignedOptionId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      savedTaskId = editingTask.id
    } else {
      const result = await createTask(projectId, {
        ...taskValues,
        assignedTo: taskValues.assignedTo || undefined,
        assignedOptionId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      savedTaskId = result.taskId
    }

    const dependencyErrors: string[] = []
    for (const dependency of existingPredecessors) {
      const edit = existingPredecessorEdits[dependency.id]
      if (
        !edit ||
        (edit.taskId === dependency.predecessorId &&
          edit.type === dependency.type &&
          edit.lagDays === dependency.lagDays)
      ) {
        continue
      }

      const dependencyResult = await updateDependency({
        dependencyId: dependency.id,
        predecessorId: edit.taskId,
        successorId: savedTaskId,
        type: edit.type,
        lagDays: edit.lagDays,
        projectId,
      })
      if (!dependencyResult.success) {
        dependencyErrors.push(dependencyResult.error)
      }
    }

    for (const predecessor of pendingPredecessors) {
      if (predecessor.taskId) {
        const dependencyResult = await createDependency({
          predecessorId: predecessor.taskId,
          successorId: savedTaskId,
          type: predecessor.type,
          lagDays: predecessor.lagDays,
          projectId,
        })
        if (!dependencyResult.success) {
          dependencyErrors.push(dependencyResult.error)
        }
      }
    }

    router.refresh()
    if (dependencyErrors.length > 0) {
      toast.warning(
        `Schedule item saved, but ${dependencyErrors.length} predecessor change${
          dependencyErrors.length === 1 ? "" : "s"
        } could not be saved: ${dependencyErrors.join("; ")}`
      )
      return
    }
    onOpenChange(false)
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
        [dependencyId]: { ...existing, [field]: value },
      }
    })
  }

  const hasPredecessors =
    existingPredecessors.length > 0 || pendingPredecessors.length > 0

  async function handleSendReminder(): Promise<void> {
    if (!editingTask) return
    setSendingReminder(true)
    const result = await sendScheduleTaskReminder(editingTask.id)
    setSendingReminder(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Confirmation reminder sent.")
    router.refresh()
  }

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
                        placeholder="Schedule item name"
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

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground font-medium">
                  Display color
                </span>
                <div className="flex items-center gap-1.5" aria-label="Display color">
                  {DISPLAY_COLOR_OPTIONS.map((color) => {
                    const selected = watchedDisplayColor === color.value
                    return (
                      <button
                        key={color.value}
                        type="button"
                        title={color.label}
                        aria-label={color.label}
                        aria-pressed={selected}
                        className={cn(
                          "size-5 rounded-full border-2 transition-transform",
                          color.buttonClassName,
                          selected
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-110"
                        )}
                        onClick={() => form.setValue("displayColor", color.value)}
                      />
                    )
                  })}
                </div>
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] text-muted-foreground font-medium">
                            Status
                          </FormLabel>
                          <Select
                            onValueChange={(status) => {
                              field.onChange(status)
                              if (status === "COMPLETE") {
                                form.setValue("percentComplete", 100, {
                                  shouldDirty: true,
                                })
                              } else if (watchedPercent >= 100) {
                                form.setValue(
                                  "percentComplete",
                                  status === "IN_PROGRESS" ? 50 : 0,
                                  { shouldDirty: true }
                                )
                              }
                            }}
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
                            Responsible contact
                          </FormLabel>
                          <ProjectAssigneePicker
                            value={field.value}
                            options={assigneeOptions}
                            onValueChange={(value, option) => {
                              field.onChange(value)
                              setAssignedOptionId(option?.id ?? null)
                              if (option?.contactType === "owner") {
                                form.setValue("ownerVisible", true, {
                                  shouldDirty: true,
                                })
                              }
                              if (
                                option?.contactType === "subcontractor" ||
                                option?.contactType === "supplier"
                              ) {
                                form.setValue("subVendorVisible", true, {
                                  shouldDirty: true,
                                })
                              }
                            }}
                            placeholder="Choose contact or type a name..."
                          />
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
                              onValueChange={([value]) => {
                                field.onChange(value)
                                if (value === 100 && watchedStatus !== "COMPLETE") {
                                  form.setValue("status", "COMPLETE", {
                                    shouldDirty: true,
                                  })
                                } else if (
                                  value < 100 &&
                                  watchedStatus === "COMPLETE"
                                ) {
                                  form.setValue(
                                    "status",
                                    value > 0 ? "IN_PROGRESS" : "PENDING",
                                    { shouldDirty: true }
                                  )
                                }
                              }}
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

                  <div className="border-t pt-4">
                    <p className="text-xs font-medium">
                      Audience &amp; commitment
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Visibility changes reach project workspaces only after the
                      schedule is published.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <FormField
                        control={form.control}
                        name="ownerVisible"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">
                              Owner can view
                            </FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="subVendorVisible"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">
                              Subs can view
                            </FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="confirmationRequired"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">
                              Require confirmation
                            </FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    {isEditing && editingTask.confirmationRequired && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Status:{" "}
                          {(editingTask.confirmationStatus ?? "not_requested")
                            .replace(/_/g, " ")
                            .replace(/^\w/, (letter) => letter.toUpperCase())}
                        </span>
                        {editingTask.confirmationStatus !== "confirmed" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={sendingReminder}
                            onClick={handleSendReminder}
                          >
                            {sendingReminder ? "Sending…" : "Send reminder"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing && <ScheduleItemLinks taskId={editingTask.id} />}

                  {/* Predecessors */}
                  <div className="space-y-2">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Predecessors
                    </span>

                    {existingPredecessors.map((dep) => {
                      const edit = existingPredecessorEdits[dep.id] ?? {
                        taskId: dep.predecessorId,
                        type: dep.type,
                        lagDays: dep.lagDays,
                      }
                      return (
                        <div
                          key={dep.id}
                          className="space-y-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
                        >
                          <Select
                            value={edit.taskId}
                            onValueChange={(value) =>
                              updateExistingPredecessor(
                                dep.id,
                                "taskId",
                                value
                              )
                            }
                          >
                            <SelectTrigger
                              className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                              aria-label="Saved predecessor schedule item"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {availableTasks.map((task) => (
                                <SelectItem key={task.id} value={task.id}>
                                  {task.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-end gap-2">
                            <div className="min-w-0 space-y-1">
                              <span className="block text-[10px] text-muted-foreground">
                                Relationship
                              </span>
                              <Select
                                value={edit.type}
                                onValueChange={(value) =>
                                  updateExistingPredecessor(
                                    dep.id,
                                    "type",
                                    value
                                  )
                                }
                              >
                                <SelectTrigger
                                  className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                                  aria-label="Saved dependency relationship"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DEPENDENCY_TYPES.map((dependencyType) => (
                                    <SelectItem
                                      key={dependencyType.value}
                                      value={dependencyType.value}
                                    >
                                      {dependencyType.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="min-w-0 space-y-1">
                              <span className="block text-[10px] text-muted-foreground">
                                Lag / lead days
                              </span>
                              <Input
                                type="number"
                                className="h-9 min-w-0 text-center text-xs"
                                value={edit.lagDays}
                                aria-label="Saved dependency lag or lead in days"
                                onChange={(event) =>
                                  updateExistingPredecessor(
                                    dep.id,
                                    "lagDays",
                                    Number(event.target.value) || 0
                                  )
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="mb-0.5 size-8 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteExistingDep(dep.id)}
                              aria-label="Remove saved predecessor"
                              title="Remove predecessor"
                            >
                              <IconTrash className="size-3" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}

                    {pendingPredecessors.map((pred, idx) => (
                      <div
                        key={idx}
                        className="space-y-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
                      >
                        <Select
                          value={pred.taskId}
                          onValueChange={(val) =>
                            updatePendingPredecessor(idx, "taskId", val)
                          }
                        >
                          <SelectTrigger
                            className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                            aria-label="Predecessor schedule item"
                          >
                            <SelectValue placeholder="Select schedule item" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableTasks.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-end gap-2">
                          <div className="min-w-0 space-y-1">
                            <span className="block text-[10px] text-muted-foreground">
                              Relationship
                            </span>
                            <Select
                              value={pred.type}
                              onValueChange={(val) =>
                                updatePendingPredecessor(idx, "type", val)
                              }
                            >
                              <SelectTrigger
                                className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                                aria-label="Dependency relationship"
                              >
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
                          </div>
                          <div className="min-w-0 space-y-1">
                            <span className="block text-[10px] text-muted-foreground">
                              Lag / lead days
                            </span>
                            <Input
                              type="number"
                              className="h-9 min-w-0 text-center text-xs"
                              value={pred.lagDays || ""}
                              aria-label="Lag or lead in days"
                              onChange={(e) =>
                                updatePendingPredecessor(
                                  idx,
                                  "lagDays",
                                  Number(e.target.value) || 0
                                )
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mb-0.5 size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removePendingPredecessor(idx)}
                            aria-label="Remove predecessor"
                            title="Remove predecessor"
                          >
                            <IconTrash className="size-3" />
                          </Button>
                        </div>
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

                    {availableTasks.length === 0 &&
                      existingPredecessors.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/60">
                          No other schedule items to link as predecessors.
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
            <div className="flex justify-end gap-2 px-5 py-3 border-t shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm">
                {isEditing ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
