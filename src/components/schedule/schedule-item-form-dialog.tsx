"use client"

import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  IconCalendar,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconTemplate
} from "@tabler/icons-react"
import { format, parseISO } from "date-fns"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  createTask,
  updateTask,
  createDependency,
  updateDependency,
  deleteDependency
} from "@/app/actions/schedule"
import {
  deleteSchedulePhaseOption,
  getSchedulePhaseOptions,
  saveSchedulePhaseOption,
  type ReusableSchedulePhaseOption,
} from "@/app/actions/schedule-phases"
import {
  getScheduleTaskChangeProposal,
  rejectScheduleTaskChangeProposal,
  sendScheduleTaskReminder,
  type ScheduleTaskChangeProposal,
} from "@/app/actions/schedule-confirmations"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { validateScheduleShiftReason } from "@/lib/schedule/shift-tracking"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  DependencyType,
  WorkdayExceptionData
} from "@/lib/schedule/types"
import { PHASE_ORDER, PHASE_LABELS } from "@/lib/schedule/phase-colors"
import { DEFAULT_DISPLAY_COLOR, DISPLAY_COLOR_OPTIONS } from "@/lib/schedule/appearance"
import { STATUS_OPTIONS } from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import {
  getScheduleTaskTodos,
  type ProjectOperationItem,
} from "@/app/actions/project-operations"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ScheduleCommitmentResponses } from "@/components/schedule/schedule-commitment-responses"
import { ScheduleItemLinks } from "@/components/schedule/schedule-item-links"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS } from "@/components/schedule/schedule-item-defaults"
import type { ScheduleTemplateImportGroup } from "@/app/actions/template-import-options"
import {
  clearScheduleTemplateImportOptions,
  loadScheduleTemplateImportOptions
} from "@/components/schedule/schedule-template-import-options-client"
import { projectTodoHref, scheduleItemHref } from "@/lib/work-calendar"

const defaultPhaseOptions: readonly ReusableSchedulePhaseOption[] = PHASE_ORDER.map((value) => ({
  id: null,
  value,
  label: PHASE_LABELS[value],
  source: "default"
}))

const CUSTOM_PHASE_VALUE = "__custom_phase__"

const DEPENDENCY_TYPES: readonly { value: DependencyType; label: string }[] = [
  { value: "FS", label: "Finish-to-Start" },
  { value: "SS", label: "Start-to-Start" },
  { value: "FF", label: "Finish-to-Finish" },
  { value: "SF", label: "Start-to-Finish" }
]

const scheduleItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  workdays: z.number().min(1, "Must be at least 1 day"),
  phase: z.string().trim().min(1, "Phase is required"),
  displayColor: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]),
  isMilestone: z.boolean(),
  percentComplete: z.number().min(0).max(100),
  assignedTo: z.string(),
  ownerVisible: z.boolean(),
  subVendorVisible: z.boolean(),
  confirmationRequired: z.boolean(),
  notes: z.string(),
  shiftReason: z.string().max(500, "Reason must be 500 characters or fewer")
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
  onBulkTemplateImport?: () => void
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
  onBulkTemplateImport
}: ScheduleItemFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingTask
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingPredecessors, setPendingPredecessors] = useState<PendingPredecessor[]>([])
  const [existingPredecessorEdits, setExistingPredecessorEdits] = useState<
    Record<string, PendingPredecessor>
  >({})
  const [assignedOptionId, setAssignedOptionId] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [templateGroups, setTemplateGroups] = useState<
    readonly ScheduleTemplateImportGroup[] | null
  >(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateLoadError, setTemplateLoadError] = useState(false)
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0)
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [selectedTemplateItemId, setSelectedTemplateItemId] = useState("")
  const [selectedTemplateTodoIds, setSelectedTemplateTodoIds] = useState<readonly string[]>([])
  const [templateTodosOpen, setTemplateTodosOpen] = useState(false)
  const [phaseOptions, setPhaseOptions] = useState<
    readonly ReusableSchedulePhaseOption[]
  >(defaultPhaseOptions)
  const [phaseOptionsLoading, setPhaseOptionsLoading] = useState(false)
  const [customPhaseMode, setCustomPhaseMode] = useState(false)
  const [customPhaseName, setCustomPhaseName] = useState("")
  const [saveCustomPhase, setSaveCustomPhase] = useState(true)
  const [linkedTodos, setLinkedTodos] = useState<
    readonly ProjectOperationItem[]
  >([])
  const [linkedTodosLoading, setLinkedTodosLoading] = useState(false)
  const [linkedTodosError, setLinkedTodosError] = useState<string | null>(null)
  const [linkedTodosRefreshKey, setLinkedTodosRefreshKey] = useState(0)
  const [changeProposal, setChangeProposal] =
    useState<ScheduleTaskChangeProposal | null>(null)
  const [proposalLoading, setProposalLoading] = useState(false)
  const [proposalActionPending, setProposalActionPending] = useState(false)
  const [acceptProposalOnSave, setAcceptProposalOnSave] = useState(false)

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
      workdays: DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS,
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
      shiftReason: ""
    }
  })

  useEffect(() => {
    if (!open || isEditing || templateGroups !== null) return
    let cancelled = false
    setTemplateLoading(true)
    setTemplateLoadError(false)
    void loadScheduleTemplateImportOptions()
      .then((groups) => {
        if (!cancelled) setTemplateGroups(groups)
      })
      .catch((error: unknown) => {
        console.error("Unable to load schedule template options", error)
        if (!cancelled) {
          setTemplateGroups(null)
          setTemplateLoadError(true)
          toast.error("Unable to load published schedule templates.")
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEditing, open, templateGroups, templateLoadAttempt])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhaseOptionsLoading(true)
    void getSchedulePhaseOptions(projectId)
      .then((options) => {
        if (!cancelled) setPhaseOptions(options)
      })
      .catch((error: unknown) => {
        console.error("Unable to load reusable schedule phases", error)
        if (!cancelled) {
          setPhaseOptions(defaultPhaseOptions)
          toast.error("Unable to load saved phases. Compass defaults are available.")
        }
      })
      .finally(() => {
        if (!cancelled) setPhaseOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (!open) return
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
        shiftReason: ""
      })
      setAssignedOptionId(
        assigneeOptions.find(
          (option) =>
            option.name.trim().toLowerCase() === (editingTask.assignedTo ?? "").trim().toLowerCase()
        )?.id ?? null
      )
      // expand details when editing since they likely want to see everything
      setDetailsOpen(true)
    } else {
      form.reset({
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        workdays: DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS,
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
        shiftReason: ""
      })
      setAssignedOptionId(null)
      setDetailsOpen(false)
      setSelectedTemplateId("")
      setSelectedTemplateItemId("")
      setSelectedTemplateTodoIds([])
      setTemplateTodosOpen(false)
    }
    setCustomPhaseMode(false)
    setCustomPhaseName("")
    setSaveCustomPhase(true)
    setPendingPredecessors([])
    setAcceptProposalOnSave(false)
  }, [assigneeOptions, editingTask, form, open])

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
              lagDays: dependency.lagDays
            }
          ])
      )
    )
  }, [dependencies, editingTask])

  useEffect(() => {
    let cancelled = false
    if (!open || !editingTask) {
      setLinkedTodos([])
      setLinkedTodosLoading(false)
      setLinkedTodosError(null)
      return () => {
        cancelled = true
      }
    }

    setLinkedTodosLoading(true)
    setLinkedTodosError(null)
    void getScheduleTaskTodos(projectId, editingTask.id)
      .then((todos) => {
        if (!cancelled) setLinkedTodos(todos)
      })
      .catch((error: unknown) => {
        console.error("Unable to load linked schedule to-dos", error)
        if (!cancelled) {
          setLinkedTodosError("Related to-dos could not be loaded.")
        }
      })
      .finally(() => {
        if (!cancelled) setLinkedTodosLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editingTask, linkedTodosRefreshKey, open, projectId])

  useEffect(() => {
    let cancelled = false
    if (!open || !editingTask) {
      setChangeProposal(null)
      setProposalLoading(false)
      return () => {
        cancelled = true
      }
    }

    setProposalLoading(true)
    void getScheduleTaskChangeProposal(editingTask.id)
      .then((proposal) => {
        if (!cancelled) setChangeProposal(proposal)
      })
      .catch((error: unknown) => {
        console.error("Unable to load schedule change proposal", error)
        if (!cancelled) toast.error("The subcontractor proposal could not be loaded.")
      })
      .finally(() => {
        if (!cancelled) setProposalLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editingTask, open])

  const watchedStart = form.watch("startDate")
  const watchedWorkdays = form.watch("workdays")
  const watchedPhase = form.watch("phase")
  const watchedDisplayColor = form.watch("displayColor")
  const watchedStatus = form.watch("status")
  const watchedPercent = form.watch("percentComplete")
  const selectedTemplateGroup = useMemo(
    () => templateGroups?.find((group) => group.templateId === selectedTemplateId) ?? null,
    [selectedTemplateId, templateGroups]
  )

  function applyTemplateScheduleItem(templateItemId: string): void {
    setSelectedTemplateItemId(templateItemId)
    setSelectedTemplateTodoIds([])
    setTemplateTodosOpen(false)
    const item = selectedTemplateGroup?.scheduleItems.find(
      (candidate) => candidate.id === templateItemId
    )
    if (!item) return
    form.setValue("title", item.title, { shouldDirty: true })
    form.setValue("workdays", item.workdays, { shouldDirty: true })
    form.setValue("phase", item.phase, { shouldDirty: true })
    form.setValue("displayColor", item.displayColor, { shouldDirty: true })
    form.setValue("isMilestone", item.isMilestone, { shouldDirty: true })
    form.setValue("assignedTo", item.assignedTo ?? "", { shouldDirty: true })
    form.setValue("ownerVisible", item.ownerVisible, { shouldDirty: true })
    form.setValue("subVendorVisible", item.subVendorVisible, {
      shouldDirty: true
    })
    setAssignedOptionId(null)
  }

  function chooseTemplate(templateId: string): void {
    setSelectedTemplateId(templateId)
    setSelectedTemplateItemId("")
    setSelectedTemplateTodoIds([])
    setTemplateTodosOpen(false)
    form.setValue("title", "", { shouldDirty: true })
    form.setValue("workdays", DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS, { shouldDirty: true })
    form.setValue("phase", "preconstruction", { shouldDirty: true })
    form.setValue("displayColor", DEFAULT_DISPLAY_COLOR, {
      shouldDirty: true
    })
    form.setValue("isMilestone", false, { shouldDirty: true })
    form.setValue("assignedTo", "", { shouldDirty: true })
    form.setValue("ownerVisible", true, { shouldDirty: true })
    form.setValue("subVendorVisible", false, { shouldDirty: true })
    setAssignedOptionId(null)
  }

  const calculatedEnd = useMemo(() => {
    if (!watchedStart || !watchedWorkdays || watchedWorkdays < 1) return ""
    return calculateEndDate(watchedStart, watchedWorkdays, exceptions)
  }, [exceptions, watchedStart, watchedWorkdays])

  function toggleTemplateTodo(todoId: string, selected: boolean): void {
    setSelectedTemplateTodoIds((current) =>
      selected
        ? current.includes(todoId)
          ? current
          : [...current, todoId]
        : current.filter((id) => id !== todoId)
    )
  }

  async function onSubmit(values: ScheduleItemFormValues) {
    const datesChanged =
      editingTask !== null &&
      (values.startDate !== editingTask.startDate ||
        values.workdays !== editingTask.workdays)
    const existingDependencyChanged = existingPredecessors.some((dependency) => {
      const edit = existingPredecessorEdits[dependency.id]
      return Boolean(
        edit &&
          (edit.taskId !== dependency.predecessorId ||
            edit.type !== dependency.type ||
            edit.lagDays !== dependency.lagDays)
      )
    })
    const dependencyAdded = pendingPredecessors.some(
      (predecessor) => predecessor.taskId.length > 0
    )
    const shiftReasonResult =
      datesChanged || existingDependencyChanged || dependencyAdded
        ? validateScheduleShiftReason(values.shiftReason)
        : null
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      form.setError("shiftReason", { message: shiftReasonResult.error })
      return
    }

    let submittedPhase = values.phase
    if (customPhaseMode && saveCustomPhase) {
      const phaseResult = await saveSchedulePhaseOption({
        projectId,
        name: values.phase,
      })
      if (!phaseResult.success) {
        toast.error(phaseResult.error)
        return
      }
      submittedPhase = phaseResult.option.value
      setPhaseOptions((current) => {
        const withoutDuplicate = current.filter(
          (option) =>
            option.value.trim().toLocaleLowerCase() !==
            phaseResult.option.value.trim().toLocaleLowerCase()
        )
        return [...withoutDuplicate, phaseResult.option]
      })
    }
    const { notes, shiftReason, ...valuesWithoutNotes } = values
    const taskValues = { ...valuesWithoutNotes, phase: submittedPhase }
    void notes
    void shiftReason
    let savedTaskId: string
    let linkedTodoCount = 0
    if (isEditing) {
      const result = await updateTask(editingTask.id, {
        ...taskValues,
        assignedTo: taskValues.assignedTo || null,
        assignedOptionId,
        acceptChangeProposal: acceptProposalOnSave,
        shiftReason: shiftReasonResult?.success
          ? shiftReasonResult.reason
          : undefined
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
        templateScheduleItemId: selectedTemplateItemId || null,
        templateTodoIds: selectedTemplateTodoIds
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      savedTaskId = result.taskId
      linkedTodoCount = result.linkedTodoCount
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
        shiftReason: shiftReasonResult?.success
          ? shiftReasonResult.reason
          : values.shiftReason
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
          shiftReason: shiftReasonResult?.success
            ? shiftReasonResult.reason
            : values.shiftReason
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
    if (linkedTodoCount > 0) {
      toast.success(
        `Schedule item created with ${linkedTodoCount} linked to-do${
          linkedTodoCount === 1 ? "" : "s"
        }.`
      )
    }
    onOpenChange(false)
  }

  async function removeSelectedSavedPhase(): Promise<void> {
    const selected = phaseOptions.find(
      (option) => option.value === watchedPhase && option.source === "saved"
    )
    if (!selected?.id) return
    if (
      !window.confirm(
        `Remove “${selected.label}” from the reusable phase catalog? Existing schedule items and templates will not change.`
      )
    ) {
      return
    }
    const result = await deleteSchedulePhaseOption({
      projectId,
      optionId: selected.id,
    })
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setPhaseOptions((current) =>
      current.filter((option) => option.id !== selected.id)
    )
    toast.success(
      "Removed from the reusable catalog. It may still appear where it is already in use."
    )
  }

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

  const hasPredecessors = existingPredecessors.length > 0 || pendingPredecessors.length > 0

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

  function useProposedDates(): void {
    if (!changeProposal) return
    form.setValue("startDate", changeProposal.startDate, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue("workdays", changeProposal.workdays, {
      shouldDirty: true,
      shouldValidate: true,
    })
    setAcceptProposalOnSave(true)
    toast.info("Proposed dates loaded. Review them, then save the schedule item.")
  }

  async function rejectProposedDates(): Promise<void> {
    if (!editingTask || !changeProposal) return
    setProposalActionPending(true)
    const result = await rejectScheduleTaskChangeProposal(editingTask.id)
    setProposalActionPending(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setChangeProposal(null)
    setAcceptProposalOnSave(false)
    toast.success("The proposed dates were declined. The assignee can respond again.")
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="overflow-y-auto flex-1 min-h-0 px-5 pb-4 space-y-4">
              {/* === ESSENTIAL FIELDS === */}

              {!isEditing && (
                <section className="border-y bg-muted/20 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <IconTemplate className="size-4" />
                      Import from a published template
                    </div>
                    {onBulkTemplateImport && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={onBulkTemplateImport}
                      >
                        Import several
                      </Button>
                    )}
                  </div>
                  {templateLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <IconLoader2 className="size-3.5 animate-spin" />
                      Loading template schedule items…
                    </div>
                  ) : templateLoadError ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Compass could not load the published templates.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          clearScheduleTemplateImportOptions()
                          setTemplateLoadError(false)
                          setTemplateGroups(null)
                          setTemplateLoadAttempt((attempt) => attempt + 1)
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : templateGroups?.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No published templates contain reusable schedule items.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={selectedTemplateId} onValueChange={chooseTemplate}>
                        <SelectTrigger aria-label="Choose schedule template">
                          <SelectValue placeholder="Choose template" />
                        </SelectTrigger>
                        <SelectContent>
                          {(templateGroups ?? []).map((group) => (
                            <SelectItem key={group.templateId} value={group.templateId}>
                              {group.templateName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={selectedTemplateItemId}
                        onValueChange={applyTemplateScheduleItem}
                        disabled={!selectedTemplateGroup}
                      >
                        <SelectTrigger aria-label="Choose template schedule item">
                          <SelectValue placeholder="Choose schedule item" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedTemplateGroup?.scheduleItems ?? []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {selectedTemplateGroup && selectedTemplateItemId && (
                    <div className="mt-3 border-t pt-3">
                      {selectedTemplateGroup.linkedTodos.length > 0 ? (
                        <Collapsible open={templateTodosOpen} onOpenChange={setTemplateTodosOpen}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium">Optional template to-dos</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {selectedTemplateTodoIds.length} of{" "}
                                {selectedTemplateGroup.linkedTodos.length} selected · none are added
                                unless selected
                              </p>
                            </div>
                            <CollapsibleTrigger asChild>
                              <Button type="button" variant="outline" size="sm" className="h-8">
                                Choose to-dos
                                {templateTodosOpen ? (
                                  <IconChevronDown className="ml-1 size-3.5" />
                                ) : (
                                  <IconChevronRight className="ml-1 size-3.5" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          </div>
                          <CollapsibleContent className="mt-3 border-y">
                            <div className="flex items-center justify-end gap-1 border-b py-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  setSelectedTemplateTodoIds(
                                    selectedTemplateGroup.linkedTodos.map((todo) => todo.id)
                                  )
                                }
                              >
                                Select all
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={selectedTemplateTodoIds.length === 0}
                                onClick={() => setSelectedTemplateTodoIds([])}
                              >
                                Clear
                              </Button>
                            </div>
                            <div className="max-h-52 divide-y overflow-y-auto">
                              {selectedTemplateGroup.linkedTodos.map((todo) => (
                                <label
                                  key={todo.id}
                                  className="flex cursor-pointer items-start gap-3 py-2.5"
                                >
                                  <Checkbox
                                    checked={selectedTemplateTodoIds.includes(todo.id)}
                                    onCheckedChange={(value) =>
                                      toggleTemplateTodo(todo.id, value === true)
                                    }
                                    aria-label={`Include ${todo.title}`}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium">{todo.title}</span>
                                    {todo.checklistItemCount > 0 && (
                                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                        Includes {todo.checklistItemCount} checklist item
                                        {todo.checklistItemCount === 1 ? "" : "s"}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          This template does not include any to-dos.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              )}

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

              <FormField
                control={form.control}
                name="phase"
                render={({ field }) => {
                  const selectedSavedPhase = phaseOptions.find(
                    (option) =>
                      option.value === field.value && option.source === "saved"
                  )
                  return (
                    <FormItem>
                      <FormLabel className="text-[11px] font-medium text-muted-foreground">
                        Phase
                      </FormLabel>
                      <div className="flex items-center gap-2">
                        <Select
                          value={customPhaseMode ? CUSTOM_PHASE_VALUE : field.value}
                          onValueChange={(value) => {
                            if (value === CUSTOM_PHASE_VALUE) {
                              setCustomPhaseMode(true)
                              setCustomPhaseName("")
                              setSaveCustomPhase(true)
                              field.onChange("")
                              return
                            }
                            setCustomPhaseMode(false)
                            setCustomPhaseName("")
                            field.onChange(value)
                          }}
                        >
                          <FormControl>
                            <SelectTrigger className="h-9 flex-1">
                              <SelectValue
                                placeholder={
                                  phaseOptionsLoading ? "Loading phases…" : "Choose phase"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {phaseOptions.map((option) => (
                              <SelectItem key={`${option.source}-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <SelectItem value={CUSTOM_PHASE_VALUE}>
                              + Add custom phase…
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {selectedSavedPhase?.id && !customPhaseMode && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-9 shrink-0 text-muted-foreground"
                            title="Remove from reusable phases"
                            aria-label={`Remove ${selectedSavedPhase.label} from reusable phases`}
                            onClick={() => void removeSelectedSavedPhase()}
                          >
                            <IconTrash className="size-4" />
                          </Button>
                        )}
                      </div>
                      {customPhaseMode && (
                        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                          <Input
                            value={customPhaseName}
                            maxLength={100}
                            placeholder="Custom phase name"
                            autoFocus
                            onChange={(event) => {
                              const value = event.currentTarget.value
                              setCustomPhaseName(value)
                              field.onChange(value)
                            }}
                          />
                          <label className="flex items-start gap-2 text-xs text-muted-foreground">
                            <Checkbox
                              checked={saveCustomPhase}
                              onCheckedChange={(checked) =>
                                setSaveCustomPhase(checked === true)
                              }
                            />
                            <span>
                              Save to the reusable phase list for future schedules and templates
                            </span>
                          </label>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground font-medium">Display color</span>
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
                            selected={field.value ? parseISO(field.value) : undefined}
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
                            onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            name={field.name}
                          />
                        </FormControl>
                        <span className="text-[11px] text-muted-foreground shrink-0">d</span>
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
                    {calculatedEnd ? format(parseISO(calculatedEnd), "MMM d, yyyy") : "\u2014"}
                  </div>
                </FormItem>
              </div>

              <FormField
                control={form.control}
                name="shiftReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] text-muted-foreground font-medium">
                      Schedule shift reason
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Required when dates or predecessors change"
                        className="min-h-[60px] resize-none text-sm"
                        maxLength={500}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      Saved in activity history. If the project finish moves later,
                      project administrators are warned that a change order may be needed.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                      <span className="text-[10px] text-primary ml-1">(has data)</span>
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
                                  shouldDirty: true
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
                              if (option?.contactType === "owner" || option?.contactType === "subcontractor" || option?.contactType === "supplier") {
                                form.setValue("confirmationRequired", true, { shouldDirty: true })
                              }
                              if (option?.contactType === "owner") {
                                form.setValue("ownerVisible", true, {
                                  shouldDirty: true
                                })
                              }
                              if (
                                option?.contactType === "subcontractor" ||
                                option?.contactType === "supplier"
                              ) {
                                form.setValue("subVendorVisible", true, {
                                  shouldDirty: true
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
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
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
                                    shouldDirty: true
                                  })
                                } else if (value < 100 && watchedStatus === "COMPLETE") {
                                  form.setValue("status", value > 0 ? "IN_PROGRESS" : "PENDING", {
                                    shouldDirty: true
                                  })
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
                    <p className="text-xs font-medium">Audience &amp; commitment</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Visibility changes reach project workspaces only after the schedule is
                      published.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <FormField
                        control={form.control}
                        name="ownerVisible"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">Owner can view</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="subVendorVisible"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">Subs can view</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="confirmationRequired"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
                            <FormLabel className="!mt-0 text-xs">Require confirmation</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Assign owner-performed work or owner-supplied deliveries to the owner.
                      Require confirmation and publish to request their commitment.
                      Use a milestone for a delivery deadline.
                    </p>
                    {proposalLoading && (
                      <p className="mt-3 border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                        Loading assignment proposal…
                      </p>
                    )}
                    {changeProposal && (
                      <div className="mt-3 space-y-3 border border-amber-400/50 bg-amber-500/5 px-3 py-3">
                        <div>
                          <p className="text-xs font-medium">
                            Assignee proposed new dates
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {format(parseISO(changeProposal.startDate), "MMM d, yyyy")} ·{" "}
                            {changeProposal.workdays} workday
                            {changeProposal.workdays === 1 ? "" : "s"}
                          </p>
                          {changeProposal.note && (
                            <p className="mt-2 whitespace-pre-wrap text-xs">
                              {changeProposal.note}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={proposalActionPending}
                            onClick={useProposedDates}
                          >
                            {acceptProposalOnSave ? "Proposal loaded" : "Use proposed dates"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={proposalActionPending}
                            onClick={rejectProposedDates}
                          >
                            Decline proposal
                          </Button>
                        </div>
                        {acceptProposalOnSave && (
                          <p className="text-[11px] text-muted-foreground">
                            Saving applies these dates through the normal dependency and
                            related to-do updates. Publish afterward to make them visible
                            externally.
                          </p>
                        )}
                      </div>
                    )}
                    {isEditing && editingTask.confirmationRequired && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Status:{" "}
                          {(editingTask.confirmationStatus ?? "not_requested")
                            .replace(/_/g, " ")
                            .replace(/^\w/, (letter) => letter.toUpperCase())}
                        </span>
                        {editingTask.proposalNote && editingTask.confirmationStatus !== "proposed" && (
                          <p className="w-full whitespace-pre-wrap text-muted-foreground">
                            Response note: {editingTask.proposalNote}
                          </p>
                        )}
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

                  {isEditing && open && (
                    <ScheduleCommitmentResponses
                      taskId={editingTask.id}
                      onUseProposal={(proposal) => {
                        if (proposal.startDate !== null) {
                          form.setValue("startDate", proposal.startDate, { shouldDirty: true, shouldValidate: true })
                        }
                        if (proposal.workdays !== null) {
                          form.setValue("workdays", proposal.workdays, { shouldDirty: true, shouldValidate: true })
                        }
                        toast.info("Proposed dates loaded. Review and save, then publish the schedule.")
                      }}
                    />
                  )}

                  {isEditing && <ScheduleItemLinks taskId={editingTask.id} />}

                  {/* Predecessors */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[11px] font-medium text-muted-foreground">
                        Predecessors
                      </h3>
                      <ContextualHelpBeacon topicId="schedule.predecessors" />
                    </div>

                    {existingPredecessors.map((dep) => {
                      const edit = existingPredecessorEdits[dep.id] ?? {
                        taskId: dep.predecessorId,
                        type: dep.type,
                        lagDays: dep.lagDays
                      }
                      return (
                        <div
                          key={dep.id}
                          className="space-y-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
                        >
                          <Select
                            value={edit.taskId}
                            onValueChange={(value) =>
                              updateExistingPredecessor(dep.id, "taskId", value)
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
                                  updateExistingPredecessor(dep.id, "type", value)
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
                          onValueChange={(val) => updatePendingPredecessor(idx, "taskId", val)}
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
                              onValueChange={(val) => updatePendingPredecessor(idx, "type", val)}
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

                    {availableTasks.length === 0 && existingPredecessors.length === 0 && (
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

              {editingTask && (
                <section className="space-y-3 border-t pt-4" aria-label="Related to-dos">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">Related to-dos</h3>
                        {!linkedTodosLoading && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {linkedTodos.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        These stay in the existing Compass project to-do list and link back here.
                      </p>
                    </div>
                    <ProjectTaskCreateButton
                      projectId={projectId}
                      sourceLabel="Schedule item"
                      sourceRecordId={editingTask.id}
                      sourceRecordNumber={null}
                      sourceHref={scheduleItemHref(projectId, editingTask.id)}
                      defaultTitle={`Follow up: ${editingTask.title}`}
                      defaultDescription={`${editingTask.phase} schedule item.`}
                      defaultAssigneeName={editingTask.assignedTo}
                      defaultCompanyName={null}
                      defaultDueDate={editingTask.endDateCalculated}
                      defaultPriority={editingTask.isCriticalPath ? "high" : "normal"}
                      defaultTaskType="schedule_task"
                      assigneeOptions={assigneeOptions}
                      onCreated={() =>
                        setLinkedTodosRefreshKey((current) => current + 1)
                      }
                    />
                  </div>

                  {linkedTodosLoading ? (
                    <p className="border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      Loading related to-dos…
                    </p>
                  ) : linkedTodosError ? (
                    <p className="border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive">
                      {linkedTodosError}
                    </p>
                  ) : linkedTodos.length === 0 ? (
                    <p className="border border-dashed px-3 py-3 text-xs text-muted-foreground">
                      No to-dos are linked to this schedule item yet.
                    </p>
                  ) : (
                    <div className="divide-y border">
                      {linkedTodos.map((todo) => (
                        <div
                          key={todo.id}
                          className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <Link
                              href={projectTodoHref(projectId, todo.id)}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {todo.title}
                            </Link>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {todo.sourceRecordNumber ?? "Compass to-do"}
                              {todo.assigneeName || todo.companyName
                                ? ` · ${todo.assigneeName ?? todo.companyName}`
                                : ""}
                              {todo.dueDate
                                ? ` · Due ${format(parseISO(todo.dueDate), "MMM d, yyyy")}`
                                : " · No due date"}
                            </p>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {todo.status.replaceAll("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Link
                    href={`/dashboard/projects/${encodeURIComponent(projectId)}/todos`}
                    className="inline-flex text-xs font-medium text-primary hover:underline"
                  >
                    Open all project to-dos
                  </Link>
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t shrink-0">
              <p className="text-[11px] text-muted-foreground">
                {!isEditing && selectedTemplateItemId
                  ? `1 schedule item + ${selectedTemplateTodoIds.length} to-do${
                      selectedTemplateTodoIds.length === 1 ? "" : "s"
                    }`
                  : null}
              </p>
              <div className="flex justify-end gap-2">
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
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
